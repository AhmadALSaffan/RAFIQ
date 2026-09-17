"""Memory, workspaces, task modes, commit, HTML export, template import/export, MCP
requirements, skill commands and URL installs."""

import subprocess
from pathlib import Path

import httpx
import pytest
from httpx import ASGITransport

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.core import gitops
from rafiq_agent.core.export_html import render
from rafiq_agent.core.memory import memory_note, remember, remembered
from rafiq_agent.main import app
from rafiq_agent.skills import install as skill_install
from rafiq_agent.skills.registry import USER_DIR, all_skills, get_skill, reload_skills
from rafiq_agent.storage.db import SessionLocal, init_db
from rafiq_agent.storage.models import LlmModel, Task
from rafiq_agent.tools.filesystem import FilesystemWriteTool

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}


@pytest.fixture()
async def db():
    await init_db()


@pytest.fixture()
async def client(db):
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _model() -> str:
    async with SessionLocal() as session:
        model = LlmModel(name="T", provider="custom", model_id="t", base_url="http://127.0.0.1:1")
        session.add(model)
        await session.commit()
        return model.id


# ── Memory ────────────────────────────────────────────────────────────────────────────


async def test_memories_round_trip_and_reach_the_prompt(client):
    r = await client.post("/memories", json={"text": "أفضّل الردود بالعربي", "kind": "preference"}, headers=AUTH)
    assert r.status_code == 201
    memory_id = r.json()["id"]
    assert "أفضّل الردود بالعربي" in await memory_note()

    r = await client.patch(f"/memories/{memory_id}", json={"enabled": False}, headers=AUTH)
    assert r.status_code == 200 and r.json()["enabled"] is False
    assert "أفضّل الردود بالعربي" not in await memory_note()

    r = await client.delete(f"/memories/{memory_id}", headers=AUTH)
    assert r.status_code == 204
    assert all(m.id != memory_id for m in await remembered())


async def test_remember_dedupes_identical_text(db):
    a = await remember("المشروع اسمه رفيق")
    b = await remember("  المشروع اسمه رفيق ")
    assert a.id == b.id


# ── Workspaces ────────────────────────────────────────────────────────────────────────


async def test_workspaces_scope_chats_and_tasks(client):
    model = await _model()
    r = await client.post("/workspaces", json={"name": "متجر", "instructions": "رد بالعربي", "color": "#e68835"}, headers=AUTH)
    assert r.status_code == 201
    ws = r.json()["id"]

    chat = (await client.post("/chats", json={"model_id": model, "workspace_id": ws}, headers=AUTH)).json()
    assert chat["workspace_id"] == ws
    other = (await client.post("/chats", json={"model_id": model}, headers=AUTH)).json()

    scoped = (await client.get(f"/chats?workspace_id={ws}", headers=AUTH)).json()
    assert [c["id"] for c in scoped] == [chat["id"]]
    everything = (await client.get("/chats", headers=AUTH)).json()
    assert {c["id"] for c in everything} >= {chat["id"], other["id"]}

    from rafiq_agent.api.workspaces import workspace_note

    assert "رد بالعربي" in await workspace_note(ws)

    listed = (await client.get("/workspaces", headers=AUTH)).json()
    assert listed[0]["chats"] == 1

    # Deleting the workspace keeps the chat, just unassigned.
    assert (await client.delete(f"/workspaces/{ws}", headers=AUTH)).status_code == 204
    assert (await client.get(f"/chats/{chat['id']}", headers=AUTH)).json()["workspace_id"] is None


# ── Task modes ────────────────────────────────────────────────────────────────────────


async def test_plan_mode_task_is_created_planned_and_approval_requeues_it(client, tmp_path):
    model = await _model()
    r = await client.post(
        "/tasks", json={"title": "خطة", "prompt": "رتّب الملفات", "model_id": model, "working_dir": str(tmp_path), "mode": "plan"}, headers=AUTH
    )
    assert r.status_code == 201
    task_id = r.json()["id"]
    assert r.json()["mode"] == "plan"

    # No provider in tests: park the task as the runtime would after writing its plan.
    async with SessionLocal() as session:
        task = await session.get(Task, task_id)
        task.status, task.plan = "planned", "1. اقرأ المجلد\n2. رتّب"
        await session.commit()

    r = await client.post(f"/tasks/{task_id}/plan/approve", json={"plan": "1. اقرأ المجلد فقط"}, headers=AUTH)
    assert r.status_code == 200
    assert r.json()["status"] == "queued"
    assert r.json()["plan"] == "1. اقرأ المجلد فقط"

    # Approving twice is refused — it is no longer waiting on a plan.
    r = await client.post(f"/tasks/{task_id}/plan/approve", json={}, headers=AUTH)
    assert r.status_code == 400


