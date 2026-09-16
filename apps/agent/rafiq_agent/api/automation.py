"""Templates, schedules and MCP servers."""

import contextlib
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rafiq_agent.api.deps import require_token
from rafiq_agent.core.schedules import next_run, parse_time, start_now
from rafiq_agent.core.tasks_service import TaskCreateError, resolve_working_dir
from rafiq_agent.i18n import tr
from rafiq_agent.mcp_bridge import MANAGER, load_secrets, save_secrets, secret_name
from rafiq_agent.schemas.automation import (
    McpServerIn,
    McpServerOut,
    McpStatus,
    ScheduleIn,
    ScheduleOut,
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
    if server is not None:
        await session.delete(server)
        await session.commit()


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
