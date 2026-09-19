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

from rafiq_agent.auth.resolve import helper_llm, llm_for
from rafiq_agent.core.agent_runtime import (
    build_registry,
    load_settings,
    policy_decision,
    working_dir_system_note,
)
from rafiq_agent.core.attachments import AttachmentError, build_user_content, load_attachments, meta
from rafiq_agent.core.designs import (
    DESIGN_SYSTEM_PROMPT,
    extract_previews,
    merge_files,
    save_preview,
    skills_note,
    strip_preview,
)
from rafiq_agent.core.loop import LoopCallbacks, run_agent_loop
from rafiq_agent.core.memory import memory_note
from rafiq_agent.core.project_notes import project_instructions
from rafiq_agent.core.prompts import (
    BROWSER_NOTE,
    CHAT_SYSTEM_PROMPT,
    DEFAULT_TITLE,
    ECONOMY_NOTE,
    FOLDER_NOTE,
    ISSUES_NOTE,
    LANGUAGE_NOTES,
    LENGTH_MAX_TOKENS,
    LENGTH_NOTES,
    MAX_STORED_OUTPUT,
    MCP_NOTE,
    MEMORY_NOTE,
    RAFIQ_WEB_TOOLS_NOTE,
    SUMMARY_PROMPT,
    TASKS_NOTE,
    WEB_NOTE,
)
from rafiq_agent.i18n import all_translations, tr
from rafiq_agent.llm import usage
from rafiq_agent.llm.base import LlmProvider
from rafiq_agent.llm.discovery import friendly_error, supports_vision
from rafiq_agent.llm.presets import native_tools
from rafiq_agent.schemas.chats import (
    AUTO_SUMMARIZE_AFTER,
    AUTO_SUMMARIZE_KEEP,
    AUTO_SUMMARIZE_TOKENS,
    ChatMessageOut,
    ReplySettings,
)
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import Chat, ChatMessage, Design, LlmModel, Task
from rafiq_agent.tools.base import ToolRegistry
from rafiq_agent.tools.memory import MemorySaveTool
from rafiq_agent.tools.tasks import CreateTasksTool, WaitForTasksTool

# Steps per reply. Waiting on tasks is one step however long it takes, and a whole batch of
# tasks is created in one call.
MAX_TURN_ITERATIONS = 25
TASK_TOOLS = frozenset({"create_tasks", "create_task"})  # create_task: transcripts from before batching

# Approvals waiting on the user, keyed by request id (and grouped per chat so stopping a
# reply can release them all).
_pending: dict[str, asyncio.Future[str]] = {}
_pending_by_chat: dict[str, set[str]] = {}

# Replies being written right now, one per chat. They run on their own — leaving the chat
# page doesn't stop them — and whoever opens the chat again reattaches to the live one.
_turns: dict[str, "ChatTurn"] = {}


def active_turn(chat_id: str) -> "ChatTurn | None":
    return _turns.get(chat_id)


def stop_turn(chat_id: str) -> bool:
    """Stops the reply being written in this chat. Returns whether there was one."""
    turn = _turns.get(chat_id)
    if turn is None:
        return False
    turn.stop()
    return True


async def stop_all_turns() -> None:
    """App shutdown: stop every reply and let each save what it has."""
    turns = list(_turns.values())
    for turn in turns:
        turn.stop()
    workers = [t.worker for t in turns if t.worker is not None]
    if workers:
        await asyncio.wait(workers, timeout=5)


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
    return text if len(text) <= MAX_STORED_OUTPUT else text[:MAX_STORED_OUTPUT] + tr("\n… (مقطوع)")


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
        raise ChatError(tr("المحادثة قصيرة، ما في شي يستاهل التلخيص."))

    body = transcript_of(older)
    if chat.summary:
        body = f"ملخص سابق للمحادثة:\n{chat.summary}\n\nوبعدها صار:\n{body}"
    # Folding a chat is a chore, not a conversation: it runs on the helper model when the
    # user picked one, so a long history isn't summarised at the expensive model's price.
    llm = await helper_llm(llm) or llm
    summary = await llm.complete(
        [{"role": "system", "content": SUMMARY_PROMPT}, {"role": "user", "content": body}],
        max_tokens=700,
    )
    if not summary:
        raise ChatError(tr("النموذج رجّع ملخص فاضي."), status=502)

    chat.summary = summary
    chat.summary_until = older[-1].id
    return {
        "summary": summary,
        "folded_messages": len(older),
        "approx_tokens_before": approx_tokens(body),
        "approx_tokens_after": approx_tokens(summary),
    }


