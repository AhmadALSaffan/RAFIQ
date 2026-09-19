"""Templates, schedules and MCP servers."""

import asyncio
import contextlib
import json
import shutil
from datetime import UTC, datetime
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rafiq_agent import mcp_oauth
from rafiq_agent.api.deps import require_token
from rafiq_agent.core.schedules import next_run, parse_time, start_now
from rafiq_agent.core.tasks_service import TaskCreateError, resolve_working_dir
from rafiq_agent.i18n import tr
from rafiq_agent.mcp_bridge import MANAGER, load_secrets, save_secrets, secret_name
from rafiq_agent.schemas.automation import (
    CatalogOut,
    CatalogTemplate,
    McpConnectOut,
    McpRequirementsOut,
    McpServerIn,
    McpServerOut,
    McpStatus,
    ScheduleIn,
    ScheduleOut,
    TemplateImportIn,
    TemplateIn,
    TemplateOut,
)
from rafiq_agent.storage.db import get_session
from rafiq_agent.storage.models import LlmModel, McpServer, Schedule, TaskTemplate
from rafiq_agent.storage.secrets import delete_named_secret

router = APIRouter(tags=["automation"], dependencies=[Depends(require_token)])


def _folder(raw: str | None) -> str | None:
    if not raw:
        return None
    try:
        directory = resolve_working_dir(raw)
    except TaskCreateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return str(directory) if directory else None


# ── Templates ─────────────────────────────────────────────────────────────────────────


@router.get("/templates", response_model=list[TemplateOut])
async def list_templates(session: AsyncSession = Depends(get_session)) -> list[TaskTemplate]:
    rows = await session.execute(select(TaskTemplate).order_by(TaskTemplate.created_at.desc()))
    return list(rows.scalars().all())


@router.post("/templates", response_model=TemplateOut, status_code=201)
async def create_template(body: TemplateIn, session: AsyncSession = Depends(get_session)) -> TaskTemplate:
    template = TaskTemplate(
        name=body.name.strip(), prompt=body.prompt, model_id=body.model_id, working_dir=_folder(body.working_dir)
    )
    session.add(template)
    await session.commit()
    await session.refresh(template)
    return template


CATALOG_FILE = Path(__file__).resolve().parent.parent / "data" / "templates_catalog.json"
CATALOG_URL = "https://raw.githubusercontent.com/AhmadALSaffan/RAFIQ/main/apps/agent/rafiq_agent/data/templates_catalog.json"


def _catalog_items(raw: object) -> list[CatalogTemplate]:
    items = raw.get("templates", []) if isinstance(raw, dict) else raw
    out = []
    for item in items if isinstance(items, list) else []:
        if isinstance(item, dict) and str(item.get("name", "")).strip() and str(item.get("prompt", "")).strip():
            out.append(
                CatalogTemplate(
                    name=str(item["name"]).strip()[:120],
                    prompt=str(item["prompt"]),
                    tags=[str(t) for t in item.get("tags", []) if str(t)][:6],
                )
            )
    return out[:200]


