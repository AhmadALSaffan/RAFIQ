"""GitHub Copilot through the official Copilot SDK (`github-copilot-sdk`).

Copilot runs its own agent loop; Rafiq already has one, with permissions, tool cards and
events. `CopilotProvider` bridges the two instead of replacing either:

* Copilot's built-in tools are all switched off — it only sees Rafiq's tools.
* When Copilot calls one, the SDK invokes our handler, which parks the call on a future
  and surfaces it to `run_agent_loop` as an ordinary tool call. The loop asks permission,
  runs the tool and appends the result; the next `stream_chat` resolves the future and
  Copilot carries on in the same session.

So a Copilot agent is gated by exactly the same policy as every other model.

Isolation: one runtime client per connected account, each with its own `COPILOT_HOME`
under Rafiq's data dir and `use_logged_in_user=False` — no shared login state, and a
fresh Copilot session for every run, so agents never see each other's conversations.

The SDK is optional. Nothing here imports it at module load; if it is missing, Copilot
shows as unavailable and the rest of Rafiq is untouched.
"""

import asyncio
import contextlib
import hashlib
import importlib.util
import json
from collections.abc import AsyncIterator
from typing import Any

from rafiq_agent.auth.base import AuthError, redact
from rafiq_agent.config import DATA_DIR
from rafiq_agent.i18n import tr
from rafiq_agent.llm.base import StreamEvent, ToolCallDelta

# How long to keep listening for sibling tool calls once the first one arrives — models
# often request several in parallel and the loop should run them as one step.
_TOOL_BATCH_WINDOW = 0.25


def sdk_available() -> bool:
    return importlib.util.find_spec("copilot") is not None


# ── Runtime clients, one per account ─────────────────────────────────────────────────

_clients: dict[str, Any] = {}
_client_keys: dict[str, str] = {}
_lock = asyncio.Lock()


def _home(account_id: str) -> str:
    path = DATA_DIR / "copilot" / account_id
    path.mkdir(parents=True, exist_ok=True)
    return str(path)


async def _new_client(token: str, home: str) -> Any:
    from copilot import CopilotClient

    # The constructor may download the pinned runtime on first use (blocking I/O).
    client = await asyncio.to_thread(
        lambda: CopilotClient(
            github_token=token,
            use_logged_in_user=False,
            base_directory=home,
            log_level="error",
            session_idle_timeout_seconds=900,
            client_info={"application_name": "rafiq"},
        )
    )
    await client.start()
    return client


async def client_for(account_id: str, token: str) -> Any:
    """The running client for this account, restarted if its token changed."""
    key = hashlib.sha256(token.encode()).hexdigest()
    async with _lock:
        current = _clients.get(account_id)
        if current is not None and _client_keys.get(account_id) == key:
            return current
        if current is not None:
            with contextlib.suppress(Exception):
                await current.stop()
        client = await _new_client(token, _home(account_id))
        _clients[account_id] = client
        _client_keys[account_id] = key
        return client


async def drop_client(account_id: str) -> None:
    async with _lock:
        client = _clients.pop(account_id, None)
        _client_keys.pop(account_id, None)
    if client is not None:
        with contextlib.suppress(Exception):
            await client.stop()


async def shutdown_all() -> None:
    for account_id in list(_clients):
        await drop_client(account_id)


async def check_token(token: str) -> None:
    """Confirms a freshly issued token can actually use Copilot, before it is saved."""
    if not sdk_available():
        raise AuthError(tr("مكتبة GitHub Copilot مش مثبّتة بهالنسخة."))
    client = await _new_client(token, _home("_check"))
    try:
        status = await client.get_auth_status()
        if not status.isAuthenticated:
            raise AuthError(tr("GitHub قبل الدخول، بس Copilot ما قبل الحساب."))
        models = await client.list_models()
        if not models:
            raise AuthError(tr("الحساب ما عليه اشتراك Copilot شغّال."))
    except AuthError:
        raise
    except Exception as exc:  # noqa: BLE001 - any SDK failure means the account isn't usable
        raise AuthError(tr("ما قدرت اتأكد من Copilot: {0}", redact(str(exc))[:200])) from exc
    finally:
        with contextlib.suppress(Exception):
            await client.stop()


