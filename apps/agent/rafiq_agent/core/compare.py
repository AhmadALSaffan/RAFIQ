"""Compare two models: the same question to both, side by side, with what each cost and how
long it took. Nothing is saved; it's for choosing a model, not for keeping an answer."""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from typing import Any

from rafiq_agent.core.council import Seat
from rafiq_agent.llm import usage
from rafiq_agent.storage.models import _uid


async def run(question: str, seats: list[Seat]) -> AsyncIterator[dict[str, Any]]:
    run_id = _uid()
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
    messages = [{"role": "user", "content": question}]
    yield {"type": "start", "seats": [{"id": s.id, "name": s.name} for s in seats]}

    async def speak(seat: Seat) -> None:
        began = time.monotonic()
        first: float | None = None
        with usage.scope("compare", run_id, seat.id), usage.collect() as spent:
            try:
                async for event in seat.llm.stream_chat(messages, []):
                    if event.text_delta:
                        first = first if first is not None else time.monotonic()
                        await queue.put({"type": "delta", "seat": seat.id, "text": event.text_delta})
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - the other model still answers
                await queue.put({"type": "error", "seat": seat.id, "message": str(exc)[:300]})
                return
        total = spent.total()
        await queue.put(
            {
                "type": "finished",
                "seat": seat.id,
                "first_ms": round((first - began) * 1000) if first is not None else None,
                "total_ms": round((time.monotonic() - began) * 1000),
                "prompt_tokens": total.prompt_tokens,
                "completion_tokens": total.completion_tokens,
                "cost_usd": total.cost_usd,
            }
        )

    tasks = [asyncio.create_task(speak(seat)) for seat in seats]

    async def closing() -> None:
        await asyncio.gather(*tasks, return_exceptions=True)
        await queue.put(None)

    closer = asyncio.create_task(closing())
    try:
        while (event := await queue.get()) is not None:
            yield event
    finally:
        closer.cancel()
        for task in tasks:
            task.cancel()
    yield {"type": "done"}