@router.get("/templates/catalog", response_model=CatalogOut)
async def template_catalog() -> CatalogOut:
    """Community templates: the latest list from the repository, else the copy that ships
    with the app."""
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(CATALOG_URL, follow_redirects=True)
            response.raise_for_status()
            items = _catalog_items(response.json())
            if items:
                return CatalogOut(source="remote", templates=items)
    except Exception:  # noqa: BLE001 - offline is normal
        pass
    try:
        items = _catalog_items(json.loads(CATALOG_FILE.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        items = []
    return CatalogOut(source="bundled", templates=items)


@router.get("/templates/export", response_model=list[TemplateIn])
async def export_templates(session: AsyncSession = Depends(get_session)) -> list[TemplateIn]:
    """The user's templates as a list they can share or import elsewhere (no model ids or
    folders — those are machine-specific)."""
    rows = await session.execute(select(TaskTemplate).order_by(TaskTemplate.created_at))
    return [TemplateIn(name=t.name, prompt=t.prompt) for t in rows.scalars().all()]


@router.post("/templates/import", response_model=list[TemplateOut], status_code=201)
async def import_templates(body: TemplateImportIn, session: AsyncSession = Depends(get_session)) -> list[TaskTemplate]:
    """Adds templates from a JSON URL or a pasted list. Names already present are skipped."""
    items = list(body.templates)
    if body.url:
        if not body.url.startswith("https://"):
            raise HTTPException(status_code=400, detail=tr("الرابط لازم يبلّش بـ https://"))
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.get(body.url, follow_redirects=True)
                response.raise_for_status()
                items += [TemplateIn(name=c.name, prompt=c.prompt) for c in _catalog_items(response.json())]
        except Exception as exc:  # noqa: BLE001 - the reason is the message
            raise HTTPException(status_code=400, detail=tr("ما قدرت أقرأ القوالب من الرابط: {0}", exc)) from exc
    if not items:
        raise HTTPException(status_code=400, detail=tr("ما في قوالب لأستوردها."))
    existing = {t.name for t in (await session.execute(select(TaskTemplate))).scalars().all()}
    added = []
    for item in items:
        name = item.name.strip()
        if not name or name in existing:
            continue
        existing.add(name)
        template = TaskTemplate(name=name, prompt=item.prompt, model_id=None, working_dir=None)
        session.add(template)
        added.append(template)
    await session.commit()
    for template in added:
        await session.refresh(template)
    return added


@router.put("/templates/{template_id}", response_model=TemplateOut)
async def update_template(
    template_id: str, body: TemplateIn, session: AsyncSession = Depends(get_session)
) -> TaskTemplate:
    template = await session.get(TaskTemplate, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="template not found")
    template.name, template.prompt = body.name.strip(), body.prompt
    template.model_id, template.working_dir = body.model_id, _folder(body.working_dir)
    await session.commit()
    await session.refresh(template)
    return template


@router.delete("/templates/{template_id}", status_code=204)
async def delete_template(template_id: str, session: AsyncSession = Depends(get_session)) -> None:
    template = await session.get(TaskTemplate, template_id)
    if template is not None:
        await session.delete(template)
        await session.commit()


# ── Schedules ─────────────────────────────────────────────────────────────────────────


async def _checked_schedule(body: ScheduleIn, session: AsyncSession) -> None:
    if not await session.get(LlmModel, body.model_id):
        raise HTTPException(status_code=400, detail=tr("النموذج غير موجود."))
    if body.kind == "interval" and not body.every_minutes:
        raise HTTPException(status_code=400, detail=tr("حدد كل كم دقيقة (5 على الأقل)."))
    if body.kind != "interval" and parse_time(body.at_time) is None:
        raise HTTPException(status_code=400, detail=tr("حدد الوقت بصيغة ساعة:دقيقة."))
    if body.kind == "weekly" and not [d for d in body.weekdays or [] if 0 <= d <= 6]:
        raise HTTPException(status_code=400, detail=tr("اختار يوم واحد على الأقل."))


def _apply(schedule: Schedule, body: ScheduleIn) -> None:
    schedule.title, schedule.prompt, schedule.model_id = body.title.strip(), body.prompt, body.model_id
    schedule.working_dir = _folder(body.working_dir)
    schedule.kind, schedule.enabled = body.kind, body.enabled
    schedule.every_minutes = body.every_minutes if body.kind == "interval" else None
    schedule.at_time = body.at_time if body.kind != "interval" else None
    schedule.weekdays = sorted({d for d in body.weekdays or [] if 0 <= d <= 6}) if body.kind == "weekly" else None
    schedule.next_run_at = next_run(schedule, datetime.now(UTC)) if body.enabled else None


@router.get("/schedules", response_model=list[ScheduleOut])
async def list_schedules(session: AsyncSession = Depends(get_session)) -> list[Schedule]:
    rows = await session.execute(select(Schedule).order_by(Schedule.created_at.desc()))
    return list(rows.scalars().all())


@router.post("/schedules", response_model=ScheduleOut, status_code=201)
async def create_schedule(body: ScheduleIn, session: AsyncSession = Depends(get_session)) -> Schedule:
    await _checked_schedule(body, session)
    schedule = Schedule(title="", prompt="", model_id=body.model_id)
    _apply(schedule, body)
    session.add(schedule)
    await session.commit()
    await session.refresh(schedule)
    return schedule


@router.put("/schedules/{schedule_id}", response_model=ScheduleOut)
async def update_schedule(
    schedule_id: str, body: ScheduleIn, session: AsyncSession = Depends(get_session)
) -> Schedule:
    schedule = await session.get(Schedule, schedule_id)
    if schedule is None:
        raise HTTPException(status_code=404, detail="schedule not found")
    await _checked_schedule(body, session)
    _apply(schedule, body)
    await session.commit()
    await session.refresh(schedule)
    return schedule


@router.delete("/schedules/{schedule_id}", status_code=204)
async def delete_schedule(schedule_id: str, session: AsyncSession = Depends(get_session)) -> None:
    schedule = await session.get(Schedule, schedule_id)
    if schedule is not None:
        await session.delete(schedule)
        await session.commit()


@router.post("/schedules/{schedule_id}/run")
async def run_schedule(schedule_id: str) -> dict[str, str]:
    try:
        task_id = await start_now(schedule_id)
    except TaskCreateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if task_id is None:
        raise HTTPException(status_code=404, detail="schedule not found")
    return {"task_id": task_id}


# ── MCP servers ───────────────────────────────────────────────────────────────────────


def _mcp_out(server: McpServer) -> McpServerOut:
    return McpServerOut(
        id=server.id,
        name=server.name,
        transport=server.transport,
        command=server.command,
        args=list(server.args or []),
        url=server.url,
        enabled=server.enabled,
        secret_keys=list(server.secret_keys or []),
        auth=server.auth or "none",
        preset=server.preset,
        authorized=(server.auth == "oauth") and mcp_oauth.is_authorized(server.id),
        status=McpStatus(**MANAGER.status(server.id)),
    )


def _checked_mcp(body: McpServerIn) -> None:
    if body.transport == "stdio" and not (body.command or "").strip():
        raise HTTPException(status_code=400, detail=tr("اكتب الأمر اللي بيشغّل الخادم."))
    if body.transport == "http" and not (body.url or "").lower().startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail=tr("اكتب رابط الخادم (http أو https)."))


def _merged(saved: dict[str, str], incoming: dict[str, str]) -> dict[str, str]:
    """Keys the user kept with an empty value keep their saved secret."""
    return {k: (v if v else saved.get(k, "")) for k, v in incoming.items() if k.strip()}


@router.get("/mcp", response_model=list[McpServerOut])
async def list_mcp(session: AsyncSession = Depends(get_session)) -> list[McpServerOut]:
    rows = await session.execute(select(McpServer).order_by(McpServer.created_at))
    return [_mcp_out(s) for s in rows.scalars().all()]


@router.post("/mcp", response_model=McpServerOut, status_code=201)
async def create_mcp(body: McpServerIn, session: AsyncSession = Depends(get_session)) -> McpServerOut:
    _checked_mcp(body)
    server = McpServer(
        name=body.name.strip(),
        transport=body.transport,
        command=(body.command or "").strip() or None,
        args=[a for a in body.args if a],
        url=(body.url or "").strip() or None,
        enabled=body.enabled,
        auth=body.auth if body.transport == "http" else "none",
        preset=(body.preset or "").strip() or None,
    )
    session.add(server)
    await session.flush()
    server.secret_keys = save_secrets(server.id, _merged({}, body.env), _merged({}, body.headers))
    await session.commit()
    await session.refresh(server)
    return _mcp_out(server)


@router.put("/mcp/{server_id}", response_model=McpServerOut)
async def update_mcp(server_id: str, body: McpServerIn, session: AsyncSession = Depends(get_session)) -> McpServerOut:
    server = await session.get(McpServer, server_id)
    if server is None:
        raise HTTPException(status_code=404, detail="server not found")
    _checked_mcp(body)
    saved = load_secrets(server_id)
    server.name, server.transport = body.name.strip(), body.transport
    server.command = (body.command or "").strip() or None
    server.args = [a for a in body.args if a]
    server.url = (body.url or "").strip() or None
    server.enabled = body.enabled
    server.auth = body.auth if body.transport == "http" else "none"
    server.preset = (body.preset or "").strip() or None
    server.secret_keys = save_secrets(
        server_id, _merged(saved["env"], body.env), _merged(saved["headers"], body.headers)
    )
    await session.commit()
    await session.refresh(server)
    await MANAGER.disconnect(server_id)  # the next use connects with the new settings
    return _mcp_out(server)


@router.delete("/mcp/{server_id}", status_code=204)
async def delete_mcp(server_id: str, session: AsyncSession = Depends(get_session)) -> None:
    server = await session.get(McpServer, server_id)
    await MANAGER.disconnect(server_id)
    with contextlib.suppress(Exception):
        delete_named_secret(secret_name(server_id))
    mcp_oauth.forget(server_id)
    if server is not None:
        await session.delete(server)
        await session.commit()


@router.post("/mcp/{server_id}/connect", response_model=McpConnectOut)
async def connect_mcp(server_id: str, session: AsyncSession = Depends(get_session)) -> McpConnectOut:
    """Starts connecting. For an OAuth server that hasn't been authorized, answers with the
    page to open; the connection then completes on its own once the browser comes back
    (poll GET /mcp to watch it). Otherwise behaves like /test."""
    server = await session.get(McpServer, server_id)
    if server is None:
        raise HTTPException(status_code=404, detail="server not found")
    if server.auth != "oauth":
        try:
            await MANAGER.connect(server)
        except Exception as exc:  # noqa: BLE001 - the reason is the answer
            return McpConnectOut(connected=False, error=str(exc))
        return McpConnectOut(connected=True)

    await MANAGER.disconnect(server_id)
    mcp_oauth.end(server_id)
    flow = mcp_oauth.begin(server_id)
    conn = MANAGER.begin(server)
    ready = asyncio.ensure_future(conn._ready.wait())
    url = asyncio.ensure_future(asyncio.shield(flow.url))
    done, _ = await asyncio.wait({ready, url}, timeout=25, return_when=asyncio.FIRST_COMPLETED)
    for task in (ready, url):
        if task not in done:
            task.cancel()
    if url in done and not url.cancelled() and url.exception() is None:
        return McpConnectOut(authorize_url=url.result(), connected=False)
    if conn.connected:
        return McpConnectOut(connected=True)
    return McpConnectOut(connected=False, error=conn.error or tr("الخادم ما رد خلال وقت كافي."))


@router.post("/mcp/{server_id}/logout", response_model=McpServerOut)
async def logout_mcp(server_id: str, session: AsyncSession = Depends(get_session)) -> McpServerOut:
    """Forgets the OAuth tokens; the next connect asks the user again."""
    server = await session.get(McpServer, server_id)
    if server is None:
        raise HTTPException(status_code=404, detail="server not found")
    await MANAGER.disconnect(server_id)
    mcp_oauth.forget(server_id)
    return _mcp_out(server)


oauth_callback_router = APIRouter(tags=["automation"])


# Two paths, one handler: Rafiq's own, and the bare /callback that Figma's registration
# insists on (see mcp_oauth.FIGMA_CALLBACK_PATH). Neither needs the app's token — the code
# in the URL is worthless without the flow waiting for it in this process.
@oauth_callback_router.get("/mcp/oauth/callback", response_class=HTMLResponse)
@oauth_callback_router.get("/callback", response_class=HTMLResponse)
async def mcp_oauth_callback(code: str = "", state: str = "", error: str = "", iss: str = "") -> HTMLResponse:
    """Where the provider sends the browser after the user approves. No token here: the
    code goes to the waiting connection, which exchanges it itself."""
    from rafiq_agent.api.accounts import callback_page

    if error or not code:
        return HTMLResponse(callback_page(tr("ما تمّ الربط"), tr("رجّع وحاول من رفيق مرة تانية. ({0})", error or "no code")), status_code=400)
    accepted = mcp_oauth.deliver(code, state, iss)
    if accepted:
        return HTMLResponse(callback_page(tr("تمام، رجعنا لرفيق"), tr("فيك تسكّر هالصفحة وترجع للتطبيق.")))
    return HTMLResponse(callback_page(tr("هالرابط انتهى"), tr("ابدأ الربط من جديد من رفيق ← الإعدادات ← خوادم MCP.")), status_code=400)


@router.get("/mcp/requirements", response_model=McpRequirementsOut)
async def mcp_requirements() -> McpRequirementsOut:
    """Which runtimes the preset MCP servers need are installed on this machine."""
    return McpRequirementsOut(
        node=shutil.which("node") is not None,
        npx=shutil.which("npx") is not None or shutil.which("npx.cmd") is not None,
        uvx=shutil.which("uvx") is not None,
        python=shutil.which("python") is not None or shutil.which("python3") is not None,
        docker=shutil.which("docker") is not None,
    )


@router.post("/mcp/{server_id}/test", response_model=McpServerOut)
async def test_mcp(server_id: str, session: AsyncSession = Depends(get_session)) -> McpServerOut:
    """Connects now and lists its tools — or says why it couldn't."""
    server = await session.get(McpServer, server_id)
    if server is None:
        raise HTTPException(status_code=404, detail="server not found")
    try:
        await MANAGER.connect(server)
    except Exception as exc:  # noqa: BLE001 - the reason is the answer
        raise HTTPException(status_code=400, detail=tr("ما قدرت أتصل بالخادم: {0}", str(exc))) from exc
    return _mcp_out(server)
