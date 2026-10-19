import asyncio
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from rafiq_agent.api.deps import require_token
from rafiq_agent.core import issue_watch
from rafiq_agent.core import issues as svc
from rafiq_agent.i18n import tr
from rafiq_agent.integrations import channels, oauth
from rafiq_agent.integrations.base import (
    CAPABILITIES,
    Integration,
    IntegrationError,
    Issue,
    IssueChanges,
    IssueDraft,
)
from rafiq_agent.integrations.providers import REGISTRY, build, secret_field
from rafiq_agent.storage.db import SessionLocal, get_session
from rafiq_agent.storage.models import IntegrationAccount, IntegrationAction, IssueNotice, NotifyChannel, Task
from rafiq_agent.storage.secrets import delete_api_key, get_api_key, replace_api_key, store_api_key

router = APIRouter(prefix="/integrations", tags=["integrations"], dependencies=[Depends(require_token)])
USER = {"by": "user"}
MAX_UPLOAD = 25 * 1024 * 1024


# ── Shapes ───────────────────────────────────────────────────────────────────────────────


class IntegrationCreate(BaseModel):
    provider: str
    name: str | None = None
    config: dict[str, Any] = {}


class IntegrationRename(BaseModel):
    name: str | None = None
    config: dict[str, Any] | None = None  # connection fields; the secret field replaces the stored key


class IntegrationOut(BaseModel):
    id: str
    provider: str
    name: str
    config: dict[str, Any]
    account_label: str | None
    verify_ok: bool | None
    verify_error: str | None
    verified_at: datetime | None
    created_at: datetime
    settings: svc.AccountSettings
    capabilities: list[str]
    last_check: str | None = None
    watch_error: str | None = None


class IssueOut(BaseModel):
    integration_id: str
    integration_name: str
    provider: str
    key: str
    title: str
    url: str
    status: str
    status_category: str | None = None
    project: str | None = None
    updated_at: str | None = None
    created_at: str | None = None
    description: str | None = None
    priority: str | None = None
    issue_type: str | None = None
    assignee: str | None = None
    reporter: str | None = None
    labels: list[str] = []
    due_date: str | None = None
    parent: str | None = None
    milestone: str | None = None
    estimate: str | None = None
    comment_count: int | None = None
    attachments: list[dict[str, Any]] = []
    subtasks: list[str] = []
    links: list[dict[str, Any]] = []
    kind: str = "issue"
    project_key: str | None = None


class IssueCommentOut(BaseModel):
    author: str
    body: str
    created_at: str | None = None
    id: str | None = None
    mine: bool = False


class DevLinkOut(BaseModel):
    kind: str
    title: str
    url: str
    state: str | None = None


class LinkedTaskOut(BaseModel):
    id: str
    title: str
    status: str
    created_at: datetime
    branch: str | None = None
    pr_url: str | None = None


class IssueDetailOut(IssueOut):
    comments: list[IssueCommentOut] = []
    comments_error: str | None = None
    dev: list[DevLinkOut] = []
    tasks: list[LinkedTaskOut] = []


class CommentIn(BaseModel):
    body: str


class CompleteIn(BaseModel):
    comment: str | None = None


class StatusOptionOut(BaseModel):
    id: str
    name: str
    category: str | None = None


class StatusIn(BaseModel):
    status_id: str
    comment: str | None = None


class CreateIn(BaseModel):
    project: str
    title: str = Field(min_length=1)
    description: str = ""
    issue_type: str | None = None
    labels: list[str] = []
    assignee: str | None = None
    priority: str | None = None
    due_date: str | None = None
    parent: str | None = None
    estimate_hours: float | None = None


class UpdateIn(BaseModel):
    title: str | None = None
    description: str | None = None
    labels: list[str] | None = None
    add_labels: list[str] = []
    remove_labels: list[str] = []
    assignee: str | None = None
    priority: str | None = None
    due_date: str | None = None
    estimate_hours: float | None = None
    parent: str | None = None


class LinkIn(BaseModel):
    other: str
    kind: Literal["relates", "blocks", "blocked_by", "duplicates"] = "relates"


class WorklogIn(BaseModel):
    minutes: float = Field(gt=0)
    note: str = ""


