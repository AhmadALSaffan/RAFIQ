"""Reading ahead for a model on this computer, so its reply starts at once.

A local model reads its prompt slowly — on a graphics card running Ollama through Vulkan,
a few dozen tokens a second — and every chat starts with ~1,200 tokens of instructions and
tool descriptions. Ollama keeps what it has read (its prompt cache), and a request that
starts the same way only reads what's new. So when a chat with a local model is opened, or
its model changes, Rafiq sends that chat's request as it stands — instructions, tools,
history — asking for a single token. By the time the message is sent, only the message
itself is left to read.

Cloud models are left alone: they cache on their own, and an extra request would cost money.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from typing import Any

log = logging.getLogger(__name__)

# The prefixes read recently (key → when), so the same chat isn't read twice in a row.
_recent: dict[str, float] = {}
_running: set[str] = set()
FRESH_FOR = 20 * 60  # Ollama keeps the model loaded for 30 minutes (core/local.py)


async def warm(model_id: str, chat_id: str | None = None, working_dir: str | None = None, workspace_id: str | None = None) -> bool:
    """Reads this chat's request ahead on its local model. True when a read was sent."""
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    from rafiq_agent.core.agent_runtime import load_settings
    from rafiq_agent.core.chat_service import ChatTurn, _turns, provider_for, settings_of, unsummarized
    from rafiq_agent.core.local import is_local
    from rafiq_agent.llm.presets import native_tools
    from rafiq_agent.schemas.chats import ReplySettings
    from rafiq_agent.storage.db import SessionLocal
    from rafiq_agent.storage.models import Chat, LlmModel

    if chat_id and chat_id in _turns:
        return False  # a reply is being written: it's reading already
    settings = await load_settings()
    async with SessionLocal() as session:
        model = await session.get(LlmModel, model_id)
        if model is None or not is_local(model.provider) or model.verify_ok is False:
            return False
        chat = None
        if chat_id:
            chat = (
                await session.execute(select(Chat).where(Chat.id == chat_id).options(selectinload(Chat.messages)))
            ).scalar_one_or_none()
            if chat is None or chat.mode in ("design", "motion"):
                return False
        turn = ChatTurn(chat_id or "warm", "", model_id, [])
        turn.reply = settings_of(chat) if chat else ReplySettings(saver=settings.token_saver)
        turn.llm = provider_for(model, turn.reply, None, work=True)
        turn.local = True
        turn.past = unsummarized(chat, chat.messages) if chat else []
        turn.summary = chat.summary if chat else None
        turn.working_dir = chat.working_dir if chat else working_dir
        turn.workspace_id = chat.workspace_id if chat else workspace_id
        turn.supports_tools = model.supports_tools
        turn.native_tools = native_tools(model.provider, model.model_id)
        turn.design_mode = turn.motion_mode = turn.design_board = False
        turn.design_files = []
        turn.settings = settings
        turn.new_attachments = []

    registry = None
    try:
        if model.provider == "ollama":
            from rafiq_agent.core.local_model import ensure_running

            if await ensure_running(model.base_url) in ("missing", "failed"):
                return False
        messages, registry = await turn._build_context()
        messages = messages[:-1]  # everything but the message that hasn't been written yet
        schemas = registry.schemas()
        key = hashlib.sha256(json.dumps([model_id, messages, schemas], ensure_ascii=False, default=str).encode()).hexdigest()
        now = time.monotonic()
        if key in _running or now - _recent.get(key, -FRESH_FOR) < FRESH_FOR:
            return False
        _running.add(key)
        try:
            await turn.llm.warm(messages, schemas)
            _recent[key] = time.monotonic()
        finally:
            _running.discard(key)
        return True
    except Exception:  # noqa: BLE001 - reading ahead is a nicety; the real send still works
        log.debug("warm-up failed", exc_info=True)
        return False
    finally:
        if registry is not None:
            await registry.aclose()


def start(model_id: str, chat_id: str | None = None, working_dir: str | None = None, workspace_id: str | None = None) -> None:
    """Reads ahead in the background (the caller doesn't wait)."""
    task: Any = asyncio.get_running_loop().create_task(warm(model_id, chat_id, working_dir, workspace_id))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


_tasks: set[Any] = set()