async def list_models(account_id: str, token: str) -> list[tuple[str, str]]:
    client = await client_for(account_id, token)
    models = await client.list_models()
    return [(m.id, m.name or m.id) for m in models]


# ── Messages → a Copilot session ─────────────────────────────────────────────────────


def _text_of(content: Any) -> str:
    if isinstance(content, list):
        pieces = []
        for part in content:
            if part.get("type") == "text":
                pieces.append(part.get("text", ""))
            elif part.get("type") == "image_url":
                pieces.append("[صورة مرفقة — ما بتوصل للنموذج عن طريق Copilot]")
        return "\n".join(pieces)
    return content or ""


def split_messages(messages: list[dict[str, Any]]) -> tuple[str, str]:
    """(system prompt with the earlier conversation folded in, the latest user message).

    Each run starts a fresh Copilot session, so prior turns travel as context rather than
    as server-side history — the same context Rafiq builds for every other provider.
    """
    system = ""
    body = list(messages)
    if body and body[0].get("role") == "system":
        system = _text_of(body.pop(0).get("content"))
    last = ""
    if body and body[-1].get("role") == "user":
        last = _text_of(body.pop().get("content"))

    lines = []
    for message in body:
        role = message.get("role")
        text = _text_of(message.get("content")).strip()
        if not text:
            continue
        if role == "user":
            lines.append(f"المستخدم: {text}")
        elif role == "assistant":
            lines.append(f"رفيق: {text}")
    if lines:
        system = f"{system}\n\n## المحادثة لحد هلأ\n\n" + "\n\n".join(lines)
    return system, last