class BulkItem(BaseModel):
    integration_id: str
    key: str


class BulkIn(BaseModel):
    items: list[BulkItem] = Field(min_length=1, max_length=100)
    action: Literal["complete", "status", "comment", "assign_me", "add_label", "remove_label", "unassign"]
    value: str | None = None


class BulkResult(BaseModel):
    key: str
    ok: bool
    message: str


class MetaOut(BaseModel):
    issue_types: list[dict[str, Any]] = []
    people: list[dict[str, Any]] = []
    labels: list[str] = []
    priorities: list[str] = []


class ActionOut(BaseModel):
    id: str
    integration_id: str
    provider: str
    key: str
    action: str
    summary: str
    url: str | None
    can_undo: bool
    undone_at: datetime | None
    source: dict[str, Any] | None
    created_at: datetime


class NoticeOut(BaseModel):
    id: str
    integration_id: str
    kind: str
    key: str
    title: str
    url: str | None
    actor: str | None
    text: str | None
    happened_at: str | None
    read_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ReadIn(BaseModel):
    ids: list[str] = []
    all: bool = False


class ChannelIn(BaseModel):
    kind: Literal["slack", "teams", "discord"]
    name: str = Field(min_length=1, max_length=80)
    url: str | None = None  # required when creating
    events: list[str] = Field(default_factory=lambda: ["mention", "review", "task_done"])


class ChannelOut(BaseModel):
    id: str
    kind: str
    name: str
    events: list[str]
    created_at: datetime


# ── Helpers ──────────────────────────────────────────────────────────────────────────────


def _out(row: IntegrationAccount) -> IntegrationOut:
    config = {k: v for k, v in (row.config or {}).items() if not k.startswith("_")}
    cls = REGISTRY.get(row.provider)
    state = row.state or {}
    return IntegrationOut(
        id=row.id,
        provider=row.provider,
        name=row.name,
        config=config,
        account_label=row.account_label,
        verify_ok=row.verify_ok,
        verify_error=row.verify_error,
        verified_at=row.verified_at,
        created_at=row.created_at,
        settings=svc.settings_of(row),
        capabilities=sorted(cls.capabilities) if cls else [],
        last_check=state.get("last_check"),
        watch_error=state.get("error"),
    )


def _issue_out(row: IntegrationAccount, issue: Issue) -> IssueOut:
    return IssueOut(
        integration_id=row.id,
        integration_name=row.name,
        provider=row.provider,
        key=issue.key,
        title=issue.title,
        url=issue.url,
        status=issue.status,
        status_category=issue.status_category,
        project=issue.project,
        updated_at=issue.updated_at,
        created_at=issue.created_at,
        description=(issue.description or "")[:20000] or None,
        priority=issue.priority,
        issue_type=issue.issue_type,
        assignee=issue.assignee,
        reporter=issue.reporter,
        labels=issue.labels,
        due_date=issue.due_date,
        parent=issue.parent,
        milestone=issue.milestone,
        estimate=issue.estimate,
        comment_count=issue.comment_count,
        attachments=issue.attachments[:50],
        subtasks=issue.subtasks[:100],
        links=issue.links[:50],
        kind=issue.kind,
        project_key=str(
            issue.extra.get("project_key") or issue.extra.get("team_key") or issue.extra.get("project") or issue.extra.get("board") or issue.extra.get("list_id") or issue.project or ""
        ) or None,
    )


def _fail(exc: Exception) -> HTTPException:
    return HTTPException(status_code=400, detail=str(exc))


async def _row(integration_id: str) -> tuple[IntegrationAccount, Integration]:
    try:
        row = await svc.account(integration_id)
    except IntegrationError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return row, svc.client_for(row)


# ── Providers and accounts ─────────────────────────────────────────────────────────────


