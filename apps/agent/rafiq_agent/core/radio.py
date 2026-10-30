"""Morning radio: a short spoken show about the user's own day, ready when they sit down.

Once a day at the chosen time a model writes the script from what is really there: what
Rafiq's tasks did since yesterday, what's scheduled today, which of the user's files changed,
and, when a web search service is set up, news on the topics they picked. The script is kept
as an episode and read out loud by the voice chosen in Settings → Voice only when they press
play, so a voice provider is paid for only if it's heard.

A day the app was closed at that time gets its episode when it next starts. Listening can
turn into a conversation: the episode opens as a chat, ready for a spoken question.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select

from rafiq_agent.core import file_index
from rafiq_agent.core.schedules import next_run, parse_time, utc
from rafiq_agent.i18n import current_locale, tr
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import Chat, ChatMessage, LlmModel, RadioEpisode, Schedule, Task

log = logging.getLogger(__name__)

TICK_SECONDS = 60
MAX_ITEMS = 25
LANGUAGES = {"ar": "Levantine Arabic, simple and warm", "en": "English", "ru": "Russian"}

SCRIPT_SYSTEM = (
    "You write the script of a personal morning radio show called Rafiq Radio, for one listener. "
    "It will be read aloud by a text-to-speech voice, so write only the spoken words: no "
    "markdown, no lists, no emoji, no stage directions, no links, and spell things as they are "
    "said. About 350 words, three minutes. Open with one warm line and today's date. Then what "
    "got done since yesterday, what needs attention (failed tasks first), what is coming today, "
    "the files that changed if they matter, then the news if there is any. Close with one line. "
    "Use ONLY the facts given. Never invent a task, a meeting or a headline. If little happened, "
    "say so and keep the show short. Write in {language}."
)


async def _pick_model(settings: Any) -> LlmModel | None:
    """The model for Rafiq's own chores if one was chosen, else any model that works."""
    async with SessionLocal() as session:
        for wanted in (settings.helper_model_id, settings.task_model_id):
            if wanted:
                model = await session.get(LlmModel, wanted)
                if model is not None and model.verify_ok is not False:
                    return model
        rows = (await session.execute(select(LlmModel))).scalars().all()
    return next((m for m in rows if m.verify_ok is not False), None)


async def gather(settings: Any, now: datetime | None = None) -> dict[str, Any]:
    """Everything the show may talk about. Only real data; the model is told to use only this."""
    now = now or datetime.now(UTC)
    since = now - timedelta(hours=24)
    facts: dict[str, Any] = {"date": now.astimezone().strftime("%A %Y-%m-%d"), "tasks": [], "today": [], "files": [], "news": ""}
    async with SessionLocal() as session:
        tasks = (
            await session.execute(select(Task).where(Task.created_at >= since).order_by(Task.created_at.desc()).limit(MAX_ITEMS))
        ).scalars().all()
        facts["tasks"] = [{"title": t.title, "status": t.status} for t in tasks]
        schedules = (await session.execute(select(Schedule).where(Schedule.enabled.is_(True)))).scalars().all()
    end_of_day = now.astimezone().replace(hour=23, minute=59, second=59)
    for schedule in schedules:
        due = utc(schedule.next_run_at) or next_run(schedule, now)
        if due and due <= end_of_day:
            facts["today"].append({"title": schedule.title, "at": due.astimezone().strftime("%H:%M")})
    if settings.file_search_enabled:
        with contextlib.suppress(Exception):
            facts["files"] = await asyncio.to_thread(file_index.recent, 24, 12)
    if settings.radio_topics:
        from rafiq_agent.tools.web import search_tool

        tool = search_tool(settings)
        if tool is not None:
            with contextlib.suppress(Exception):
                found = await tool.run({"query": f"{settings.radio_topics} news today", "count": 5})
                if found.ok:
                    facts["news"] = found.output[:3000]
    return facts


def facts_text(facts: dict[str, Any]) -> str:
    lines = [f"Today: {facts['date']}", "", "Tasks since yesterday:"]
    lines += [f"- {t['title']} ({t['status']})" for t in facts["tasks"]] or ["- none"]
    lines += ["", "Scheduled today:"]
    lines += [f"- {t['at']} {t['title']}" for t in facts["today"]] or ["- nothing"]
    lines += ["", "Files changed since yesterday:"]
    lines += [f"- {f}" for f in facts["files"]] or ["- none"]
    if facts["news"]:
        lines += ["", "News results:", facts["news"]]
    return "\n".join(lines)


def today_key(now: datetime | None = None) -> str:
    return (now or datetime.now(UTC)).astimezone().strftime("%Y-%m-%d")


async def make_episode(settings: Any, *, replace: bool = False) -> RadioEpisode:
    """Writes today's episode and keeps it, whatever came of it, so a failing model isn't
    called again every minute; the error is shown and "make it again" is one press away."""
    from rafiq_agent.auth.resolve import llm_for
    from rafiq_agent.llm import usage

    day = today_key()
    script, error, model_id = "", None, None
    model = await _pick_model(settings)
    if model is None:
        error = "no_model"
    else:
        model_id = model.id
        locale = current_locale()
        system = SCRIPT_SYSTEM.format(language=LANGUAGES.get(locale, LANGUAGES["ar"]))
        try:
            facts = await gather(settings)
            with usage.scope("radio", day, model.id):
                usage.check_budget()
                script = await llm_for(model).complete(
                    [{"role": "system", "content": system}, {"role": "user", "content": facts_text(facts)}], max_tokens=1200
                )
            if not script:
                error = "empty"
        except Exception as exc:  # noqa: BLE001 - shown on the card
            log.info("radio episode failed", exc_info=True)
            error = str(exc)[:300]

    async with SessionLocal() as session:
        row = (await session.execute(select(RadioEpisode).where(RadioEpisode.day == day))).scalar_one_or_none()
        if row is None:
            row = RadioEpisode(day=day)
            session.add(row)
        elif not replace and row.script:
            return row
        row.script, row.error, row.model_id, row.created_at = script, error, model_id, datetime.now(UTC)
        row.heard_at = None
        await session.commit()
        await session.refresh(row)
        return row


async def episode_chat(episode: RadioEpisode) -> str:
    """The episode as a chat, its script the first reply, for questions about it. No model
    is called: the first spoken question is the first request."""
    async with SessionLocal() as session:
        chat = Chat(title=tr("راديو الصبح · {0}", episode.day), model_id=episode.model_id)
        session.add(chat)
        await session.flush()
        session.add(ChatMessage(chat_id=chat.id, role="assistant", content=episode.script, model_id=episode.model_id))
        await session.commit()
        return chat.id


def is_due(at_time: str | None, now: datetime) -> bool:
    at = parse_time(at_time)
    if at is None:
        return False
    local = now.astimezone()
    return (local.hour, local.minute) >= at


async def tick(now: datetime | None = None) -> RadioEpisode | None:
    from rafiq_agent.core.agent_runtime import load_settings

    now = now or datetime.now(UTC)
    settings = await load_settings()
    if not settings.radio_enabled or not is_due(settings.radio_time, now):
        return None
    async with SessionLocal() as session:
        exists = (await session.execute(select(RadioEpisode.id).where(RadioEpisode.day == today_key(now)))).first()
    if exists:
        return None
    return await make_episode(settings)


async def run_forever() -> None:
    await asyncio.sleep(30)
    while True:
        try:
            await tick()
        except Exception:  # noqa: BLE001 - the next minute tries again
            log.info("radio tick failed", exc_info=True)
        await asyncio.sleep(TICK_SECONDS)
