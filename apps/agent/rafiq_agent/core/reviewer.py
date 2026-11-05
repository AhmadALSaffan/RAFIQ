"""Smart approvals: a second model looks at a step before the user is asked about it.

When a tool call would ask for permission, and the user turned this on, a reviewer model reads
what the user asked for and the exact call (the command, or the diff of a file write). If the
step plainly serves the request and can't do lasting damage, it runs without the card, and the
transcript shows it was reviewed and why. Anything else still asks, with the reviewer's reason
on the card.

It only ever turns "ask" into "allow": a group set to "deny" stays denied, and so does anything
that leaves the machine or can't be taken back (publishing, messages to a team, the desktop,
MCP tools, paid media, the spending cap). Deleting files and killing processes always ask, and
a short list of commands is called risky before any model sees them. When the reviewer can't
be reached or answers anything but the expected JSON, the user is asked: it fails closed.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import re
from dataclasses import dataclass
from typing import Any, Literal

log = logging.getLogger(__name__)

# Permission groups a reviewer may clear. Everything else always reaches the user.
REVIEWABLE = frozenset({"filesystem_write", "shell", "notes", "notes_new", "memory", "task_create"})
# Tools inside those groups that always ask anyway: they can't be taken back.
ALWAYS_ASK = frozenset({"filesystem_delete", "process_kill"})
TIMEOUT_SECONDS = 25
MAX_ARGS = 6000

# Commands called risky before any model looks at them.
RISKY_COMMAND = re.compile(
    r"""(
        \brm\s+-[a-z]*[rf]       # rm -rf / rm -f
      | \brmdir\s+/s | \bdel\s+/[sqf] | \berase\b | \bformat\s+[a-z]:
      | \bRemove-Item\b.*-Recurse
      | \bshutdown\b | \brestart-computer\b | \bstop-computer\b
      | \bgit\s+push\b | \bgit\s+reset\s+--hard | \bgit\s+clean\s+-[a-z]*f | \bgit\s+checkout\s+--\s
      | \b(curl|wget|iwr|invoke-webrequest)\b.*\|\s*(sh|bash|iex|powershell|python)
      | \breg\s+(add|delete)\b | \bSet-ItemProperty\b.*HKLM
      | \bnet\s+user\b | \bnetsh\b | \bsc\s+(delete|config)\b | \bschtasks\b
      | \bchmod\s+-R\s+777 | \bsudo\b | \brunas\b | \bmkfs | \bdd\s+if=
      | \bnpm\s+publish\b | \bpip\s+install\s+--user | \bsetx\b
    )""",
    re.I | re.X,
)

PROMPT = """You review one step an AI assistant wants to take on the user's computer, before it runs.

Answer "safe" only when BOTH are true:
1. The step plainly serves what the user asked for (below), not something else.
2. It can't do lasting damage: no deleting or overwriting the user's work beyond what was asked,
   no secrets or personal data sent anywhere, no system settings, installs outside the project,
   or anything hard to undo.

Otherwise answer "risky". When unsure, answer "risky": the user is simply asked, nothing is lost.

Reply with JSON only, no other text:
{"verdict": "safe" or "risky", "reason": "one short sentence for the user, in LANGUAGE"}
"""

LANGUAGES = {"ar": "Levantine Arabic", "en": "English", "ru": "Russian"}


@dataclass
class Review:
    verdict: Literal["safe", "risky"] | None
    reason: str = ""


def reviewable(tool_name: str, permission_key: str) -> bool:
    return permission_key in REVIEWABLE and tool_name not in ALWAYS_ASK


def pre_check(tool_name: str, args: dict[str, Any]) -> Review | None:
    """A verdict without any model, when the call alone settles it."""
    from rafiq_agent.i18n import tr

    if tool_name in ALWAYS_ASK:
        return Review("risky", tr("ما بيترجع: لازم تقرّر إنت."))
    text = " ".join(str(args.get(k) or "") for k in ("command", "script"))
    if tool_name == "shell_run" and RISKY_COMMAND.search(text):
        return Review("risky", tr("الأمر فيه شي ممكن ما يترجع أو بيطلع برّا المشروع."))
    return None


def parse(reply: str) -> Review:
    """The reviewer's JSON, or no verdict at all (the user is then asked)."""
    match = re.search(r"\{.*\}", reply or "", re.S)
    if not match:
        return Review(None)
    try:
        data = json.loads(match.group(0))
    except ValueError:
        return Review(None)
    verdict = data.get("verdict") if isinstance(data, dict) else None
    reason = str(data.get("reason") or "").strip()[:300] if isinstance(data, dict) else ""
    if verdict not in ("safe", "risky"):
        return Review(None)
    return Review(verdict, reason)


def _describe(tool_name: str, args: dict[str, Any], preview: str | None) -> str:
    shown = {k: v for k, v in args.items() if k != "content"}
    if "content" in args and not preview:
        shown["content"] = str(args["content"])[:2000]
    text = f"Tool: {tool_name}\nArguments: {json.dumps(shown, ensure_ascii=False)[:MAX_ARGS]}"
    if preview:
        text += f"\nWhat would change (diff):\n{preview[:MAX_ARGS]}"
    return text


async def _reviewer_llm(fallback_model_id: str | None):
    """The reviewer: the model picked for it, else the helper, else the cheap model, else the
    run's own model."""
    from rafiq_agent.auth.resolve import llm_for
    from rafiq_agent.core.agent_runtime import load_settings
    from rafiq_agent.storage.db import SessionLocal
    from rafiq_agent.storage.models import LlmModel

    settings = await load_settings()
    async with SessionLocal() as session:
        for wanted in (settings.reviewer_model_id, settings.helper_model_id, settings.cheap_model_id, fallback_model_id):
            if not wanted:
                continue
            model = await session.get(LlmModel, wanted)
            if model is not None and model.verify_ok is not False:
                return llm_for(model)
    return None


async def review(
    tool_name: str,
    args: dict[str, Any],
    preview: str | None,
    goal: str,
    fallback_model_id: str | None = None,
) -> Review:
    """The reviewer's verdict on one call. Never raises: anything going wrong is no verdict."""
    from rafiq_agent.i18n import current_locale

    early = pre_check(tool_name, args)
    if early is not None:
        return early
    try:
        llm = await _reviewer_llm(fallback_model_id)
    except Exception:  # noqa: BLE001
        log.warning("reviewer: no model", exc_info=True)
        return Review(None)
    if llm is None:
        return Review(None)
    language = LANGUAGES.get(current_locale(), "Levantine Arabic")
    messages = [
        {"role": "system", "content": PROMPT.replace("LANGUAGE", language)},
        {"role": "user", "content": f"What the user asked for:\n{goal.strip()[:3000] or '(not given)'}\n\nThe step:\n{_describe(tool_name, args, preview)}"},
    ]
    try:
        reply = await asyncio.wait_for(llm.complete(messages, max_tokens=200), timeout=TIMEOUT_SECONDS)
    except Exception:  # noqa: BLE001 - a slow or failing reviewer means the user decides
        log.warning("reviewer: no answer", exc_info=True)
        return Review(None)
    finally:
        with contextlib.suppress(Exception):
            await llm.aclose()
    return parse(reply)
