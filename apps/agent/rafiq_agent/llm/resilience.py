"""Keeps model calls going when a provider pushes back.

Three things, around any provider (litellm or Copilot):

* **A cap per key.** A hundred parallel tasks on one API key would mostly collect 429s, so
  at most N requests per provider credential are in flight; the rest wait their turn.
* **Retries.** Rate limits, overloads, timeouts and 5xx answers are retried with growing,
  jittered pauses (honouring Retry-After when the provider sends one) — but only before
  the reply started: a stream that already showed text can't be replayed invisibly.
* **A fallback model.** If the agent has one and the call still fails before producing
  anything, the same request goes to the fallback instead.
"""

import asyncio
import contextlib
import random
import weakref
from collections.abc import AsyncIterator
from typing import Any

import litellm

DEFAULT_CONCURRENCY = 6
MAX_ATTEMPTS = 5
RETRYABLE_STATUS = frozenset({408, 409, 425, 429, 500, 502, 503, 504, 529})
_RETRYABLE_TYPES = tuple(
    t
    for t in (
        getattr(litellm, name, None)
        for name in (
            "RateLimitError",
            "ServiceUnavailableError",
            "InternalServerError",
            "Timeout",
            "APIConnectionError",
        )
    )
    if isinstance(t, type)
)

_concurrency = DEFAULT_CONCURRENCY
# One set of semaphores per event loop (tests run many loops; the app runs one).
_gates: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, dict[str, tuple[int, asyncio.Semaphore]]]" = (
    weakref.WeakKeyDictionary()
)


def set_concurrency(limit: int) -> None:
    """Requests per provider key at once. New calls pick up the change immediately."""
    global _concurrency
    _concurrency = max(1, int(limit))


def _gate(key: str) -> asyncio.Semaphore:
    gates = _gates.setdefault(asyncio.get_running_loop(), {})
    entry = gates.get(key)
    if entry is None or entry[0] != _concurrency:
        entry = (_concurrency, asyncio.Semaphore(_concurrency))
        gates[key] = entry
    return entry[1]


def retryable(exc: BaseException) -> bool:
    if isinstance(exc, asyncio.CancelledError):
        return False
    if _RETRYABLE_TYPES and isinstance(exc, _RETRYABLE_TYPES):
        return True
    status = getattr(exc, "status_code", None)
    if status in RETRYABLE_STATUS:
        return True
    text = str(exc).lower()
    return any(s in text for s in ("rate limit", "overloaded", "too many requests", "timed out"))


def _retry_after(exc: BaseException) -> float | None:
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None) or {}
    with contextlib.suppress(Exception):
        value = headers.get("retry-after") or headers.get("Retry-After")
        if value:
            return min(60.0, float(value))
    return None


def backoff(exc: BaseException, attempt: int) -> float:
    hinted = _retry_after(exc)
    if hinted is not None:
        return hinted
    return min(30.0, 1.5 * (2**attempt)) * (0.75 + random.random() / 2)


class ResilientProvider:
    """The provider interface (`model`, `stream_chat`, `complete`, `aclose`) with a per-key
    cap, retries and an optional fallback around it."""

    def __init__(
        self,
        inner: Any,
        key: str,
        fallback: Any | None = None,
        attempts: int = MAX_ATTEMPTS,
        sleep: Any = asyncio.sleep,
    ) -> None:
        self.inner = inner
        self.key = key
        self.fallback = fallback
        self.attempts = max(1, attempts)
        self._sleep = sleep

    @property
    def model(self) -> str:
        return self.inner.model

    def __getattr__(self, name: str) -> Any:
        return getattr(self.inner, name)

    async def aclose(self) -> None:
        await self.inner.aclose()
        if self.fallback is not None:
            await self.fallback.aclose()

    async def complete(self, messages: list[dict[str, Any]], max_tokens: int | None = None) -> str:
        from rafiq_agent.llm import usage

        usage.check_budget()
        last: BaseException | None = None
        for attempt in range(self.attempts):
            try:
                async with _gate(self.key):
                    return await self.inner.complete(messages, max_tokens=max_tokens)
            except Exception as exc:  # noqa: BLE001 - sorted below
                last = exc
                if not retryable(exc) or attempt == self.attempts - 1:
                    break
                await self._sleep(backoff(exc, attempt))
        if self.fallback is not None:
            return await self.fallback.complete(messages, max_tokens=max_tokens)
        assert last is not None
        raise last

    async def stream_chat(
        self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> AsyncIterator[Any]:
        from rafiq_agent.llm import usage

        usage.check_budget()
        last: BaseException | None = None
        for attempt in range(self.attempts):
            started = False
            try:
                async with _gate(self.key):
                    async for event in self.inner.stream_chat(messages, tools):
                        started = True
                        yield event
                return
            except Exception as exc:  # noqa: BLE001 - sorted below
                if started:
                    raise  # the user already saw part of this reply
                last = exc
                if not retryable(exc) or attempt == self.attempts - 1:
                    break
                await self._sleep(backoff(exc, attempt))
        if self.fallback is not None:
            async for event in self.fallback.stream_chat(messages, tools):
                yield event
            return
        assert last is not None
        raise last
