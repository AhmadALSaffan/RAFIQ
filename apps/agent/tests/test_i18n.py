"""The agent speaks the UI's language: every user-facing message goes through tr(), every key
has English and Russian, and the language follows each request's Accept-Language."""

import ast
import re
from pathlib import Path

import httpx
import pytest
from httpx import ASGITransport

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.i18n import all_translations, current_locale, parse_accept_language, tr
from rafiq_agent.locales import EN, RU
from rafiq_agent.main import app
from rafiq_agent.storage.db import init_db

PKG = Path(__file__).resolve().parents[1] / "rafiq_agent"
AR = re.compile(r"[\u0600-\u06FF]")
PLACEHOLDER = re.compile(r"\{\w+\}")

# Text only the model reads stays as written (models read any language), and module-level
# texts are translated where they're used. Anything else with Arabic must be inside tr().
NOT_TRANSLATED: dict[str, set[str] | str] = {
    "core/prompts.py": "*",
    "core/loop.py": "*",
    "tools/skills.py": "*",
    "tools/tasks.py": "*",
    "skills/registry.py": "*",
    "locales.py": "*",
    "core/agent_runtime.py": {"SYSTEM_PROMPT", "working_dir_system_note", "parallel_note", "WORKTREE_NOTE"},
    # Tool descriptions and results are written for the model (tools/tasks.py, likewise).
    "core/project_notes.py": "*",
    "mcp_bridge.py": "*",
    "tools/web.py": "*",
    "tools/browser.py": "*",
    "tools/desktop.py": "*",
    "tools/os_adapters/windows.py": "*",
    "core/attachments.py": {"_pdf_text", "_truncate", "build_user_content"},
    "core/chat_service.py": {"transcript_of", "summarize", "_system_prompt"},
    "core/designs.py": {"QUESTIONS", "DESIGN_SYSTEM_PROMPT", "skills_note", "_SLUG_BAD"},
    "llm/copilot.py": {"_text_of", "split_messages", "stream_chat", "aclose"},
    "integrations/tools.py": {"description", "parameters"},
    "integrations/providers.py": {"spec"},
    "auth/github_copilot.py": {"_ERRORS"},
    "auth/resolve.py": {"DISCONNECTED"},
}


def _is_tr(node: ast.AST) -> bool:
    return isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "tr"


def _scan():
    keys: dict[str, str] = {}
    stray: list[str] = []
    for path in sorted(PKG.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        rel = path.relative_to(PKG).as_posix()
        allowed = NOT_TRANSLATED.get(rel, set())
        tree = ast.parse(path.read_text(encoding="utf-8"))

        def walk(
            node: ast.AST, owners: tuple[str, ...], in_tr: bool, rel: str = rel, allowed=allowed
        ) -> None:
            if _is_tr(node):
                first = node.args[0] if node.args else None
                if (
                    isinstance(first, ast.Constant)
                    and isinstance(first.value, str)
                    and AR.search(first.value)
                ):
                    keys.setdefault(first.value, f"{rel}:{node.lineno}")
                in_tr = True
            name = None
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                name = node.name
                body = node.body
                if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
                    body = body[1:]  # docstrings aren't UI text
                for child in [*node.decorator_list, *body]:
                    walk(child, (*owners, name), in_tr)
                return
            if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
                name = node.targets[0].id
            elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
                name = node.target.id
            owners = (*owners, name) if name else owners
            texts = []
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                texts = [node.value]
            elif isinstance(node, ast.JoinedStr):
                texts = [v.value for v in node.values if isinstance(v, ast.Constant)]
            if any(AR.search(t) for t in texts) and not in_tr:
                if allowed != "*" and not (set(owners) & allowed):
                    stray.append(f"{rel}:{node.lineno} in {'.'.join(owners) or '<module>'}")
                return
            for child in ast.iter_child_nodes(node):
                walk(child, owners, in_tr)

        body = tree.body
        if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
            body = body[1:]
        for stmt in body:
            walk(stmt, (), False)

    # Module texts translated at the point of use.
    from rafiq_agent.auth.github_copilot import _ERRORS
    from rafiq_agent.auth.resolve import DISCONNECTED
    from rafiq_agent.core.designs import QUESTIONS
    from rafiq_agent.core.prompts import DEFAULT_TITLE
    from rafiq_agent.integrations.providers import REGISTRY

    dynamic = [DISCONNECTED, DEFAULT_TITLE, *_ERRORS.values()]
    for q in QUESTIONS:
        dynamic += [q["label"], q.get("placeholder") or "", *q.get("options", [])]
    for cls in REGISTRY.values():
        dynamic += [cls.spec.blurb, *(f.label for f in cls.spec.fields), *(f.help for f in cls.spec.fields)]
    for text in dynamic:
        if text and AR.search(text):
            keys.setdefault(text, "module text")
    return keys, stray


KEYS, STRAY = _scan()


def test_user_facing_arabic_goes_through_tr():
    assert STRAY == []


@pytest.mark.parametrize("name,table", [("en", EN), ("ru", RU)])
def test_every_key_is_translated(name, table):
    assert [f"{where}  {key}" for key, where in KEYS.items() if key not in table] == []


@pytest.mark.parametrize("name,table", [("en", EN), ("ru", RU)])
def test_placeholders_survive_translation(name, table):
    def names(text):
        return sorted(set(PLACEHOLDER.findall(text)))

    assert [key for key in KEYS if key in table and names(table[key]) != names(key)] == []


def test_no_stale_translations():
    assert sorted((set(EN) | set(RU)) - set(KEYS)) == []


def test_accept_language_parsing():
    assert parse_accept_language("ru-RU,ru;q=0.9,en;q=0.8") == "ru"
    assert parse_accept_language("fr-FR, en;q=0.5") == "en"
    assert parse_accept_language("de") is None
    assert parse_accept_language(None) is None


def test_tr_fills_and_falls_back():
    assert tr("المجلد غير موجود: {0}", "C:/x") in {
        "المجلد غير موجود: C:/x",
        "Folder not found: C:/x",
        "Папка не найдена: C:/x",
    }
    assert tr("نص ما إله ترجمة") == "نص ما إله ترجمة"
    assert all_translations("محادثة جديدة") == {"محادثة جديدة", "New chat", "Новый чат"}


@pytest.fixture()
async def client():
    await init_db()
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.mark.parametrize(
    "lang,expected",
    [("ar", "مزوّد غير معروف"), ("en", "Unknown provider"), ("ru", "Неизвестный провайдер")],
)
async def test_errors_follow_the_request_language(client, lang, expected):
    resp = await client.post(
        "/accounts/nope/connect", headers={"authorization": f"Bearer {AUTH_TOKEN}", "accept-language": lang}
    )
    assert resp.status_code == 404 and resp.json()["detail"] == expected


async def test_design_questions_are_localized(client):
    resp = await client.get(
        "/designs/questions", headers={"authorization": f"Bearer {AUTH_TOKEN}", "accept-language": "en"}
    )
    first = resp.json()[0]
    assert first["label"] == "What do you want to design?" and "Website" in first["options"]


def test_background_work_uses_the_last_language_seen():
    # Outside a request, the language of the most recent request applies (tasks, events).
    assert current_locale() in {"ar", "en", "ru"}
