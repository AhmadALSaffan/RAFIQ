"""Keeps an eye on the connected trackers while the app runs. Every few minutes (each
account sets how often) it looks at the issues assigned to the user, the tracker's own
notifications and the pull requests waiting for their review, and turns what changed into
notices: shown in the app, sent as a desktop notification, posted to team channels — and,
for a newly assigned issue that matches one of the user's rules, a task prepared for it.

Webhooks can't reach a desktop app without a tunnel, so this polls — within each
provider's limits: a "slow down" from the provider pauses that account for as long as it
asks, and the first look at an account only learns what's there without announcing it."""

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select

from rafiq_agent.core import issues as svc
from rafiq_agent.i18n import tr
from rafiq_agent.integrations import channels
from rafiq_agent.integrations.base import Activity, IntegrationError, Issue, RateLimited
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import IntegrationAccount, IssueNotice, NotifyChannel
from rafiq_agent.storage.secrets import get_api_key

log = logging.getLogger(__name__)
TICK_SECONDS = 60
MAX_SNAPSHOT = 300


def _now() -> datetime:
    return datetime.now(UTC)


def _parse(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _shape(issue: Issue) -> dict[str, Any]:
    return {"status": issue.status, "comments": issue.comment_count, "updated": issue.updated_at, "title": issue.title[:200], "url": issue.url}


def diff(before: dict[str, dict[str, Any]], issues: list[Issue], first: bool) -> list[Activity]:
    """What changed among the assigned issues since the last look."""
    if first:
        return []
    out: list[Activity] = []
    for issue in issues:
        old = before.get(issue.key)
        if old is None:
            out.append(Activity(kind="assigned", key=issue.key, title=issue.title, url=issue.url, at=issue.updated_at,
                                text=issue.status, id=f"assigned:{issue.key}"))
            continue
        if old.get("status") != issue.status and issue.status:
            out.append(Activity(kind="status", key=issue.key, title=issue.title, url=issue.url, at=issue.updated_at,
                                text=f"{old.get('status')} ← {issue.status}", id=f"status:{issue.key}:{issue.status}:{issue.updated_at}"))
        new_count, old_count = issue.comment_count, old.get("comments")
        if isinstance(new_count, int) and isinstance(old_count, int) and new_count > old_count:
            out.append(Activity(kind="comment", key=issue.key, title=issue.title, url=issue.url, at=issue.updated_at,
                                text=tr("{0} تعليق جديد", new_count - old_count), id=f"comment:{issue.key}:{new_count}"))
    return out


async def _store(row: IntegrationAccount, found: list[Activity], kinds: set[str]) -> list[IssueNotice]:
    """Saves the activities not seen before; returns the new notices."""
    fresh: list[IssueNotice] = []
    async with SessionLocal() as session:
        for act in found:
            if act.kind not in kinds and not (act.kind == "update" and "mention" in kinds):
                continue
            ext = act.id or f"{act.kind}:{act.key}:{act.at}"
            exists = (
                await session.execute(
                    select(IssueNotice.id).where(IssueNotice.integration_id == row.id, IssueNotice.external_id == ext).limit(1)
                )
            ).first()
            if exists:
                continue
            notice = IssueNotice(
                integration_id=row.id, external_id=ext, kind=act.kind, key=act.key, title=act.title[:500],
                url=act.url, actor=act.actor, text=(act.text or "")[:1000] or None, happened_at=act.at,
            )
            session.add(notice)
            fresh.append(notice)
        await session.commit()
    return fresh


async def _save_state(row_id: str, state: dict[str, Any]) -> None:
    async with SessionLocal() as session:
        row = await session.get(IntegrationAccount, row_id)
        if row:
            row.state = state
            await session.commit()


async def deliver(event: str, title: str, text: str = "", link: str | None = None) -> None:
    """Posts to every team channel that asked for this kind of event."""
    async with SessionLocal() as session:
        rows = (await session.execute(select(NotifyChannel))).scalars().all()
    for channel in rows:
        if event not in (channel.events or []):
            continue
        url = get_api_key(channel.secret_ref)
        if not url:
            continue
        try:
            await channels.post(channel.kind, url, title, text, link)
        except Exception as exc:  # noqa: BLE001 - one channel failing doesn't stop the rest
            log.warning("channel %s failed: %s", channel.name, exc)


async def _apply_rules(row: IntegrationAccount, settings: svc.AccountSettings, assigned: list[Activity], issues: dict[str, Issue]) -> list[str]:
    """Prepares a task for each newly assigned issue a rule matches. Returns task ids."""
    rules = [r for r in settings.rules if r.enabled and r.action in ("task", "plan")]
    if not rules or not assigned:
        return []
    from rafiq_agent.core.agent_runtime import load_settings
    from rafiq_agent.core.tasks_service import TaskCreateError, create_task
    from rafiq_agent.storage.models import LlmModel

    app = await load_settings()
    async with SessionLocal() as session:
        model_id = app.task_model_id if app.task_model_id and await session.get(LlmModel, app.task_model_id) else None
        if not model_id:
            first = (await session.execute(select(LlmModel.id).limit(1))).first()
            model_id = first[0] if first else None
    if not model_id:
        return []
    started: list[str] = []
    for act in assigned:
        issue = issues.get(act.key)
        if not issue:
            continue
        for rule in rules:
            if rule.label and rule.label.lower() not in [x.lower() for x in issue.labels]:
                continue
            if rule.project and rule.project.lower() not in ((issue.project or "").lower(), str(issue.extra.get("project_key") or "").lower()):
                continue
            if rule.contains and rule.contains.lower() not in issue.title.lower():
                continue
            prompt = tr(
                "اشتغل على هالمهمة من {0}:\n\n{1} — {2}\nالحالة: {3}\nالرابط: {4}\n\n{5}",
                row.name, issue.key, issue.title, issue.status, issue.url, issue.description or "",
            )
            if rule.note:
                prompt += "\n\n" + rule.note
            try:
                task = await create_task(
                    title=f"{issue.key}: {issue.title}"[:120],
                    prompt=prompt,
                    model_id=model_id,
                    working_dir=None,
                    origin={"rule": rule.id, "integration_id": row.id},
                    mode="plan" if rule.action == "plan" else "auto",
                    issue={"integration_id": row.id, "key": issue.key},
                )
                started.append(task.id)
            except TaskCreateError as exc:
                log.warning("rule %s couldn't start a task for %s: %s", rule.id, issue.key, exc)
            break
    return started


async def poll(row: IntegrationAccount, force: bool = False) -> list[IssueNotice]:
    """One look at one account. Returns the new notices."""
    settings = svc.settings_of(row)
    state = dict(row.state or {})
    now = _now()
    if not force:
        if not settings.watch.enabled:
            return []
        if (until := _parse(state.get("backoff_until"))) and until > now:
            return []
        last = _parse(state.get("last_check"))
        if last and now - last < timedelta(minutes=settings.watch.every_minutes):
            return []
    client = svc.client_for(row)
    kinds = set(settings.watch.kinds)
    since = state.get("last_check")
    first = "issues" not in state
    found: list[Activity] = []
    try:
        issues = await client.list_issues(None, 50, include_done=False)
        by_key = {i.key: i for i in issues}
        changes = diff(state.get("issues") or {}, issues, first)
        found += changes
        if client.supports("mentions") and not first:
            try:
                found += await client.mentions(since)
            except IntegrationError as exc:
                if isinstance(exc, RateLimited):
                    raise
        if client.supports("reviews"):
            try:
                reviews = await client.review_requests(30)
                seen = set(state.get("reviews") or [])
                if not first:
                    found += [
                        Activity(kind="review", key=r.key, title=r.title, url=r.url, at=r.created_at, actor=r.reporter, id=f"review:{r.key}")
                        for r in reviews if r.key not in seen
                    ]
                state["reviews"] = [r.key for r in reviews][:200]
            except IntegrationError as exc:
                if isinstance(exc, RateLimited):
                    raise
        state["issues"] = {i.key: _shape(i) for i in issues[:MAX_SNAPSHOT]}
        state["last_check"] = now.isoformat()
        state.pop("error", None)
        state.pop("backoff_until", None)
    except RateLimited as exc:
        state["backoff_until"] = (now + timedelta(seconds=exc.retry_after or 900)).isoformat()
        state["error"] = str(exc)
        await _save_state(row.id, state)
        return []
    except Exception as exc:  # noqa: BLE001 - a broken account is reported on its card, not raised
        state["error"] = str(exc)[:300]
        state["last_check"] = now.isoformat()
        await _save_state(row.id, state)
        return []
    await _save_state(row.id, state)
    fresh = await _store(row, found, kinds)
    assigned = [a for a in changes if a.kind == "assigned"]
    if assigned:
        await _apply_rules(row, settings, assigned, by_key)
    for notice in fresh:
        await deliver(notice.kind, f"{notice.key} — {notice.title}", notice.text or "", notice.url)
    return fresh


async def poll_all(force: bool = False) -> int:
    count = 0
    for row in await svc.accounts():
        count += len(await poll(row, force=force))
    return count


async def run_forever() -> None:
    await asyncio.sleep(20)  # let the app finish starting
    while True:
        try:
            await poll_all()
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - the watcher must outlive any single failure
            log.warning("issue watch tick failed: %s", exc)
        await asyncio.sleep(TICK_SECONDS)