@router.get("/providers")
async def providers() -> list[dict[str, Any]]:
    out = []
    for cls in REGISTRY.values():
        spec = cls.spec
        out.append(
            {
                "id": spec.id,
                "name": spec.name,
                "icon": spec.icon,
                "color": spec.color,
                "docs_url": spec.docs_url,
                "token_url": spec.token_url or spec.docs_url,
                "blurb": tr(spec.blurb),
                "scopes": tr(spec.scopes) if spec.scopes else "",
                "group": spec.group,
                "secret_field": secret_field(spec.id),
                "capabilities": sorted(cls.capabilities),
                "fields": [
                    {
                        "key": f.key,
                        "label": tr(f.label),
                        "kind": f.kind,
                        "placeholder": f.placeholder,
                        "required": f.required,
                        "help": tr(f.help) if f.help else "",
                    }
                    for f in spec.fields
                ],
            }
        )
    return out


@router.get("/capabilities")
async def capabilities() -> dict[str, Any]:
    """What each provider can do, for the comparison table."""
    return {"capabilities": list(CAPABILITIES), "providers": {k: sorted(v.capabilities) for k, v in REGISTRY.items()}}


@router.get("", response_model=list[IntegrationOut])
async def list_integrations(session: AsyncSession = Depends(get_session)) -> list[IntegrationOut]:
    rows = (await session.execute(select(IntegrationAccount).order_by(IntegrationAccount.created_at))).scalars().all()
    return [_out(r) for r in rows]


