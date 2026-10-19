"""The one door to the connected trackers. The work inbox, the agent tools, the task
lifecycle and the watcher all come through here, so every change Rafiq makes on a tracker
is checked against the account's settings (read-only), recorded with who asked for it,
and kept with what it takes to undo it."""

from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlalchemy import select

from rafiq_agent.i18n import tr
from rafiq_agent.integrations.base import (
    Integration,
    IntegrationError,
    Issue,
    IssueChanges,
    IssueDraft,
)
from rafiq_agent.integrations.providers import build
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import IntegrationAccount, IntegrationAction
from rafiq_agent.storage.secrets import get_api_key

# ── Per-account settings ─────────────────────────────────────────────────────────────────


class Lifecycle(BaseModel):
    """How a task started from an issue moves it along."""

    on_start: Literal["none", "in_progress"] = "in_progress"
    on_finish: Literal["none", "review", "done"] = "review"
    comment_plan: bool = False  # post the task's plan as a comment before it starts
    comment_summary: bool = True  # post what was done when it finishes
    log_work: bool = False  # log the task's running time on the issue
    branch: bool = True  # work on a branch named after the issue
    publish: Literal["none", "commit", "push", "pull_request"] = "commit"
    review_status: str = "review"  # the word a "review" status contains on this tracker


class WatchSettings(BaseModel):
    enabled: bool = True
    every_minutes: int = Field(default=10, ge=2, le=240)
    kinds: list[str] = Field(default_factory=lambda: ["assigned", "mention", "review", "comment", "status"])
    desktop: bool = True  # a Windows notification, besides the in-app one


class Rule(BaseModel):
    """When a newly assigned issue matches, prepare a task for it."""

    id: str
    enabled: bool = True
    label: str | None = None  # the issue has this label
    project: str | None = None  # in this project
    contains: str | None = None  # title contains
    action: Literal["task", "plan", "notify"] = "plan"  # plan = a plan-first task you approve
    note: str | None = None  # extra instructions for the task


class SavedView(BaseModel):
    id: str
    name: str
    query: str  # the tracker's own query language
    kind: Literal["search", "sprint", "reviews", "mentions"] = "search"


class AccountSettings(BaseModel):
    read_only: bool = False
    lifecycle: Lifecycle = Field(default_factory=Lifecycle)
    watch: WatchSettings = Field(default_factory=WatchSettings)
    # project key / repo → the local folder it lives in, so «نفّذها» opens the right one.
    project_map: dict[str, str] = Field(default_factory=dict)
    rules: list[Rule] = Field(default_factory=list)
    views: list[SavedView] = Field(default_factory=list)


def settings_of(row: IntegrationAccount) -> AccountSettings:
    return AccountSettings.model_validate(row.settings or {})


def client_for(row: IntegrationAccount) -> Integration:
    config = dict(row.config or {})
    config["read_only"] = settings_of(row).read_only
    return build(row.provider, config, get_api_key(row.secret_ref))


async def _fresh(row: IntegrationAccount) -> IntegrationAccount:
    """An OAuth sign-in renews its token before it runs out (integrations/oauth.py)."""
    if (row.config or {}).get("auth") != "oauth" or not row.secret_ref:
        return row
    from rafiq_agent.integrations import oauth
    from rafiq_agent.storage.secrets import replace_api_key

    secret = get_api_key(row.secret_ref) or ""
    try:
        renewed = await oauth.refresh(row.provider, str((row.config or {}).get("base_url") or ""), secret)
    except IntegrationError:
        return row  # its calls will fail with the provider's own message
    if renewed:
        replace_api_key(row.secret_ref, renewed)
    return row


async def account(integration_id: str) -> IntegrationAccount:
    async with SessionLocal() as session:
        row = await session.get(IntegrationAccount, integration_id)
    if not row:
        raise IntegrationError(tr("الحساب المربوط مو موجود."))
    return await _fresh(row)


async def accounts() -> list[IntegrationAccount]:
    async with SessionLocal() as session:
        rows = (await session.execute(select(IntegrationAccount).order_by(IntegrationAccount.created_at))).scalars().all()
    return [await _fresh(r) for r in rows if r.verify_ok is not False]


async def resolve(key: str, integration_id: str | None = None) -> tuple[IntegrationAccount, Integration]:
    """Which connected account owns an issue key. Keys are provider-shaped, so the first
    account that can read it wins."""
    if integration_id:
        row = await account(integration_id)
        return row, client_for(row)
    rows = await accounts()
    if not rows:
        raise IntegrationError(tr("ما في حساب مربوط. اربط حساب من صفحة الربط."))
    for row in rows:
        client = client_for(row)
        try:
            await client.get_issue(key)
            return row, client
        except Exception:  # noqa: BLE001 - try the next account
            continue
    raise IntegrationError(tr("ما لقيت المهمة «{0}» بأي حساب مربوط.", key))


# ── Recording what Rafiq changed ────────────────────────────────────────────────────────


async def record(
    row: IntegrationAccount,
    key: str,
    action: str,
    summary: str,
    *,
    url: str | None = None,
    undo: dict[str, Any] | None = None,
    source: dict[str, Any] | None = None,
) -> IntegrationAction:
    entry = IntegrationAction(
        integration_id=row.id,
        provider=row.provider,
        key=key,
        action=action,
        summary=summary[:2000],
        url=url,
        undo=undo,
        source=source,
    )
    async with SessionLocal() as session:
        session.add(entry)
        await session.commit()
        await session.refresh(entry)
    return entry