def provider_for(model: LlmModel, reply: ReplySettings, fallback: LlmModel | None = None) -> LlmProvider:
    return llm_for(
        model,
        temperature=reply.temperature,
        max_tokens=LENGTH_MAX_TOKENS.get(reply.length),
        reasoning_effort="none" if not reply.reasoning else reply.reasoning_effort,
        fallback=fallback,
    )


async def fallback_of(session: Any, model: LlmModel) -> LlmModel | None:
    return await session.get(LlmModel, model.fallback_model_id) if model.fallback_model_id else None


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
    fresh = extract_previews(content, design.title)
    if fresh:
        files = merge_files(design.files, fresh)
        # Each document keeps its own file on disk, named after it.
        for item in files:
            if any(item["name"] == f["name"] for f in fresh):
                path = save_preview(design.working_dir, item["name"], item["html"])
                if path:
                    item["path"] = path
        design.files = files
        design.preview_html = fresh[-1]["html"]
        design.status = "ready"
        last = next((f for f in files if f["name"] == fresh[-1]["name"]), None)
        if last and last.get("path"):
            design.saved_path = last["path"]
    spec = strip_preview(content)
    if spec:
        design.spec = spec
    design.updated_at = now()


# ── One turn ──────────────────────────────────────────────────────────────────────────