@router.post("", response_model=IntegrationOut, status_code=201)
async def connect(body: IntegrationCreate, session: AsyncSession = Depends(get_session)) -> IntegrationOut:
    if body.provider not in REGISTRY:
        raise HTTPException(status_code=400, detail=tr("مزوّد غير مدعوم"))
    field = secret_field(body.provider)
    config = {k: v for k, v in body.config.items() if k != field and not k.startswith("_") and v not in (None, "")}
    secret = str(body.config.get(field) or "").strip()
    if not secret:
        raise HTTPException(status_code=400, detail=tr("لازم تحط المفتاح"))
    # Only store a connection that actually answers.
    try:
        account = await build(body.provider, config, secret).verify()
    except Exception as exc:  # noqa: BLE001 - network/parse failures are user-facing here
        raise HTTPException(status_code=400, detail=tr("ما قدرت أتصل: {0}", exc)) from exc
    row = IntegrationAccount(
        provider=body.provider,
        name=(body.name or "").strip() or REGISTRY[body.provider].spec.name,
        # The account's own ids (not secrets) — what "me" means when assigning.
        config={**config, "_account": account.meta},
        secret_ref=store_api_key(secret),
        account_label=account.label,
        verify_ok=True,
        verified_at=datetime.now(UTC),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _out(row)


class OAuthStartIn(BaseModel):
    provider: Literal["github", "gitlab"]
    client_id: str = Field(min_length=1)
    base_url: str = ""
    name: str | None = None


class OAuthPollIn(BaseModel):
    flow_id: str


@router.post("/oauth/start")
async def oauth_start(body: OAuthStartIn) -> dict[str, Any]:
    """Device sign-in: returns the code to show and the page to enter it on."""
    try:
        return await oauth.start(body.provider, body.client_id, body.base_url, body.name)
    except IntegrationError as exc:
        raise _fail(exc) from exc


@router.post("/oauth/poll")
async def oauth_poll(body: OAuthPollIn, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    flow = oauth.FLOWS.get(body.flow_id)
    try:
        status, secret = await oauth.poll(body.flow_id)
    except IntegrationError as exc:
        raise _fail(exc) from exc
    if status != "done" or not secret or not flow:
        return {"status": status}
    config: dict[str, Any] = {"auth": "oauth", "client_id": flow.client_id}
    if flow.host:
        config["base_url"] = flow.host
    try:
        account = await build(flow.provider, config, secret).verify()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=tr("ما قدرت أتصل: {0}", exc)) from exc
    row = IntegrationAccount(
        provider=flow.provider,
        name=(flow.name or "").strip() or REGISTRY[flow.provider].spec.name,
        config={**config, "_account": account.meta},
        secret_ref=store_api_key(secret),
        account_label=account.label,
        verify_ok=True,
        verified_at=datetime.now(UTC),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return {"status": "done", "integration": _out(row).model_dump(mode="json")}


@router.patch("/{integration_id}", response_model=IntegrationOut)
async def edit(integration_id: str, body: IntegrationRename, session: AsyncSession = Depends(get_session)) -> IntegrationOut:
    row = await session.get(IntegrationAccount, integration_id)
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    if body.name is not None and body.name.strip():
        row.name = body.name.strip()
    if body.config is not None:
        field = secret_field(row.provider)
        config = {**(row.config or {}), **{k: v for k, v in body.config.items() if k != field and not k.startswith("_")}}
        secret = str(body.config.get(field) or "").strip() or get_api_key(row.secret_ref) or ""
        try:
            account = await build(row.provider, config, secret).verify()
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=400, detail=tr("ما قدرت أتصل: {0}", exc)) from exc
        config["_account"] = account.meta
        row.config = config
        if body.config.get(field):
            if row.secret_ref:
                replace_api_key(row.secret_ref, secret)
            else:
                row.secret_ref = store_api_key(secret)
        row.account_label, row.verify_ok, row.verify_error = account.label, True, None
        row.verified_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(row)
    return _out(row)


@router.put("/{integration_id}/settings", response_model=IntegrationOut)
async def save_settings(integration_id: str, body: svc.AccountSettings, session: AsyncSession = Depends(get_session)) -> IntegrationOut:
    row = await session.get(IntegrationAccount, integration_id)
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    row.settings = body.model_dump()
    await session.commit()
    await session.refresh(row)
    return _out(row)


@router.post("/{integration_id}/verify", response_model=IntegrationOut)
async def verify(integration_id: str, session: AsyncSession = Depends(get_session)) -> IntegrationOut:
    row = await session.get(IntegrationAccount, integration_id)
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    try:
        account = await svc.client_for(row).verify()
        row.verify_ok, row.verify_error, row.account_label = True, None, account.label
        row.config = {**(row.config or {}), "_account": account.meta}
    except Exception as exc:  # noqa: BLE001 - surfaced on the card
        row.verify_ok, row.verify_error = False, str(exc)[:300]
    row.verified_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(row)
    return _out(row)


@router.delete("/{integration_id}", status_code=204)
async def disconnect(integration_id: str, session: AsyncSession = Depends(get_session)) -> None:
    row = await session.get(IntegrationAccount, integration_id)
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    delete_api_key(row.secret_ref)
    await session.delete(row)
    await session.commit()


# ── Lists across accounts ──────────────────────────────────────────────────────────────


async def collect_issues(
    query: str | None = None, limit: int = 30, include_done: bool = False, integration_id: str | None = None
) -> list[IssueOut]:
    """Assigned issues across every connected account, newest first."""
    rows = [r for r in await svc.accounts() if not integration_id or r.id == integration_id]

    async def fetch(row: IntegrationAccount) -> list[IssueOut]:
        try:
            issues = await svc.client_for(row).list_issues(query, limit, include_done)
        except Exception:  # noqa: BLE001 - one broken connector shouldn't hide the rest
            return []
        return [_issue_out(row, i) for i in issues]

    batches = await asyncio.gather(*(fetch(r) for r in rows))
    merged = [issue for batch in batches for issue in batch]
    merged.sort(key=lambda i: i.updated_at or "", reverse=True)
    return merged[:limit]


@router.get("/issues", response_model=list[IssueOut])
async def issues(query: str | None = None, limit: int = 60, include_done: bool = False, integration_id: str | None = None) -> list[IssueOut]:
    return await collect_issues(query, max(1, min(limit, 200)), include_done, integration_id)


@router.get("/reviews", response_model=list[IssueOut])
async def reviews() -> list[IssueOut]:
    """Pull and merge requests waiting for the user's review, everywhere."""

    async def fetch(row: IntegrationAccount) -> list[IssueOut]:
        client = svc.client_for(row)
        if not client.supports("reviews"):
            return []
        try:
            return [_issue_out(row, i) for i in await client.review_requests(50)]
        except Exception:  # noqa: BLE001
            return []

    batches = await asyncio.gather(*(fetch(r) for r in await svc.accounts()))
    return sorted((i for b in batches for i in b), key=lambda i: i.updated_at or i.created_at or "", reverse=True)


@router.get("/{integration_id}/search", response_model=list[IssueOut])
async def search(integration_id: str, q: str, limit: int = 50) -> list[IssueOut]:
    row, client = await _row(integration_id)
    try:
        return [_issue_out(row, i) for i in await client.search(q, max(1, min(limit, 200)))]
    except IntegrationError as exc:
        raise _fail(exc) from exc


@router.get("/{integration_id}/sprint")
async def sprint(integration_id: str, project: str | None = None, mine: bool = False) -> dict[str, Any]:
    row, client = await _row(integration_id)
    try:
        name, found = await client.sprint(project, mine)
    except IntegrationError as exc:
        raise _fail(exc) from exc
    return {"name": name, "issues": [_issue_out(row, i).model_dump() for i in found]}


@router.get("/{integration_id}/views/{view_id}", response_model=list[IssueOut])
async def run_view(integration_id: str, view_id: str) -> list[IssueOut]:
    row, client = await _row(integration_id)
    view = next((v for v in svc.settings_of(row).views if v.id == view_id), None)
    if not view:
        raise HTTPException(status_code=404, detail="view not found")
    try:
        if view.kind == "sprint":
            found = (await client.sprint(view.query or None, False))[1]
        elif view.kind == "reviews":
            found = await client.review_requests(50)
        else:
            found = await client.search(view.query, 100)
    except IntegrationError as exc:
        raise _fail(exc) from exc
    return [_issue_out(row, i) for i in found]


@router.get("/{integration_id}/projects")
async def projects(integration_id: str) -> list[dict[str, Any]]:
    _, client = await _row(integration_id)
    try:
        return [p.__dict__ for p in await client.list_projects()]
    except IntegrationError as exc:
        raise _fail(exc) from exc


@router.get("/{integration_id}/meta", response_model=MetaOut)
async def meta(integration_id: str, project: str | None = None) -> MetaOut:
    """What a create/edit form offers for a project: types, people, labels, priorities."""
    _, client = await _row(integration_id)
    out = MetaOut()

    async def soft(coro: Any, default: Any) -> Any:
        try:
            return await coro
        except Exception:  # noqa: BLE001 - a form with fewer choices is still a form
            return default

    if project:
        out.issue_types = [t.__dict__ for t in await soft(client.list_issue_types(project), [])]
        out.people = [p.__dict__ for p in await soft(client.list_users(project, ""), [])]
        out.labels = await soft(client.list_labels(project), [])
    out.priorities = await soft(client.list_priorities(), [])
    return out


# ── One issue ────────────────────────────────────────────────────────────────────────────


async def _tasks_for(integration_id: str, key: str) -> list[LinkedTaskOut]:
    async with SessionLocal() as session:
        rows = (await session.execute(select(Task).where(Task.issue.is_not(None)).order_by(Task.created_at.desc()).limit(500))).scalars().all()
    return [
        LinkedTaskOut(id=t.id, title=t.title, status=t.status, created_at=t.created_at, branch=(t.issue or {}).get("branch"), pr_url=(t.issue or {}).get("pr_url"))
        for t in rows
        if (t.issue or {}).get("integration_id") == integration_id and (t.issue or {}).get("key") == key
    ]


# Registered before the catch-all detail route below: `{key:path}` is greedy, so a
# generic GET would otherwise swallow `/statuses` as part of the issue key.
@router.get("/{integration_id}/issues/{key:path}/statuses", response_model=list[StatusOptionOut])
async def issue_statuses(integration_id: str, key: str) -> list[StatusOptionOut]:
    """Where this issue can go from here — the tracker decides, we just offer the list."""
    _, client = await _row(integration_id)
    try:
        options = await client.list_statuses(key)
    except IntegrationError as exc:
        raise _fail(exc) from exc
    return [StatusOptionOut(id=o.id, name=o.name, category=o.category) for o in options]


@router.get("/{integration_id}/issues/{key:path}/dev", response_model=list[DevLinkOut])
async def issue_dev(integration_id: str, key: str) -> list[DevLinkOut]:
    _, client = await _row(integration_id)
    try:
        return [DevLinkOut(kind=d.kind, title=d.title, url=d.url, state=d.state) for d in await client.dev_links(key)]
    except IntegrationError as exc:
        raise _fail(exc) from exc


@router.get("/{integration_id}/issues/{key:path}", response_model=IssueDetailOut)
async def issue_detail(integration_id: str, key: str) -> IssueDetailOut:
    row, client = await _row(integration_id)
    try:
        issue = await client.get_issue(key)
    except IntegrationError as exc:
        raise _fail(exc) from exc

    comments: list[IssueCommentOut] = []
    error = None
    try:
        comments = [
            IssueCommentOut(author=c.author, body=c.body, created_at=c.created_at, id=c.id, mine=c.mine)
            for c in await client.list_comments(key)
        ]
        comments.sort(key=lambda c: c.created_at or "")
    except Exception as exc:  # noqa: BLE001 - the issue itself still renders without its comments
        error = str(exc)[:200]
    dev: list[DevLinkOut] = []
    if client.supports("dev"):
        try:
            dev = [DevLinkOut(kind=d.kind, title=d.title, url=d.url, state=d.state) for d in await client.dev_links(key)]
        except Exception:  # noqa: BLE001
            dev = []
    base = _issue_out(row, issue)
    return IssueDetailOut(**base.model_dump(), comments=comments, comments_error=error, dev=dev, tasks=await _tasks_for(row.id, issue.key))


@router.post("/{integration_id}/issues", response_model=IssueOut, status_code=201)
async def create_issue(integration_id: str, body: CreateIn) -> IssueOut:
    row, client = await _row(integration_id)
    try:
        issue = await svc.create(row, client, IssueDraft(**body.model_dump()), USER)
    except IntegrationError as exc:
        raise _fail(exc) from exc
    return _issue_out(row, issue)


@router.patch("/{integration_id}/issues/{key:path}", response_model=IssueOut)
async def update_issue(integration_id: str, key: str, body: UpdateIn) -> IssueOut:
    row, client = await _row(integration_id)
    changes = IssueChanges(**body.model_dump())
    if changes.empty():
        raise HTTPException(status_code=400, detail=tr("ما في شي لأعدّله."))
    try:
        return _issue_out(row, await svc.update(row, client, key, changes, USER))
    except IntegrationError as exc:
        raise _fail(exc) from exc


@router.post("/{integration_id}/issues/{key:path}/status")
async def set_issue_status(integration_id: str, key: str, body: StatusIn) -> dict[str, Any]:
    row, client = await _row(integration_id)
    try:
        if body.comment:
            await svc.comment(row, client, key, body.comment, USER)
        status = await svc.set_status(row, client, key, body.status_id, USER)
    except IntegrationError as exc:
        raise _fail(exc) from exc
    return {"ok": True, "status": status}


@router.post("/{integration_id}/issues/{key:path}/comment", status_code=202)
async def comment(integration_id: str, key: str, body: CommentIn) -> dict[str, Any]:
    row, client = await _row(integration_id)
    try:
        comment_id = await svc.comment(row, client, key, body.body, USER)
    except IntegrationError as exc:
        raise _fail(exc) from exc
    return {"ok": True, "id": comment_id}


@router.put("/{integration_id}/issues/{key:path}/comments/{comment_id}")
async def edit_comment(integration_id: str, key: str, comment_id: str, body: CommentIn) -> dict[str, bool]:
    row, client = await _row(integration_id)
    try:
        await client.edit_comment(key, comment_id, body.body)
        await svc.record(row, key, "comment_edit", body.body, source=USER)
    except IntegrationError as exc:
        raise _fail(exc) from exc
    return {"ok": True}


@router.delete("/{integration_id}/issues/{key:path}/comments/{comment_id}")
async def delete_comment(integration_id: str, key: str, comment_id: str) -> dict[str, bool]:
    row, client = await _row(integration_id)
    try:
        await client.delete_comment(key, comment_id)
        await svc.record(row, key, "comment_delete", comment_id, source=USER)
    except IntegrationError as exc:
        raise _fail(exc) from exc
    return {"ok": True}


@router.post("/{integration_id}/issues/{key:path}/complete")
async def complete(integration_id: str, key: str, body: CompleteIn) -> dict[str, Any]:
    row, client = await _row(integration_id)
    try:
        if body.comment:
            await svc.comment(row, client, key, body.comment, USER)
        status = await svc.complete(row, client, key, USER)
    except IntegrationError as exc:
        raise _fail(exc) from exc
    return {"ok": True, "status": status}


@router.post("/{integration_id}/issues/{key:path}/link")
async def link(integration_id: str, key: str, body: LinkIn) -> dict[str, bool]:
    row, client = await _row(integration_id)
    try:
        await svc.link(row, client, key, body.other, body.kind, USER)
    except IntegrationError as exc:
        raise _fail(exc) from exc
    return {"ok": True}


@router.post("/{integration_id}/issues/{key:path}/worklog")
async def worklog(integration_id: str, key: str, body: WorklogIn) -> dict[str, bool]:
    row, client = await _row(integration_id)
    try:
        await svc.log_work(row, client, key, int(body.minutes * 60), body.note, USER)
    except IntegrationError as exc:
        raise _fail(exc) from exc
    return {"ok": True}


@router.post("/{integration_id}/issues/{key:path}/attach")
async def attach(integration_id: str, key: str, file: UploadFile = File(...), name: str | None = Form(None)) -> dict[str, Any]:
    row, client = await _row(integration_id)
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(status_code=413, detail=tr("الملف أكبر من 25 ميغا."))
    try:
        url = await svc.attach(row, client, key, name or file.filename or "file", data, file.content_type or "application/octet-stream", USER)
    except IntegrationError as exc:
        raise _fail(exc) from exc
    return {"ok": True, "url": url}


@router.post("/bulk", response_model=list[BulkResult])
async def bulk(body: BulkIn) -> list[BulkResult]:
    """One action on many issues; each one reports on its own."""
    results: list[BulkResult] = []
    for item in body.items:
        try:
            row, client = await _row(item.integration_id)
            if body.action == "complete":
                message = await svc.complete(row, client, item.key, USER)
            elif body.action == "status":
                if not body.value:
                    raise IntegrationError(tr("حدد الحالة."))
                option = next((o for o in await client.list_statuses(item.key) if body.value.lower() in (o.id.lower(), o.name.lower())), None)
                if not option:
                    raise IntegrationError(tr("ما في حالة «{0}» لهالمهمة.", body.value))
                message = await svc.set_status(row, client, item.key, option.id, USER)
            elif body.action == "comment":
                if not body.value:
                    raise IntegrationError(tr("اكتب التعليق."))
                await svc.comment(row, client, item.key, body.value, USER)
                message = tr("انكتب التعليق")
            elif body.action in ("assign_me", "unassign"):
                await svc.update(row, client, item.key, IssueChanges(assignee="me" if body.action == "assign_me" else ""), USER)
                message = tr("تعدّل المسؤول")
            else:
                if not body.value:
                    raise IntegrationError(tr("حدد الوسم."))
                field = "add_labels" if body.action == "add_label" else "remove_labels"
                await svc.update(row, client, item.key, IssueChanges(**{field: [body.value]}), USER)
                message = tr("تعدّلت الوسوم")
            results.append(BulkResult(key=item.key, ok=True, message=message))
        except (IntegrationError, HTTPException) as exc:
            detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
            results.append(BulkResult(key=item.key, ok=False, message=str(detail)))
    return results


# ── What Rafiq changed, and undo ───────────────────────────────────────────────────────


@router.get("/actions", response_model=list[ActionOut])
async def actions(limit: int = 100, integration_id: str | None = None, key: str | None = None) -> list[ActionOut]:
    query = select(IntegrationAction).order_by(IntegrationAction.created_at.desc()).limit(max(1, min(limit, 500)))
    if integration_id:
        query = query.where(IntegrationAction.integration_id == integration_id)
    if key:
        query = query.where(IntegrationAction.key == key)
    async with SessionLocal() as session:
        rows = (await session.execute(query)).scalars().all()
    return [
        ActionOut(
            id=r.id, integration_id=r.integration_id, provider=r.provider, key=r.key, action=r.action, summary=r.summary,
            url=r.url, can_undo=bool(r.undo) and not r.undone_at, undone_at=r.undone_at, source=r.source, created_at=r.created_at,
        )
        for r in rows
    ]


@router.post("/actions/{action_id}/undo")
async def undo(action_id: str) -> dict[str, Any]:
    try:
        return {"ok": True, "message": await svc.undo(action_id)}
    except IntegrationError as exc:
        raise _fail(exc) from exc


# ── Notices ──────────────────────────────────────────────────────────────────────────────


@router.get("/notices", response_model=list[NoticeOut])
async def notices(unread_only: bool = False, limit: int = 50, after: datetime | None = None) -> list[NoticeOut]:
    query = select(IssueNotice).order_by(IssueNotice.created_at.desc()).limit(max(1, min(limit, 200)))
    if unread_only:
        query = query.where(IssueNotice.read_at.is_(None))
    if after:
        query = query.where(IssueNotice.created_at > after)
    async with SessionLocal() as session:
        rows = (await session.execute(query)).scalars().all()
    return [NoticeOut.model_validate(r) for r in rows]


@router.post("/notices/read")
async def mark_read(body: ReadIn) -> dict[str, bool]:
    stmt = update(IssueNotice).where(IssueNotice.read_at.is_(None))
    if not body.all:
        if not body.ids:
            return {"ok": True}
        stmt = stmt.where(IssueNotice.id.in_(body.ids))
    async with SessionLocal() as session:
        await session.execute(stmt.values(read_at=datetime.now(UTC)))
        await session.commit()
    return {"ok": True}


@router.post("/poll")
async def poll_now() -> dict[str, int]:
    """Look now instead of waiting for the next round."""
    return {"new": await issue_watch.poll_all(force=True)}


# ── Team channels ──────────────────────────────────────────────────────────────────────


def _channel_out(row: NotifyChannel) -> ChannelOut:
    return ChannelOut(id=row.id, kind=row.kind, name=row.name, events=list(row.events or []), created_at=row.created_at)


@router.get("/channels", response_model=list[ChannelOut])
async def list_channels(session: AsyncSession = Depends(get_session)) -> list[ChannelOut]:
    rows = (await session.execute(select(NotifyChannel).order_by(NotifyChannel.created_at))).scalars().all()
    return [_channel_out(r) for r in rows]


@router.post("/channels", response_model=ChannelOut, status_code=201)
async def add_channel(body: ChannelIn, session: AsyncSession = Depends(get_session)) -> ChannelOut:
    url = (body.url or "").strip()
    try:
        channels.check_url(body.kind, url)
    except IntegrationError as exc:
        raise _fail(exc) from exc
    row = NotifyChannel(kind=body.kind, name=body.name.strip(), secret_ref=store_api_key(url), events=[e for e in body.events if e in channels.EVENTS])
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _channel_out(row)


@router.put("/channels/{channel_id}", response_model=ChannelOut)
async def edit_channel(channel_id: str, body: ChannelIn, session: AsyncSession = Depends(get_session)) -> ChannelOut:
    row = await session.get(NotifyChannel, channel_id)
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    row.name, row.events = body.name.strip(), [e for e in body.events if e in channels.EVENTS]
    if body.url and body.url.strip():
        try:
            channels.check_url(row.kind, body.url.strip())
        except IntegrationError as exc:
            raise _fail(exc) from exc
        if row.secret_ref:
            replace_api_key(row.secret_ref, body.url.strip())
        else:
            row.secret_ref = store_api_key(body.url.strip())
    await session.commit()
    await session.refresh(row)
    return _channel_out(row)


@router.delete("/channels/{channel_id}", status_code=204)
async def remove_channel(channel_id: str, session: AsyncSession = Depends(get_session)) -> None:
    row = await session.get(NotifyChannel, channel_id)
    if row:
        delete_api_key(row.secret_ref)
        await session.delete(row)
        await session.commit()


@router.post("/channels/{channel_id}/test")
async def test_channel(channel_id: str, session: AsyncSession = Depends(get_session)) -> dict[str, bool]:
    row = await session.get(NotifyChannel, channel_id)
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    url = get_api_key(row.secret_ref)
    if not url:
        raise HTTPException(status_code=400, detail=tr("رابط الـ webhook مو محفوظ."))
    try:
        await channels.post(row.kind, url, tr("رفيق متصل ✓"), tr("هون رح توصلك التنبيهات والملخصات اللي اخترتها."))
    except IntegrationError as exc:
        raise _fail(exc) from exc
    return {"ok": True}
