"""Running one chat turn.

The route's job is HTTP; this module's job is the turn itself: load the conversation,
decide what context the model gets, run the agent loop, and turn its callbacks into the
SSE events the desktop app renders. Keeping it here means the streaming logic can be read
(and changed) without wading through routing, and the same turn could be driven by
something other than HTTP later.
"""

import asyncio
import contextlib
import json
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from rafiq_agent.core.agent_runtime import (
    build_registry,
    load_settings,
    policy_decision,
    working_dir_system_note,
)
from rafiq_agent.core.attachments import AttachmentError, build_user_content, load_attachments, meta
from rafiq_agent.core.designs import (
    DESIGN_SYSTEM_PROMPT,
    extract_preview,
    save_preview,
    skills_note,
    strip_preview,
)
from rafiq_agent.core.loop import LoopCallbacks, run_agent_loop
from rafiq_agent.core.prompts import (
    CHAT_SYSTEM_PROMPT,
    DEFAULT_TITLE,
    FOLDER_NOTE,
    ISSUES_NOTE,
    LANGUAGE_NOTES,
    LENGTH_MAX_TOKENS,
    LENGTH_NOTES,
    MAX_STORED_OUTPUT,
    SUMMARY_PROMPT,
    TASKS_NOTE,
)
from rafiq_agent.integrations.tools import issue_tools
from rafiq_agent.llm.base import LlmProvider
from rafiq_agent.llm.discovery import friendly_error, supports_vision
from rafiq_agent.schemas.chats import (
    AUTO_SUMMARIZE_AFTER,
    AUTO_SUMMARIZE_KEEP,
    ChatMessageOut,
    ReplySettings,
)
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import Chat, ChatMessage, Design, LlmModel, Task
from rafiq_agent.storage.secrets import get_api_key
from rafiq_agent.tools.base import ToolRegistry
from rafiq_agent.tools.skills import skill_tools
from rafiq_agent.tools.tasks import CreateTaskTool

MAX_TURN_ITERATIONS = 15

# Approvals waiting on the user, keyed by request id (and grouped per chat so a dropped
# stream can release them all).
_pending: dict[str, asyncio.Future[str]] = {}
_pending_by_chat: dict[str, set[str]] = {}


class ChatError(Exception):
    """Something the user should see as a message, not a stack trace."""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def now() -> datetime:
    return datetime.now(UTC)


def sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False, default=str)}\n\n"


def clip(text: str) -> str:
    return text if len(text) <= MAX_STORED_OUTPUT else text[:MAX_STORED_OUTPUT] + "\n… (مقطوع)"


def settings_of(chat: Chat) -> ReplySettings:
    return ReplySettings.model_validate(chat.settings or {})


def resolve_permission(request_id: str, resolution: str) -> bool:
    """Answers a pending approval. Returns whether anything was actually waiting."""
    future = _pending.pop(request_id, None)
    if future and not future.done():
        future.set_result(resolution)
        return True
    return False


# ── Summarising ───────────────────────────────────────────────────────────────────────


