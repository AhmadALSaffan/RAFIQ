"""The agent asks the engine (in the app's WebView) to do what needs a browser: measure
text, draw frames, check pixels, mix audio. The app keeps a stream open
(GET /motion/engine/stream); a request goes down it and the answer comes back by POST.

If no window is connected, `call` raises EngineUnavailable and the caller falls back to
what Python can do alone (motion/lint.py)."""

import asyncio
import uuid
from typing import Any


class EngineUnavailable(RuntimeError):
    pass


class EngineError(RuntimeError):
    pass


_hosts: list[asyncio.Queue[dict[str, Any] | None]] = []
_pending: dict[str, asyncio.Future[Any]] = {}


def connect() -> asyncio.Queue[dict[str, Any] | None]:
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
    _hosts.append(queue)
    return queue


def disconnect(queue: asyncio.Queue[dict[str, Any] | None]) -> None:
    if queue in _hosts:
        _hosts.remove(queue)


def connected() -> bool:
    return bool(_hosts)


async def call(kind: str, payload: dict[str, Any], timeout: float = 30.0) -> Any:
    """Runs `kind` in the engine and returns its result."""
    if not _hosts:
        raise EngineUnavailable("no app window is connected to draw")
    request_id = uuid.uuid4().hex[:12]
    future: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
    _pending[request_id] = future
    # The newest window answers: it's the one that's open now.
    _hosts[-1].put_nowait({"id": request_id, "kind": kind, "payload": payload})
    try:
        return await asyncio.wait_for(future, timeout)
    except TimeoutError as exc:
        raise EngineUnavailable(f"the engine didn't answer {kind} in {timeout:.0f}s") from exc
    finally:
        _pending.pop(request_id, None)


def resolve(request_id: str, ok: bool, result: Any = None, error: str | None = None) -> bool:
    future = _pending.get(request_id)
    if future is None or future.done():
        return False
    if ok:
        future.set_result(result)
    else:
        future.set_exception(EngineError(error or "engine error"))
    return True
