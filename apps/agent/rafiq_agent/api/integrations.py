import asyncio
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rafiq_agent.api.deps import require_token
from rafiq_agent.integrations.base import Integration, IntegrationError, Issue
from rafiq_agent.integrations.providers import REGISTRY, build, secret_field
from rafiq_agent.storage.db import SessionLocal, get_session
from rafiq_agent.storage.models import IntegrationAccount
from rafiq_agent.storage.secrets import delete_api_key, get_api_key, store_api_key

router = APIRouter(prefix="/integrations", tags=["integrations"], dependencies=[Depends(require_token)])


class IntegrationCreate(BaseModel):
    provider: str
    name: str | None = None
    config: dict[str, Any] = {}


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


class IssueCommentOut(BaseModel):
    author: str
    body: str
    created_at: str | None = None


class IssueDetailOut(IssueOut):
    comments: list[IssueCommentOut] = []
    comments_error: str | None = None


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


def _out(row: IntegrationAccount) -> IntegrationOut:
    return IntegrationOut(
        id=row.id,
        provider=row.provider,
        name=row.name,
        config=row.config or {},
        account_label=row.account_label,
        verify_ok=row.verify_ok,
        verify_error=row.verify_error,
        verified_at=row.verified_at,
        created_at=row.created_at,
    )


def _client(row: IntegrationAccount) -> Integration:
    return build(row.provider, row.config or {}, get_api_key(row.secret_ref))


def _issue_out(integration_id: str, integration_name: str, provider: str, issue: Issue) -> IssueOut:
    return IssueOut(
        integration_id=integration_id,
        integration_name=integration_name,
        provider=provider,
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
    )


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
                "blurb": spec.blurb,
                "secret_field": secret_field(spec.id),
                "fields": [
                    {
                        "key": f.key,
                        "label": f.label,
                        "kind": f.kind,
                        "placeholder": f.placeholder,
                        "required": f.required,
                        "help": f.help,
                    }
                    for f in spec.fields
                ],
            }
        )
    return out


@router.get("", response_model=list[IntegrationOut])
async def list_integrations(session: AsyncSession = Depends(get_session)) -> list[IntegrationOut]:
    rows = (
        (await session.execute(select(IntegrationAccount).order_by(IntegrationAccount.created_at)))
        .scalars()
        .all()
    )
    return [_out(r) for r in rows]