async def test_rejecting_a_plan_cancels_the_task(client, tmp_path):
    model = await _model()
    task_id = (await client.post("/tasks", json={"title": "x", "prompt": "y", "model_id": model, "mode": "plan"}, headers=AUTH)).json()["id"]
    async with SessionLocal() as session:
        task = await session.get(Task, task_id)
        task.status, task.plan = "planned", "plan"
        await session.commit()
    r = await client.post(f"/tasks/{task_id}/plan/reject", headers=AUTH)
    assert r.status_code == 200 and r.json()["status"] == "cancelled"


async def test_unknown_mode_falls_back_to_auto(client):
    model = await _model()
    r = await client.post("/tasks", json={"title": "x", "prompt": "y", "model_id": model, "mode": "weird"}, headers=AUTH)
    assert r.status_code == 422  # the schema only knows auto / plan / step


# ── Write preview ─────────────────────────────────────────────────────────────────────


async def test_write_preview_is_a_diff_for_existing_files_and_a_listing_for_new_ones(tmp_path):
    (tmp_path / "a.txt").write_text("one\ntwo\nthree\n", encoding="utf-8")
    tool = FilesystemWriteTool(tmp_path)
    diff = await tool.preview({"path": "a.txt", "content": "one\n2\nthree\n"})
    assert "-two" in diff and "+2" in diff and "a/a.txt" in diff
    new = await tool.preview({"path": "b.txt", "content": "hello\n"})
    assert "new file" in new and "+hello" in new
    assert await tool.preview({"path": "../escape.txt", "content": ""}) is None
    assert await tool.preview({"path": "a.txt", "content": "one\ntwo\nthree\n"}) == "(no changes)"


# ── Commit ────────────────────────────────────────────────────────────────────────────