class CopilotProvider:
    """Same surface as `LlmProvider`: `model`, `complete`, `stream_chat`, `aclose`."""

    def __init__(
        self,
        account_id: str,
        token: str,
        model_id: str,
        reasoning_effort: str | None = None,
    ) -> None:
        self.model = f"github_copilot/{model_id}"
        self._model_id = model_id
        self._account_id = account_id
        self._token = token
        self._reasoning = reasoning_effort
        self._session: Any = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._events: asyncio.Queue[tuple[str, Any]] | None = None
        self._pending: dict[str, asyncio.Future[str]] = {}

    def __repr__(self) -> str:
        return f"CopilotProvider(model={self._model_id!r}, account_id={self._account_id!r})"

    # The SDK calls this for every event, possibly off our task — hop onto the loop safely.
    def _on_event(self, event: Any) -> None:
        if self._events is not None and self._loop is not None:
            self._loop.call_soon_threadsafe(self._events.put_nowait, ("event", event))

    def _bridge(self, name: str):
        async def handler(invocation: Any) -> Any:
            from copilot.tools import ToolResult

            call_id = invocation.tool_call_id or f"call_{len(self._pending)}"
            future: asyncio.Future[str] = asyncio.get_running_loop().create_future()
            self._pending[call_id] = future
            args = invocation.arguments if isinstance(invocation.arguments, dict) else {}
            assert self._events is not None
            await self._events.put(
                ("tool", ToolCallDelta(id=call_id, name=name, arguments_json=json.dumps(args)))
            )
            output = await future
            return ToolResult(text_result_for_llm=output)

        return handler

    async def _open(self, system: str, tools: list[dict[str, Any]]) -> None:
        from copilot.generated.rpc import PermissionDecisionReject
        from copilot.tools import Tool

        self._loop = asyncio.get_running_loop()
        self._events = asyncio.Queue()
        client = await client_for(self._account_id, self._token)

        sdk_tools = [
            Tool(
                name=t["function"]["name"],
                description=t["function"].get("description", ""),
                parameters=t["function"].get("parameters"),
                handler=self._bridge(t["function"]["name"]),
                # Rafiq's loop already asked the user (or the policy) before we get here.
                skip_permission=True,
            )
            for t in tools
        ]
        options: dict[str, Any] = {
            "model": self._model_id,
            "tools": sdk_tools,
            # Whitelist: only Rafiq's tools exist in this session — Copilot's own shell,
            # file and web tools are never offered, so they can't bypass Rafiq's policy.
            "available_tools": [t.name for t in sdk_tools],
            "system_message": {"mode": "replace", "content": system or "You are Rafiq."},
            "on_permission_request": lambda *_: PermissionDecisionReject(feedback="not allowed in Rafiq"),
            "streaming": True,
            "on_event": self._on_event,
            "enable_skills": False,
            "skip_custom_instructions": True,
            "enable_config_discovery": False,
        }
        if self._reasoning in ("low", "medium", "high"):
            options["reasoning_effort"] = self._reasoning
        self._session = await client.create_session(**options)

    async def _drain(self) -> AsyncIterator[StreamEvent]:
        """Streams deltas until Copilot either goes idle or asks for tools."""
        from copilot.session_events import (
            AssistantMessageDeltaData,
            AssistantReasoningDeltaData,
            SessionErrorData,
            SessionIdleData,
        )

        assert self._events is not None
        calls: list[ToolCallDelta] = []
        while True:
            try:
                timeout = _TOOL_BATCH_WINDOW if calls else None
                kind, item = await asyncio.wait_for(self._events.get(), timeout=timeout)
            except TimeoutError:
                yield StreamEvent(tool_calls=calls, finish_reason="tool_calls")
                return

            if kind == "tool":
                calls.append(item)
                continue

            data = getattr(item, "data", None)
            if isinstance(data, AssistantMessageDeltaData) and data.delta_content:
                yield StreamEvent(text_delta=data.delta_content)
            elif isinstance(data, AssistantReasoningDeltaData) and data.delta_content:
                if self._reasoning != "none":
                    yield StreamEvent(reasoning_delta=data.delta_content)
            elif isinstance(data, SessionErrorData):
                raise RuntimeError(redact(data.message or "Copilot error"))
            elif isinstance(data, SessionIdleData):
                if calls:
                    yield StreamEvent(tool_calls=calls, finish_reason="tool_calls")
                else:
                    yield StreamEvent(finish_reason="stop")
                return

    async def stream_chat(
        self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> AsyncIterator[StreamEvent]:
        if self._session is None:
            system, prompt = split_messages(messages)
            await self._open(system, tools)
            await self._session.send(prompt or "أكمل.")
        else:
            # A continuation: hand back the results the loop just produced, in order…
            answered = False
            for message in reversed(messages):
                if message.get("role") != "tool":
                    break
                future = self._pending.pop(message.get("tool_call_id", ""), None)
                if future is not None and not future.done():
                    future.set_result(str(message.get("content", "")))
                    answered = True
            # …or, if the loop nudged with a fresh user line, send that.
            if not answered and messages and messages[-1].get("role") == "user":
                await self._session.send(_text_of(messages[-1].get("content")) or "أكمل.")

        async for event in self._drain():
            yield event

    async def complete(self, messages: list[dict[str, Any]], max_tokens: int | None = None) -> str:
        """One-shot, no tools — used for summarising a chat."""
        text = ""
        async for event in self.stream_chat(messages, []):
            if event.text_delta:
                text += event.text_delta
        await self.aclose()
        return text.strip() or ""

    async def aclose(self) -> None:
        for future in self._pending.values():
            if not future.done():
                future.set_result("تم إيقاف الجلسة.")
        self._pending.clear()
        session, self._session = self._session, None
        self._events = None
        if session is not None:
            with contextlib.suppress(Exception):
                await session.disconnect()