class ChatTurn:
    """One user message and the reply it produces.

    Built in stages so each is readable on its own: `prepare()` touches the database,
    `_build_context()` decides what the model sees, `start()` runs the loop in the
    background, and `subscribe()` streams its events as SSE lines — from the beginning, so a
    page that reopens the chat mid-reply catches up. Closing a stream never stops the reply;
    only `stop()` does.
    """

    def __init__(self, chat_id: str, content: str, model_id: str, attachment_ids: list[str]) -> None:
        self.chat_id = chat_id
        self.content = content.strip()
        self.model_id = model_id
        self.attachment_ids = attachment_ids

        self.parts: list[dict[str, Any]] = []
        self.events: list[dict[str, Any]] = []
        self.listeners: set[asyncio.Queue[dict[str, Any] | None]] = set()
        self.ended = False
        self.saved = False
        self.worker: asyncio.Task | None = None
        self.created_task_ids: list[str] = []
        self.native_tools: frozenset[str] = frozenset()

    async def prepare(self) -> None:
        """Claims the chat for this reply, then validates and stores the user's message."""
        if self.chat_id in _turns:
            raise ChatError(tr("في رد لسا عم ينكتب بهالمحادثة — استنى يخلص أو وقّفه."), status=409)
        _turns[self.chat_id] = self
        try:
            await self._prepare()
        except BaseException:
            if _turns.get(self.chat_id) is self:
                del _turns[self.chat_id]
            raise

    async def _prepare(self) -> None:
        if not self.content and not self.attachment_ids:
            raise ChatError(tr("الرسالة فاضية"))

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
            self.llm = provider_for(model, self.reply, await fallback_of(session, model))

            past = list(chat.messages)
            heavy = approx_tokens(transcript_of(past)) > AUTO_SUMMARIZE_TOKENS
            if self.reply.auto_summarize and past and (len(past) > AUTO_SUMMARIZE_AFTER or heavy):
                # A failed fold must never block the message.
                with contextlib.suppress(Exception):
                    await summarize(chat, past, self.llm, AUTO_SUMMARIZE_KEEP)
            if chat.summary_until:
                cut = next((i for i, m in enumerate(past) if m.id == chat.summary_until), -1)
                past = past[cut + 1 :]

            if not past and chat.title in all_translations(DEFAULT_TITLE):
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
            self.workspace_id = chat.workspace_id
            self.supports_tools = model.supports_tools
            # Tools this model already has of its own — Rafiq won't offer a second one.
            self.native_tools = native_tools(model.provider, model.model_id)
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

    def _groups(self) -> frozenset[str]:
        """Which tool families this turn is allowed to describe to the model. Every family
        left out is a schema nobody pays for (see docs/TOKENS.md)."""
        if self.reply.economy or not self.reply.tools:
            return frozenset()
        groups = {"files", "web", "issues", "skills", "desktop"}
        if self.reply.browser:
            groups.add("browser")
        if self.reply.mcp:
            groups.add("mcp")
        return frozenset(groups)

    async def _tools(self, system: str) -> tuple[ToolRegistry, str]:
        """The tools this turn gets, plus the notes that explain them to the model."""
        if self.working_dir and (notes := project_instructions(self.working_dir)):
            system += f"\n\n{notes}"
        if self.reply.economy:
            return ToolRegistry(), f"{system}\n\n{ECONOMY_NOTE}"
        if self.supports_tools is False or not self.reply.tools:
            return ToolRegistry(), system

        # Skills are read through ordinary tool calls, so every provider can use them.
        folder = Path(self.working_dir) if self.working_dir else None
        # Tools the model brings itself — minus any the user explicitly asked Rafiq to
        # provide anyway, plus any they switched off for this chat.
        skip = set(self.native_tools)
        if self.reply.web_search is True:
            skip.discard("web_search")
        elif self.reply.web_search is False:
            skip.add("web_search")
        registry = await build_registry(folder, self.settings, frozenset(skip), self._groups())

        # Each note is only worth sending when the tools it describes are actually there.
        names = registry.names()
        notes = []
        # A design session lives on its skills, and a user who turned the saver off asked
        # for the same thing: describe them all, not just their names.
        full_skills = self.design_mode or not self.reply.saver
        if any(n.startswith("skill_") for n in names) and (skills := skills_note(full_skills)):
            notes.append(skills)
        if folder is not None and "shell_run" in names:
            notes.append(f"{FOLDER_NOTE}\n{working_dir_system_note(folder)}")
        registry.register(
            CreateTasksTool(
                await self._task_model(), self.working_dir, {"chat_id": self.chat_id}, self._on_task_created
            )
        )
        registry.register(WaitForTasksTool(lambda: list(self.created_task_ids)))
        notes.append(TASKS_NOTE)
        if any(n.startswith("issue_") for n in names):
            notes.append(ISSUES_NOTE)
        if any(n.startswith("browser_") for n in names):
            notes.append(BROWSER_NOTE)
        if any(n.startswith("mcp__") for n in names):
            notes.append(MCP_NOTE)
        if "web_fetch" in names or "web_search" in names or "web_fetch" in self.native_tools:
            notes.append(WEB_NOTE)
        # Only mention Rafiq's web tools to a model that was actually given them.
        if "web_fetch" in names:
            notes.append(RAFIQ_WEB_TOOLS_NOTE)
        if self.settings.memory_enabled:
            registry.register(MemorySaveTool(self.chat_id))
            notes.append(MEMORY_NOTE)
        return registry, system + "".join(f"\n\n{n}" for n in notes)

    async def _task_model(self) -> str:
        """Who carries out the tasks this chat creates: the model set for tasks in Settings
        (if it still exists and works), otherwise the chat's own."""
        chosen = self.settings.task_model_id
        if chosen and chosen != self.model_id:
            async with SessionLocal() as session:
                model = await session.get(LlmModel, chosen)
            if model is not None and model.verify_ok is not False:
                return model.id
        return self.model_id

    async def _standing_notes(self) -> str:
        """What the user asked Rafiq to remember, and the workspace's own instructions."""
        notes = []
        if self.settings.memory_enabled and (memories := await memory_note()):
            notes.append(memories)
        if getattr(self, "workspace_id", None):
            from rafiq_agent.api.workspaces import workspace_note

            if note := await workspace_note(self.workspace_id):
                notes.append(note)
        return "".join(f"\n\n{n}" for n in notes)

    async def _build_context(self) -> tuple[list[dict[str, Any]], ToolRegistry]:
        history = await self._history()
        system = self._system_prompt() + await self._standing_notes()
        registry, system = await self._tools(system)
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

    def _emit(self, item: dict[str, Any]) -> None:
        """Records an event and hands it to every page watching this reply."""
        self.events.append(item)
        for listener in self.listeners:
            listener.put_nowait(item)

    async def _on_task_created(self, task: Task) -> None:
        self.created_task_ids.append(task.id)
        self.parts.append({"kind": "task", "task_id": task.id, "title": task.title})
        self._emit({"type": "task_created", "task": {"id": task.id, "title": task.title, "status": task.status}})

    async def _on_text_delta(self, text: str) -> None:
        if self.parts and self.parts[-1]["kind"] == "text":
            self.parts[-1]["text"] += text
        else:
            self.parts.append({"kind": "text", "text": text})
        self._emit({"type": "delta", "text": text})

    async def _on_reasoning_delta(self, text: str) -> None:
        self._emit({"type": "reasoning", "text": text})

    async def _on_tool_call(self, call_id: str, name: str, _category: str, args: dict[str, Any]) -> None:
        if name in TASK_TOOLS:
            return  # shown as task cards instead of a raw tool step
        self.parts.append({"kind": "tool", "id": call_id, "tool": name, "args": args})
        self._emit({"type": "tool_call", "id": call_id, "tool": name, "args": args})

    async def _on_tool_result(self, call_id: str, name: str, ok: bool, output: str) -> None:
        if name in TASK_TOOLS and ok:
            return
        part = self._find_part(call_id)
        if part is None:  # denied before running — no tool_call part exists yet
            part = {"kind": "tool", "id": call_id, "tool": name, "args": {}}
            self.parts.append(part)
            self._emit({"type": "tool_call", "id": call_id, "tool": name, "args": {}})
        part.update(ok=ok, output=clip(output))
        self._emit({"type": "tool_result", "id": call_id, "ok": ok, "output": clip(output)})

    async def _permit(
        self, name: str, category: str, args: dict[str, Any], preview: str | None = None
    ) -> bool:
        decision = policy_decision(name, category, self.settings.permissions)
        if decision != "ask":
            return decision == "allow"

        request_id = uuid.uuid4().hex[:12]
        call: dict[str, Any] = {"tool": name, "category": category, "args": args}
        if preview:
            call["preview"] = preview
        self.parts.append({"kind": "permission", "id": request_id, "call": call, "resolution": "pending"})
        future: asyncio.Future[str] = asyncio.get_running_loop().create_future()
        _pending[request_id] = future
        _pending_by_chat.setdefault(self.chat_id, set()).add(request_id)
        self._emit({"type": "permission", "id": request_id, "call": call})
        try:
            resolution = await future
        finally:
            _pending_by_chat.get(self.chat_id, set()).discard(request_id)
        part = self._find_part(request_id)
        if part:
            part["resolution"] = resolution
        self._emit({"type": "permission_resolved", "id": request_id, "resolution": resolution})
        return resolution == "approved"

    # ── Running ──────────────────────────────────────────────────────────────────────

    def _emit_usage(self, spent: Any) -> None:
        """What this reply cost, so the number is in front of the person who pays it."""
        total = spent.total()
        if not total:
            return
        self._emit(
            {
                "type": "usage",
                "prompt_tokens": total.prompt_tokens,
                "completion_tokens": total.completion_tokens,
                "cached_tokens": total.cached_tokens,
                "cost_usd": round(total.cost_usd, 6),
            }
        )

    def _text_so_far(self) -> str:
        return "".join(p.get("text", "") for p in self.parts if p["kind"] == "text")

    async def _run(self, messages: list[dict[str, Any]], registry: ToolRegistry) -> None:
        # Everything this turn spends is counted against the chat (see llm/usage.py).
        usage.scope("chat", self.chat_id, self.model_id).apply()
        spent = usage.collect()
        spent.__enter__()
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
                self._emit(
                    {
                        "type": "error",
                        "message": tr(
                            "النموذج رجّع رد فاضي. جرّب ابعت «أكمل» أو بدّل النموذج — بعض النماذج بتقصّر لما يوصلها سياق كبير."
                        ),
                    }
                )
            saved = await save_assistant(
                self.chat_id, result.text, result.reasoning, self.parts, self.model_id
            )
            self.saved = True
            self._emit_usage(spent)
            self._emit({"type": "done", "message": saved.model_dump()})
        except asyncio.CancelledError:
            # Stopped (by the user, or the app closing): keep whatever was produced, so the
            # history stays honest. The stop was asked for, so it ends the reply quietly.
            await self._save_partial()
        except Exception as exc:  # noqa: BLE001 - provider failures are reported in-stream
            text = self._text_so_far()
            if text or self.parts:
                await save_assistant(self.chat_id, text, "", self.parts, self.model_id)
                self.saved = True
            self._emit({"type": "error", "message": friendly_error(exc)})
        finally:
            spent.__exit__(None, None, None)
            await registry.aclose()  # the turn's browser tab, its hold on the desktop
            self._end()

    async def _save_partial(self) -> None:
        if self.saved:
            return
        self.saved = True
        text = self._text_so_far()
        if not text and not self.parts:
            self._emit({"type": "stopped"})
            return
        parts = [
            {**p, "resolution": "denied"} if p["kind"] == "permission" and p.get("resolution") == "pending" else p
            for p in self.parts
        ]
        saved = await asyncio.shield(save_assistant(self.chat_id, text, "", parts, self.model_id))
        self._emit({"type": "done", "message": saved.model_dump()})

    def _end(self) -> None:
        self.ended = True
        for listener in self.listeners:
            listener.put_nowait(None)
        if _turns.get(self.chat_id) is self:
            del _turns[self.chat_id]

    def _release_pending(self) -> None:
        """The reply was stopped: treat open approvals as denied."""
        for request_id in list(_pending_by_chat.pop(self.chat_id, set())):
            future = _pending.pop(request_id, None)
            if future and not future.done():
                future.set_result("denied")

    def stop(self) -> None:
        self._release_pending()
        if self.worker is not None and not self.worker.done():
            self.worker.cancel()

    async def start(self) -> None:
        """Builds the context and starts the reply in the background."""
        try:
            self.settings = await load_settings()
            messages, registry = await self._build_context()
        except BaseException:
            self._end()
            raise
        self._emit({"type": "start", "user_message": self.user_out.model_dump(), "title": self.title})
        self.worker = asyncio.create_task(self._run(messages, registry))
        self.worker.add_done_callback(self._on_worker_done)

    def _on_worker_done(self, _: asyncio.Task) -> None:
        # Stopped before it even began: _run's own cleanup never ran, so close up here.
        if not self.ended:
            if not self.saved:
                self._emit({"type": "stopped"})
            self._end()

    async def subscribe(self) -> AsyncIterator[str]:
        """The reply's events as SSE lines: everything so far, then live until it ends.
        Leaving (the page closes the stream) only stops the watching, never the reply."""
        queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        for item in self.events:
            queue.put_nowait(item)
        if self.ended:
            queue.put_nowait(None)
        self.listeners.add(queue)
        try:
            while (item := await queue.get()) is not None:
                yield sse(item)
        finally:
            self.listeners.discard(queue)
