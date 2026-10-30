"""The council: one hard question, two or three models.

Each model answers on its own, without seeing the others. Then each reads the other answers,
under neutral names so nobody defers to a famous model, and says where they go wrong. Last,
one model — the chair, the first that answered — weighs it all and writes one decision, with
the points they disagreed on left visible.

It only makes sense because Rafiq works with any model: a company tied to its own can't offer
this. Everything streams, and it ends as an ordinary chat: the decision is the reply, the
answers and critiques are kept with it, and the conversation goes on from there.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from rafiq_agent.auth.resolve import llm_for
from rafiq_agent.llm import usage
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import Chat, ChatMessage, LlmModel, _uid

MIN_SEATS = 2
MAX_SEATS = 3
NAMES = ("A", "B", "C")

ANSWER_SYSTEM = (
    "You are one of several independent advisors asked the same question. Give your own best "
    "answer: take a clear position and say why, plainly, in under 250 words. Answer in the "
    "language of the question."
)
CRITIQUE_SYSTEM = (
    "You are an advisor on a council. You wrote one answer to the question; below are the "
    "others. Critique them honestly, and do not be polite for its own sake: what is wrong, "
    "risky or missing, and what is better than your own answer. Change your mind if they "
    "convinced you. Under 150 words, in the language of the question."
)
VERDICT_SYSTEM = (
    "You chair a council of advisors. Weigh their answers and critiques and decide; do not "
    "average them. Write in the language of the question, with exactly three short parts: "
    "the decision itself, in one or two sentences; why, in a few points; and where the "
    "advisors disagreed and what would change the decision. If they agree on something "
    "doubtful, say so. Under 250 words."
)


@dataclass
class Seat:
    id: str
    name: str
    llm: Any
    answer: str = ""
    critique: str = ""


def anonymous(seats: list[Seat], but: Seat | None = None) -> str:
    """The answers under neutral names, so a model judges the words and not the brand."""
    return "\n\n".join(
        f"Advisor {NAMES[i]}:\n{seat.answer}" for i, seat in enumerate(seats) if seat is not but and seat.answer
    )


def answer_messages(question: str) -> list[dict[str, str]]:
    return [{"role": "system", "content": ANSWER_SYSTEM}, {"role": "user", "content": question}]


def critique_messages(question: str, seats: list[Seat], seat: Seat) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": CRITIQUE_SYSTEM},
        {"role": "user", "content": f"Question:\n{question}\n\nYour answer:\n{seat.answer}\n\nThe others:\n{anonymous(seats, seat)}"},
    ]


def verdict_messages(question: str, seats: list[Seat]) -> list[dict[str, str]]:
    critiques = "\n\n".join(f"Advisor {NAMES[i]}'s critique:\n{s.critique}" for i, s in enumerate(seats) if s.critique)
    return [
        {"role": "system", "content": VERDICT_SYSTEM},
        {"role": "user", "content": f"Question:\n{question}\n\n{anonymous(seats)}\n\n{critiques}"},
    ]


async def _stage(
    stage: str,
    seats: list[Seat],
    messages_of: Callable[[Seat], list[dict[str, str]]],
    keep: Callable[[Seat, str], None],
    chat_id: str,
    workspace_id: str | None,
) -> AsyncIterator[dict[str, Any]]:
    """All these seats speak at once; their words come out as they arrive."""
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    async def speak(seat: Seat) -> None:
        parts: list[str] = []
        try:
            with usage.scope("chat", chat_id, seat.id, workspace_id):
                async for event in seat.llm.stream_chat(messages_of(seat), []):
                    if event.text_delta:
                        parts.append(event.text_delta)
                        await queue.put({"type": "delta", "stage": stage, "seat": seat.id, "text": event.text_delta})
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - one model failing mustn't end the council
            await queue.put({"type": "error", "stage": stage, "seat": seat.id, "message": str(exc)[:300]})
        keep(seat, "".join(parts).strip())

    tasks = [asyncio.create_task(speak(seat)) for seat in seats]

    async def closing(all_done: Awaitable[Any]) -> None:
        await all_done
        await queue.put(None)

    closer = asyncio.create_task(closing(asyncio.gather(*tasks, return_exceptions=True)))
    try:
        while (event := await queue.get()) is not None:
            yield event
    finally:
        closer.cancel()
        for task in tasks:
            task.cancel()


async def load_seats(model_ids: list[str]) -> list[Seat]:
    wanted = list(dict.fromkeys(model_ids))[:MAX_SEATS]
    seats: list[Seat] = []
    async with SessionLocal() as session:
        for model_id in wanted:
            model = await session.get(LlmModel, model_id)
            if model is not None and model.verify_ok is not False:
                seats.append(Seat(id=model.id, name=model.name, llm=llm_for(model)))
    return seats


async def _save(question: str, seats: list[Seat], chair: Seat, verdict: str, chat_id: str, workspace_id: str | None) -> None:
    async with SessionLocal() as session:
        session.add(Chat(id=chat_id, title=question.strip()[:60], model_id=chair.id, workspace_id=workspace_id))
        session.add(ChatMessage(chat_id=chat_id, role="user", content=question))
        await session.flush()
        session.add(
            ChatMessage(
                chat_id=chat_id,
                role="assistant",
                content=verdict,
                model_id=chair.id,
                parts=[
                    {
                        "kind": "council",
                        "chair": chair.id,
                        "seats": [{"id": s.id, "name": s.name, "answer": s.answer, "critique": s.critique} for s in seats],
                    },
                    {"kind": "text", "text": verdict},
                ],
            )
        )
        await session.commit()


async def run(question: str, seats: list[Seat], workspace_id: str | None = None) -> AsyncIterator[dict[str, Any]]:
    """The whole council, as a stream of events; the last is "done" with the new chat's id."""
    chat_id = _uid()
    yield {"type": "start", "chat_id": chat_id, "seats": [{"id": s.id, "name": s.name} for s in seats]}

    yield {"type": "stage", "stage": "answer"}
    async for event in _stage("answer", seats, lambda _s: answer_messages(question), lambda s, text: setattr(s, "answer", text), chat_id, workspace_id):
        yield event
    answered = [s for s in seats if s.answer]
    if not answered:
        yield {"type": "failed"}
        return

    if len(answered) > 1:
        yield {"type": "stage", "stage": "critique"}
        async for event in _stage("critique", answered, lambda s: critique_messages(question, answered, s), lambda s, text: setattr(s, "critique", text), chat_id, workspace_id):
            yield event

    # The chair is the first that answered; if it fails to decide, the next one takes over.
    verdict = ""
    chair = answered[0]
    yield {"type": "stage", "stage": "verdict"}
    holder: dict[str, str] = {}
    for seat in answered:
        chair = seat
        yield {"type": "chair", "seat": seat.id}
        async for event in _stage("verdict", [seat], lambda _s: verdict_messages(question, answered), lambda _s, text: holder.update(text=text), chat_id, workspace_id):
            yield event
        verdict = holder.get("text", "")
        if verdict:
            break
    if not verdict:
        yield {"type": "failed"}
        return

    await _save(question, seats, chair, verdict, chat_id, workspace_id)
    yield {"type": "done", "chat_id": chat_id}