async def comment(row: IntegrationAccount, client: Integration, key: str, body: str, source: dict[str, Any] | None = None) -> str | None:
    comment_id = await client.add_comment(key, body)
    undo = {"kind": "delete_comment", "comment_id": comment_id} if comment_id and client.supports("comment_edit") else None
    await record(row, key, "comment", body, undo=undo, source=source)
    return comment_id


async def set_status(row: IntegrationAccount, client: Integration, key: str, status_id: str, source: dict[str, Any] | None = None) -> str:
    before = await client.get_issue(key)
    status = await client.set_status(key, status_id)
    await record(
        row, key, "status", tr("«{0}» ← «{1}»", before.status, status), url=before.url,
        undo={"kind": "status", "to": before.status}, source=source,
    )
    return status


async def complete(row: IntegrationAccount, client: Integration, key: str, source: dict[str, Any] | None = None) -> str:
    before = await client.get_issue(key)
    status = await client.complete(key)
    await record(
        row, key, "status", tr("«{0}» ← «{1}»", before.status, status), url=before.url,
        undo={"kind": "status", "to": before.status}, source=source,
    )
    return status


async def create(row: IntegrationAccount, client: Integration, draft: IssueDraft, source: dict[str, Any] | None = None) -> Issue:
    issue = await client.create_issue(draft)
    # Trackers rarely let an API delete an issue (and it shouldn't); closing it is the undo.
    await record(row, issue.key, "create", issue.title, url=issue.url, undo={"kind": "close"}, source=source)
    return issue


def _snapshot(issue: Issue, changes: IssueChanges) -> dict[str, Any]:
    """The fields a change touches, as they were, so undo can put them back."""
    old: dict[str, Any] = {}
    if changes.title is not None:
        old["title"] = issue.title
    if changes.description is not None:
        old["description"] = issue.description or ""
    if changes.labels is not None or changes.add_labels or changes.remove_labels:
        old["labels"] = list(issue.labels)
    if changes.due_date is not None:
        old["due_date"] = issue.due_date or ""
    if changes.priority is not None and issue.priority:
        old["priority"] = issue.priority
    return old


def describe(changes: IssueChanges) -> str:
    parts = []
    for name, value in changes.__dict__.items():
        if value is None or value == []:
            continue
        shown = value if not isinstance(value, str) or len(value) < 120 else value[:117] + "…"
        parts.append(f"{name}: {shown}")
    return "\n".join(parts)


async def update(row: IntegrationAccount, client: Integration, key: str, changes: IssueChanges, source: dict[str, Any] | None = None) -> Issue:
    before = await client.get_issue(key)
    issue = await client.update_issue(key, changes)
    await record(row, key, "update", describe(changes), url=issue.url, undo={"kind": "update", "fields": _snapshot(before, changes)}, source=source)
    return issue


async def link(row: IntegrationAccount, client: Integration, key: str, other: str, kind: str, source: dict[str, Any] | None = None) -> None:
    await client.link_issues(key, other, kind)
    await record(row, key, "link", f"{kind} {other}", source=source)


async def attach(row: IntegrationAccount, client: Integration, key: str, filename: str, data: bytes, mime: str, source: dict[str, Any] | None = None) -> str | None:
    url = await client.attach(key, filename, data, mime)
    await record(row, key, "attach", filename, url=url, source=source)
    return url


async def log_work(row: IntegrationAccount, client: Integration, key: str, seconds: int, note: str = "", source: dict[str, Any] | None = None) -> None:
    await client.log_work(key, seconds, note)
    await record(row, key, "worklog", tr("{0} دقيقة", max(1, round(seconds / 60))) + (f" — {note}" if note else ""), source=source)


async def undo(action_id: str) -> str:
    """Takes back one recorded change, where the tracker allows it. Returns what happened."""
    async with SessionLocal() as session:
        entry = await session.get(IntegrationAction, action_id)
    if not entry:
        raise IntegrationError(tr("ما لقيت هالتعديل."))
    if entry.undone_at:
        raise IntegrationError(tr("هالتعديل انلغى من قبل."))
    if not entry.undo:
        raise IntegrationError(tr("هالمنصّة ما بتسمح نتراجع عن هالنوع من التعديلات."))
    row = await account(entry.integration_id)
    client = client_for(row)
    plan = entry.undo
    kind = plan.get("kind")
    if kind == "delete_comment":
        await client.delete_comment(entry.key, str(plan.get("comment_id")))
        done = tr("انحذف التعليق")
    elif kind == "status":
        target = str(plan.get("to", ""))
        options = await client.list_statuses(entry.key)
        option = next((o for o in options if o.name.lower() == target.lower()), None)
        if not option:
            raise IntegrationError(tr("ما في انتقال متاح يرجّعها لـ «{0}» هلّق.", target))
        done = tr("رجعت «{0}»", await client.set_status(entry.key, option.id))
    elif kind == "update":
        fields = plan.get("fields") or {}
        await client.update_issue(entry.key, IssueChanges(**{k: v for k, v in fields.items() if k in IssueChanges.__dataclass_fields__}))
        done = tr("رجعت الحقول متل ما كانت")
    elif kind == "close":
        done = tr("انسكّرت «{0}»", await client.complete(entry.key))
    else:
        raise IntegrationError(tr("ما بعرف كيف أتراجع عن هالتعديل."))
    async with SessionLocal() as session:
        fresh = await session.get(IntegrationAction, action_id)
        if fresh:
            fresh.undone_at = datetime.now(UTC)
            await session.commit()
    await record(row, entry.key, "undo", f"{done} ({entry.action})", source={"by": "user"})
    return done