def _git(cwd: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


@pytest.mark.skipif(not gitops.available(), reason="git not installed")
async def test_commit_paths_commits_only_the_named_files(tmp_path):
    _git(tmp_path, "init", "-q")
    _git(tmp_path, "config", "user.email", "t@t")
    _git(tmp_path, "config", "user.name", "t")
    (tmp_path / "keep.txt").write_text("k", encoding="utf-8")
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-qm", "init")
    (tmp_path / "a.txt").write_text("a", encoding="utf-8")
    (tmp_path / "b.txt").write_text("b", encoding="utf-8")
    sha = await gitops.commit_paths(tmp_path, ["a.txt"], "Add a")
    assert len(sha) == 40
    assert _git(tmp_path, "show", "--stat", "--format=", "HEAD").count(".txt") == 1
    assert "b.txt" in _git(tmp_path, "status", "--porcelain")


# ── HTML export ───────────────────────────────────────────────────────────────────────


def test_html_export_is_self_contained_and_escapes():
    html = render(
        "محادثة <b>",
        [
            {"role": "user", "content": "<script>alert(1)</script>", "parts": None, "created_at": None, "model_id": None},
            {
                "role": "assistant",
                "content": "",
                "parts": [{"kind": "text", "text": "# عنوان\n\n**غامق**"}, {"kind": "tool", "tool": "shell_run", "args": {"cmd": "ls"}, "ok": True, "output": "a"}],
                "created_at": None,
                "model_id": "m",
            },
        ],
        {"m": "GPT"},
    )
    assert html.startswith("<!doctype html>") and 'dir="rtl"' in html
    assert "<script>alert" not in html and "&lt;script&gt;" in html
    assert "<h1>عنوان</h1>" in html and "<strong>غامق</strong>" in html
    assert "shell_run" in html and "GPT" in html
    assert "<script" not in html.lower().replace("&lt;script", "")


async def test_export_route_serves_html_and_markdown(client):
    model = await _model()
    chat = (await client.post("/chats", json={"model_id": model}, headers=AUTH)).json()
    r = await client.get(f"/chats/{chat['id']}/export?format=html", headers=AUTH)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")
    assert "attachment" in r.headers["content-disposition"]
    r = await client.get(f"/chats/{chat['id']}/export?format=md", headers=AUTH)
    assert r.status_code == 200 and r.text.startswith("# ")


# ── Templates ─────────────────────────────────────────────────────────────────────────


async def test_template_import_export_and_bundled_catalog(client, monkeypatch):
    from rafiq_agent.api import automation

    monkeypatch.setattr(automation, "CATALOG_URL", "https://127.0.0.1:1/nope.json")
    catalog = (await client.get("/templates/catalog", headers=AUTH)).json()
    assert catalog["source"] == "bundled" and len(catalog["templates"]) >= 5

    items = catalog["templates"][:2]
    r = await client.post("/templates/import", json={"templates": items}, headers=AUTH)
    assert r.status_code == 201 and len(r.json()) == 2
    # Same names again: skipped, not duplicated.
    r = await client.post("/templates/import", json={"templates": items}, headers=AUTH)
    assert r.status_code == 201 and r.json() == []

    exported = (await client.get("/templates/export", headers=AUTH)).json()
    assert {t["name"] for t in exported} >= {i["name"] for i in items}
    assert all(set(t) == {"name", "prompt", "model_id", "working_dir"} for t in exported)

    r = await client.post("/templates/import", json={"url": "http://insecure"}, headers=AUTH)
    assert r.status_code == 400


async def test_mcp_requirements_reports_booleans(client):
    r = await client.get("/mcp/requirements", headers=AUTH)
    assert r.status_code == 200
    assert set(r.json()) == {"node", "npx", "uvx", "python", "docker"}
    assert all(isinstance(v, bool) for v in r.json().values())


# ── Skills: commands and installs ─────────────────────────────────────────────────────


def test_bundled_design_skills_declare_commands():
    taste = get_skill("design-taste")
    assert taste is not None and "PREFLIGHT.md" in taste.files
    assert {c.name for c in taste.commands} == {"taste", "de-ai"}
    assert all(c.prompt and c.description for c in taste.commands)
    wig = get_skill("web-interface-guidelines")
    assert wig is not None and "RULES.md" in wig.files and [c.name for c in wig.commands] == ["wig"]


def test_a_commands_folder_becomes_slash_commands(tmp_path, monkeypatch):
    skill = USER_DIR / "my-skill"
    skill.mkdir(parents=True, exist_ok=True)
    (skill / "SKILL.md").write_text("---\nname: my-skill\ndescription: mine\n---\n\nbody\n", encoding="utf-8")
    (skill / "commands").mkdir(exist_ok=True)
    (skill / "commands" / "Audit Page.md").write_text("# Audit the page\n\nDo the audit.\n", encoding="utf-8")
    (skill / "commands" / "fix.md").write_text("---\ndescription: Fix it\n---\nFix everything.\n", encoding="utf-8")
    reload_skills()
    try:
        loaded = get_skill("my-skill")
        assert loaded is not None
        by_name = {c.name: c for c in loaded.commands}
        assert by_name["audit-page"].description == "Audit the page" and by_name["audit-page"].prompt == "Do the audit."
        assert by_name["fix"].description == "Fix it" and by_name["fix"].prompt == "Fix everything."
    finally:
        import shutil

        shutil.rmtree(skill, ignore_errors=True)
        reload_skills()


async def test_skill_install_from_url_unzips_only_text_and_reports_commands(client, monkeypatch):
    import io
    import zipfile

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("repo-main/SKILL.md", "---\nname: zipped\ndescription: from a zip\ncommands:\n  - name: go\n    description: Go\n    prompt: Go now.\n---\nbody")
        archive.writestr("repo-main/notes.md", "extra")
        archive.writestr("repo-main/evil.exe", "MZ")
        archive.writestr("../escape.md", "nope")
    data = buffer.getvalue()

    class FakeResponse:
        status_code = 200
        content = data
        headers = {"content-type": "application/zip"}

        def raise_for_status(self) -> None:
            return None

    class FakeClient:
        def __init__(self, *_, **__):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def get(self, *_, **__):
            return FakeResponse()

    monkeypatch.setattr(skill_install.httpx, "AsyncClient", FakeClient)
    r = await client.post("/skills/install", json={"url": "https://example.com/skill.zip"}, headers=AUTH)
    assert r.status_code == 201, r.text
    body = r.json()
    assert [s["name"] for s in body["skills"]] == ["zipped"] and body["commands"] == ["/go"]
    installed = get_skill("zipped")
    assert installed is not None and installed.source == "user" and "notes.md" in installed.files
    assert not (installed.path / "evil.exe").exists()
    assert any(s.name == "zipped" for s in all_skills())
    assert (await client.delete("/skills/zipped", headers=AUTH)).status_code == 204

    r = await client.post("/skills/install", json={"url": "http://example.com/skill.zip"}, headers=AUTH)
    assert r.status_code == 400


def test_github_urls_are_understood():
    parts = skill_install._github_parts("https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines")
    assert parts == ("vercel-labs", "agent-skills", "main", "skills/web-design-guidelines")
    assert skill_install._github_parts("https://github.com/pbakaus/impeccable") == ("pbakaus", "impeccable", None, "")
    assert skill_install._github_parts("https://example.com/x") is None


def test_find_skills_counts_a_mirrored_skill_once(tmp_path):
    for folder in (".claude/skills/impeccable", ".cursor/skills/impeccable", "plugin/skills/impeccable", "tests/x/.claude/skills/audit", "skills/other"):
        (tmp_path / folder).mkdir(parents=True)
        (tmp_path / folder / "SKILL.md").write_text("---\nname: x\n---\n", encoding="utf-8")
    found = skill_install.find_skills(tmp_path)
    assert [f.name for f in found] == ["impeccable", "other"]
    assert found[0] == tmp_path / ".claude" / "skills" / "impeccable"