@router.post("", response_model=IntegrationOut, status_code=201)
async def connect(body: IntegrationCreate, session: AsyncSession = Depends(get_session)) -> IntegrationOut:
    if body.provider not in REGISTRY:
        raise HTTPException(status_code=400, detail="مزوّد غير مدعوم")
    field = secret_field(body.provider)
    config = {k: v for k, v in body.config.items() if k != field and v not in (None, "")}
    secret = str(body.config.get(field) or "")
    if not secret:
        raise HTTPException(status_code=400, detail="لازم تحط المفتاح")

    # Only store a connection that actually answers.
    try:
        account = await build(body.provider, config, secret).verify()
    except IntegrationError as exc:
        raise HTTPException(status_code=400, detail=f"ما قدرت أتصل: {exc}") from exc
    except Exception as exc:  # noqa: BLE001 - network/parse failures are user-facing here
        raise HTTPException(status_code=400, detail=f"ما قدرت أتصل: {exc}") from exc

    row = IntegrationAccount(
        provider=body.provider,
        name=(body.name or "").strip() or REGISTRY[body.provider].spec.name,
        config=config,
        secret_ref=store_api_key(secret),
        account_label=account.label,
        verify_ok=True,
        verified_at=datetime.now(UTC),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _out(row)


@router.post("/{integration_id}/verify", response_model=IntegrationOut)
async def verify(integration_id: str, session: AsyncSession = Depends(get_session)) -> IntegrationOut:
    row = await session.get(IntegrationAccount, integration_id)
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    try:
        account = await _client(row).verify()
        row.verify_ok, row.verify_error, row.account_label = True, None, account.label
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


async def collect_issues(
    query: str | None = None, limit: int = 30, include_done: bool = False
) -> list[IssueOut]:
    """Assigned issues across every connected account, newest first."""
    async with SessionLocal() as session:
        rows = (await session.execute(select(IntegrationAccount))).scalars().all()
        accounts = [(r.id, r.name, r.provider, _client(r)) for r in rows if r.verify_ok is not False]

    async def fetch(entry: tuple[str, str, str, Integration]) -> list[IssueOut]:
        ident, name, provider, client = entry
        try:
            issues: list[Issue] = await client.list_issues(query, limit, include_done)
        except Exception:  # noqa: BLE001 - one broken connector shouldn't hide the rest
            return []
        return [_issue_out(ident, name, provider, i) for i in issues]

    batches = await asyncio.gather(*(fetch(a) for a in accounts))
    merged = [issue for batch in batches for issue in batch]
    merged.sort(key=lambda i: i.updated_at or "", reverse=True)
    return merged[:limit]


@router.get("/issues", response_model=list[IssueOut])
async def issues(query: str | None = None, limit: int = 30, include_done: bool = False) -> list[IssueOut]:
    return await collect_issues(query, limit, include_done)


async def _load(integration_id: str) -> Integration:
    async with SessionLocal() as session:
        row = await session.get(IntegrationAccount, integration_id)
    if not row:
        raise HTTPException(status_code=404, detail="integration not found")
    return _client(row)


# Registered before the catch-all detail route below: `{key:path}` is greedy, so a
# generic GET would otherwise swallow `/statuses` as part of the issue key.
@router.get("/{integration_id}/issues/{key:path}/statuses", response_model=list[StatusOptionOut])
async def issue_statuses(integration_id: str, key: str) -> list[StatusOptionOut]:
    """Where this issue can go from here — the tracker decides, we just offer the list."""
    client = await _load(integration_id)
    try:
        options = await client.list_statuses(key)
    except IntegrationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return [StatusOptionOut(id=o.id, name=o.name, category=o.category) for o in options]


@router.get("/{integration_id}/issues/{key:path}", response_model=IssueDetailOut)
async def issue_detail(integration_id: str, key: str) -> IssueDetailOut:
    async with SessionLocal() as session:
        row = await session.get(IntegrationAccount, integration_id)
    if not row:
        raise HTTPException(status_code=404, detail="integration not found")
    client = _client(row)
    try:
        issue = await client.get_issue(key)
    except IntegrationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    comments, error = [], None
    try:
        comments = [
            IssueCommentOut(author=c.author, body=c.body, created_at=c.created_at)
            for c in await client.list_comments(key)
        ]
    except Exception as exc:  # noqa: BLE001 - the issue itself still renders without its comments
        error = str(exc)[:200]

    base = _issue_out(row.id, row.name, row.provider, issue)
    return IssueDetailOut(**base.model_dump(), comments=comments, comments_error=error)


@router.post("/{integration_id}/issues/{key:path}/status")
async def set_issue_status(integration_id: str, key: str, body: StatusIn) -> dict[str, Any]:
    client = await _load(integration_id)
    try:
        if body.comment:
            await client.add_comment(key, body.comment)
        status = await client.set_status(key, body.status_id)
    except IntegrationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "status": status}


@router.post("/{integration_id}/issues/{key:path}/comment", status_code=202)
async def comment(integration_id: str, key: str, body: CommentIn) -> dict[str, bool]:
    client = await _load(integration_id)
    try:
        await client.add_comment(key, body.body)
    except IntegrationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}


@router.post("/{integration_id}/issues/{key:path}/complete")
async def complete(integration_id: str, key: str, body: CompleteIn) -> dict[str, Any]:
    client = await _load(integration_id)
    try:
        if body.comment:
            await client.add_comment(key, body.comment)
        status = await client.complete(key)
    except IntegrationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "status": status}