def approx_tokens(text: str) -> int:
    """Rough ~4-chars-per-token estimate. Labelled as approximate everywhere it's shown."""
    return max(1, len(text) // 4)


def transcript_of(messages: list[ChatMessage]) -> str:
    lines = []
    for m in messages:
        who = "المستخدم" if m.role == "user" else "المساعد"
        body = m.content or ""
        for a in m.attachments or []:
            body += f"\n[مرفق: {a.get('name', '')}]"
        lines.append(f"{who}: {body}".strip())
    return "\n\n".join(lines)


async def summarize(chat: Chat, messages: list[ChatMessage], llm: LlmProvider, keep: int) -> dict[str, Any]:
    """Folds everything except the last `keep` messages into chat.summary. Returns a report."""
    older = messages[: max(0, len(messages) - keep)] if keep else messages
    if not older:
        raise ChatError("المحادثة قصيرة، ما في شي يستاهل التلخيص.")

    body = transcript_of(older)
    if chat.summary:
        body = f"ملخص سابق للمحادثة:\n{chat.summary}\n\nوبعدها صار:\n{body}"
    summary = await llm.complete(
        [{"role": "system", "content": SUMMARY_PROMPT}, {"role": "user", "content": body}],
        max_tokens=700,
    )
    if not summary:
        raise ChatError("النموذج رجّع ملخص فاضي.", status=502)

    chat.summary = summary
    chat.summary_until = older[-1].id
    return {
        "summary": summary,
        "folded_messages": len(older),
        "approx_tokens_before": approx_tokens(body),
        "approx_tokens_after": approx_tokens(summary),
    }


def provider_for(model: LlmModel, reply: ReplySettings) -> LlmProvider:
    return LlmProvider(
        model.provider,
        model.model_id,
        get_api_key(model.api_key_ref),
        model.base_url,
        temperature=reply.temperature,
        max_tokens=LENGTH_MAX_TOKENS.get(reply.length),
        reasoning_effort="none" if not reply.reasoning else reply.reasoning_effort,
    )


# ── Persisting a reply ────────────────────────────────────────────────────────────────


async def save_assistant(
    chat_id: str, content: str, reasoning: str, parts: list[dict[str, Any]], model_id: str
) -> ChatMessageOut:
    """Stores the reply and, for a design chat, keeps the design's preview and spec in step."""
    async with SessionLocal() as session:
        message = ChatMessage(
            chat_id=chat_id,
            role="assistant",
            content=content,
            reasoning=reasoning or None,
            parts=parts or None,
            model_id=model_id,
        )
        session.add(message)
        chat = await session.get(Chat, chat_id)
        if chat:
            chat.updated_at = now()
        if chat and chat.mode == "design":
            await _sync_design(session, chat_id, content)
        await session.commit()
        await session.refresh(message)
        return ChatMessageOut.model_validate(message)


async def _sync_design(session: Any, chat_id: str, content: str) -> None:
    from sqlalchemy import select

    row = await session.execute(select(Design).where(Design.chat_id == chat_id))
    design = row.scalar_one_or_none()
    if not design:
        return
    html = extract_preview(content)
    if html:
        design.preview_html = html
        design.status = "ready"
        saved = save_preview(design.working_dir, design.title, html)
        if saved:
            design.saved_path = saved
    spec = strip_preview(content)
    if spec:
        design.spec = spec
    design.updated_at = now()


# ── One turn ──────────────────────────────────────────────────────────────────────────


class ChatTurn:
    """One user message and the reply it produces, as a stream of SSE lines.

    Built in three stages so each is readable on its own:
    `prepare()` touches the database, `_build_context()` decides what the model sees, and
    `stream()` runs the loop and reports it.
    """

    def __init__(self, chat_id: str, content: str, model_id: str, attachment_ids: list[str]) -> None:
        self.chat_id = chat_id
        self.content = content.strip()
        self.model_id = model_id
        self.attachment_ids = attachment_ids

        self.parts: list[dict[str, Any]] = []
        self.queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        self.saved = False

    async def prepare(self) -> None:
        """Validates the request, stores the user's message, and loads the history."""
        if not self.content and not self.attachment_ids:
            raise ChatError("الرسالة فاضية")

        try:
            self.new_attachments = await load_attachments(self.attachment_ids)
        except AttachmentError as exc:
            raise ChatError(str(exc)) from exc

        async with SessionLocal() as session:
            from sqlalchemy import select
            from sqlalchemy.orm import selectinload

            result = await session.execute(
                select(Chat).where(Chat.id == self.chat_id).options(selectinload(Chat.messages))
            )
            chat = result.scalar_one_or_none()
            if not chat:
                raise ChatError("chat not found", status=404)
            model = await session.get(LlmModel, self.model_id)
            if not model:
                raise ChatError("model not found", status=404)

            self.reply = settings_of(chat)
            self.llm = provider_for(model, self.reply)

            past = list(chat.messages)
            if self.reply.auto_summarize and len(past) > AUTO_SUMMARIZE_AFTER:
                # A failed fold must never block the message.
                with contextlib.suppress(Exception):
                    await summarize(chat, past, self.llm, AUTO_SUMMARIZE_KEEP)
            if chat.summary_until:
                cut = next((i for i, m in enumerate(past) if m.id == chat.summary_until), -1)
                past = past[cut + 1 :]

            if not past and chat.title == DEFAULT_TITLE:
                first_line = self.content.splitlines()[0] if self.content else self.new_attachments[0].name
                chat.title = first_line[:60]
            chat.model_id = model.id
            chat.updated_at = now()

            user_message = ChatMessage(
                chat_id=chat.id,
                role="user",
                content=self.content,
                attachments=[meta(a) for a in self.new_attachments] or None,
            )
            session.add(user_message)
            await session.commit()
            await session.refresh(user_message)

            self.past = past
            self.summary = chat.summary
            self.user_out = ChatMessageOut.model_validate(user_message)
            self.title = chat.title
            self.working_dir = chat.working_dir
            self.supports_tools = model.supports_tools
            self.design_mode = chat.mode == "design"

    async def _history(self) -> list[dict[str, Any]]:
        vision = supports_vision(self.llm.model)
        ids = [a["id"] for m in self.past for a in (m.attachments or [])]
        try:
            by_id = {a.id: a for a in await load_attachments(ids)}
        except AttachmentError:
            by_id = {}

        history: list[dict[str, Any]] = []
        for m in self.past:
            if m.role == "user":
                files = [by_id[a["id"]] for a in (m.attachments or []) if a["id"] in by_id]
                history.append({"role": "user", "content": build_user_content(m.content, files, vision)})
            elif m.content:
                history.append({"role": "assistant", "content": m.content})
        return history

    def _system_prompt(self) -> str:
        system = DESIGN_SYSTEM_PROMPT if self.design_mode else CHAT_SYSTEM_PROMPT
        for note in (LENGTH_NOTES.get(self.reply.length, ""), LANGUAGE_NOTES.get(self.reply.language, "")):
            if note:
                system += f" {note}"
        if self.summary:
            system += (
                f"\n\nملخص اللي صار قبل بهالمحادثة (الرسائل القديمة انطوت لتوفير التوكنز):\n{self.summary}"
            )
        return system

    def _tools(self, system: str) -> tuple[ToolRegistry, str]:
        """The tools this turn gets, plus the notes that explain them to the model."""
        registry = ToolRegistry()
        if self.supports_tools is False or not self.reply.tools:
            return registry, system

        # Skills are read through ordinary tool calls, so every provider can use them.
        for tool in skill_tools():
            registry.register(tool)
        system += f"\n\n{skills_note()}"

        if self.working_dir:
            registry = build_registry(Path(self.working_dir))
            system += f"\n\n{FOLDER_NOTE}\n{working_dir_system_note(Path(self.working_dir))}"
        else:
            for tool in issue_tools():  # trackers work with or without a folder
                registry.register(tool)
        registry.register(
            CreateTaskTool(self.model_id, self.working_dir, {"chat_id": self.chat_id}, self._on_task_created)
        )
        system += f"\n\n{TASKS_NOTE}\n\n{ISSUES_NOTE}"
        return registry, system

    async def _build_context(self) -> tuple[list[dict[str, Any]], ToolRegistry]:
        history = await self._history()
        system = self._system_prompt()
        registry, system = self._tools(system)
        vision = supports_vision(self.llm.model)
        messages = [
            {"role": "system", "content": system},
            *history,
            {"role": "user", "content": build_user_content(self.content, self.new_attachments, vision)},
        ]
        return messages, registry

    # ── Loop callbacks: each one updates the stored parts and emits an event ──────────

    def _find_part(self, part_id: str) -> dict[str, Any] | None:
        return next((p for p in self.parts if p.get("id") == part_id), None)

    async def _on_task_created(self, task: Task) -> None:
        self.parts.append({"kind": "task", "task_id": task.id, "title": task.title})
        await self.queue.put(
            {"type": "task_created", "task": {"id": task.id, "title": task.title, "status": task.status}}
        )

    async def _on_text_delta(self, text: str) -> None:
        if self.parts and self.parts[-1]["kind"] == "text":
            self.parts[-1]["text"] += text
        else:
            self.parts.append({"kind": "text", "text": text})
        await self.queue.put({"type": "delta", "text": text})

    async def _on_reasoning_delta(self, text: str) -> None:
        await self.queue.put({"type": "reasoning", "text": text})

    async def _on_tool_call(self, call_id: str, name: str, _category: str, args: dict[str, Any]) -> None:
        if name == "create_task":
            return  # shown as a task card instead of a raw tool step
        self.parts.append({"kind": "tool", "id": call_id, "tool": name, "args": args})
        await self.queue.put({"type": "tool_call", "id": call_id, "tool": name, "args": args})

    async def _on_tool_result(self, call_id: str, name: str, ok: bool, output: str) -> None:
        if name == "create_task" and ok:
            return
        part = self._find_part(call_id)
        if part is None:  # denied before running — no tool_call part exists yet
            part = {"kind": "tool", "id": call_id, "tool": name, "args": {}}
            self.parts.append(part)
            await self.queue.put({"type": "tool_call", "id": call_id, "tool": name, "args": {}})
        part.update(ok=ok, output=clip(output))
        await self.queue.put({"type": "tool_result", "id": call_id, "ok": ok, "output": clip(output)})

    async def _permit(self, name: str, category: str, args: dict[str, Any]) -> bool:
        decision = policy_decision(name, category, self.settings.permissions)
        if decision != "ask":
            return decision == "allow"

        request_id = uuid.uuid4().hex[:12]
        call = {"tool": name, "category": category, "args": args}
        self.parts.append({"kind": "permission", "id": request_id, "call": call, "resolution": "pending"})
        future: asyncio.Future[str] = asyncio.get_running_loop().create_future()
        _pending[request_id] = future
        _pending_by_chat.setdefault(self.chat_id, set()).add(request_id)
        await self.queue.put({"type": "permission", "id": request_id, "call": call})
        try:
            resolution = await future
        finally:
            _pending_by_chat.get(self.chat_id, set()).discard(request_id)
        part = self._find_part(request_id)
        if part:
            part["resolution"] = resolution
        await self.queue.put({"type": "permission_resolved", "id": request_id, "resolution": resolution})
        return resolution == "approved"

    # ── Running ──────────────────────────────────────────────────────────────────────

    def _text_so_far(self) -> str:
        return "".join(p.get("text", "") for p in self.parts if p["kind"] == "text")

    async def _run(self, messages: list[dict[str, Any]], registry: ToolRegistry) -> None:
        try:
            result = await run_agent_loop(
                self.llm,
                messages,
                registry,
                LoopCallbacks(
                    permit=self._permit,
                    on_text_delta=self._on_text_delta,
                    on_reasoning_delta=self._on_reasoning_delta,
                    on_tool_call=self._on_tool_call,
                    on_tool_result=self._on_tool_result,
                ),
                max_iterations=MAX_TURN_ITERATIONS,
            )
            if result.status == "empty":
                # The model ended its turn without writing anything — say so instead of
                # leaving the UI on a spinner forever.
                await self.queue.put(
                    {
                        "type": "error",
                        "message": "النموذج رجّع رد فاضي. جرّب ابعت «أكمل» أو بدّل النموذج — "
                        "بعض النماذج بتقصّر لما يوصلها سياق كبير.",
                    }
                )
            saved = await save_assistant(
                self.chat_id, result.text, result.reasoning, self.parts, self.model_id
            )
            self.saved = True
            await self.queue.put({"type": "done", "message": saved.model_dump()})
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - provider failures are reported in-stream
            text = self._text_so_far()
            if text or self.parts:
                await save_assistant(self.chat_id, text, "", self.parts, self.model_id)
                self.saved = True
            await self.queue.put({"type": "error", "message": friendly_error(exc)})
        finally:
            await self.queue.put(None)

    def _release_pending(self) -> None:
        """The user stopped or closed the window: treat open approvals as denied."""
        for request_id in list(_pending_by_chat.pop(self.chat_id, set())):
            future = _pending.pop(request_id, None)
            if future and not future.done():
                future.set_result("denied")

    async def stream(self) -> AsyncIterator[str]:
        messages, registry = await self._build_context()
        self.settings = await load_settings()

        yield sse({"type": "start", "user_message": self.user_out.model_dump(), "title": self.title})
        worker = asyncio.create_task(self._run(messages, registry))
        try:
            while (item := await self.queue.get()) is not None:
                yield sse(item)
        except (asyncio.CancelledError, GeneratorExit):
            self._release_pending()
            worker.cancel()
            text = self._text_so_far()
            if (text or self.parts) and not self.saved:
                # Keep whatever was produced, so the history stays honest.
                await asyncio.shield(save_assistant(self.chat_id, text, "", self.parts, self.model_id))
            raise
