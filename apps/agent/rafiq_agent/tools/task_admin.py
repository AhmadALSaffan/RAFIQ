"""The model's view of Rafiq's own work: the tasks that ran or are running, and the
schedules that start them. Reading is free; starting, stopping or scheduling work asks
first (the "task_create" permission), unless the user chose to always allow it."""

from typing import Any

from sqlalchemy import select

from rafiq_agent.core.manager import manager
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import Schedule, Task
from rafiq_agent.tools.base import Tool, ToolResult

WEEKDAYS = ["الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"]


def _when(schedule: Schedule) -> str:
    if schedule.kind == "interval":
        return f"كل {schedule.every_minutes} دقيقة"
    if schedule.kind == "weekly":
        days = "، ".join(WEEKDAYS[d] for d in schedule.weekdays or [] if 0 <= d <= 6)
        return f"{days} الساعة {schedule.at_time}"
    return f"كل يوم الساعة {schedule.at_time}"


class TaskListTool(Tool):
    name = "task_list"
    category = "read_only"
    description = (
        "اعرض آخر المهام اللي رفيق اشتغل عليها أو عم يشتغل عليها هلّق: عنوانها وحالتها ومجلدها ووقتها. "
        "فلتر بالحالة (queued, running, planned, completed, failed, cancelled) إذا بدك."
    )
    parameters = {
        "type": "object",
        "properties": {
            "status": {"type": "string", "description": "حالة وحدة للفلترة (اختياري)"},
            "limit": {"type": "integer", "description": "كم مهمة (الافتراضي 20، الحد 100)"},
        },
    }

    async def run(self, args: dict[str, Any]) -> ToolResult:
        limit = max(1, min(int(args.get("limit") or 20), 100))
        query = select(Task).order_by(Task.created_at.desc()).limit(limit)
        if status := str(args.get("status") or "").strip():
            query = query.where(Task.status == status)
        async with SessionLocal() as session:
            tasks = (await session.execute(query)).scalars().all()
        if not tasks:
            return ToolResult(ok=True, output="ما في مهام.")
        lines = [
            f"- «{t.title}» (id: {t.id}) — {t.status} — {t.working_dir or ''} — {t.created_at:%Y-%m-%d %H:%M}"
            + (f" — مربوطة بـ {t.issue.get('key')}" if getattr(t, "issue", None) else "")
            for t in tasks
        ]
        return ToolResult(ok=True, output="\n".join(lines))


class TaskCancelTool(Tool):
    name = "task_cancel"
    category = "write"
    description = "أوقف مهمة شغّالة أو بالدور بالـ id تبعها."
    parameters = {
        "type": "object",
        "properties": {"task_id": {"type": "string"}},
        "required": ["task_id"],
    }

    async def preview(self, args: dict[str, Any]) -> str | None:
        async with SessionLocal() as session:
            task = await session.get(Task, str(args.get("task_id", "")))
        return f"إيقاف «{task.title}» ({task.status})" if task else None

    async def run(self, args: dict[str, Any]) -> ToolResult:
        task_id = str(args.get("task_id", ""))
        if await manager.cancel(task_id):
            return ToolResult(ok=True, output=f"وقّفت المهمة {task_id}.")
        return ToolResult(ok=False, output="ما لقيت مهمة شغّالة بهالـ id (يمكن خلصت).")


class ScheduleListTool(Tool):
    name = "schedule_list"
    category = "read_only"
    description = "اعرض المهام المجدولة: شو بتعمل، وإيمتى بتشتغل، وإذا شغّالة أو موقّفة."
    parameters = {"type": "object", "properties": {}}

    async def run(self, args: dict[str, Any]) -> ToolResult:  # noqa: ARG002
        async with SessionLocal() as session:
            rows = (await session.execute(select(Schedule).order_by(Schedule.created_at.desc()))).scalars().all()
        if not rows:
            return ToolResult(ok=True, output="ما في مهام مجدولة.")
        lines = [
            f"- «{s.title}» (id: {s.id}) — {_when(s)} — {'شغّالة' if s.enabled else 'موقّفة'}"
            + (f" — الجاية {s.next_run_at:%Y-%m-%d %H:%M}" if s.next_run_at and s.enabled else "")
            for s in rows
        ]
        return ToolResult(ok=True, output="\n".join(lines))


SCHEDULE_FIELDS: dict[str, Any] = {
    "title": {"type": "string", "description": "عنوان قصير"},
    "prompt": {"type": "string", "description": "تعليمات كاملة للمهمة اللي رح تشتغل كل مرة"},
    "kind": {"type": "string", "enum": ["interval", "daily", "weekly"]},
    "every_minutes": {"type": "integer", "description": "لـ interval: كل كم دقيقة (5 على الأقل)"},
    "at_time": {"type": "string", "description": "لـ daily/weekly: الساعة بصيغة HH:MM بالتوقيت المحلي"},
    "weekdays": {
        "type": "array",
        "items": {"type": "integer"},
        "description": "لـ weekly: الأيام، 0 = الإثنين … 6 = الأحد",
    },
    "working_dir": {"type": "string", "description": "مجلد العمل (اختياري)"},
    "enabled": {"type": "boolean"},
}


async def _save_schedule(schedule: Schedule | None, args: dict[str, Any], model_id: str) -> Schedule:
    """Validates and stores through the same rules as the Schedules page."""
    from fastapi import HTTPException

    from rafiq_agent.api.automation import _apply, _checked_schedule
    from rafiq_agent.schemas.automation import ScheduleIn

    base: dict[str, Any] = {}
    if schedule is not None:
        base = {
            "title": schedule.title,
            "prompt": schedule.prompt,
            "model_id": schedule.model_id,
            "working_dir": schedule.working_dir,
            "kind": schedule.kind,
            "every_minutes": schedule.every_minutes,
            "at_time": schedule.at_time,
            "weekdays": schedule.weekdays,
            "enabled": schedule.enabled,
        }
    merged = {**base, **{k: v for k, v in args.items() if k in SCHEDULE_FIELDS and v is not None}}
    merged.setdefault("model_id", model_id)
    body = ScheduleIn.model_validate(merged)
    async with SessionLocal() as session:
        row = await session.get(Schedule, schedule.id) if schedule else None
        try:
            await _checked_schedule(body, session)
            if row is None:
                row = Schedule(title="", prompt="", model_id=body.model_id)
                session.add(row)
            _apply(row, body)
        except HTTPException as exc:
            raise ValueError(str(exc.detail)) from exc
        await session.commit()
        await session.refresh(row)
        return row


class ScheduleCreateTool(Tool):
    name = "schedule_create"
    category = "write"
    description = (
        "اعمل مهمة مجدولة بتشتغل لحالها: كل كم دقيقة (interval)، أو كل يوم بساعة (daily)، أو بأيام محددة "
        "(weekly). الـ prompt لازم يكون مكتفي بذاته لأنه رح يشتغل بدون هالمحادثة."
    )
    parameters = {"type": "object", "properties": SCHEDULE_FIELDS, "required": ["title", "prompt", "kind"]}

    def __init__(self, model_id: str, default_dir: str | None = None) -> None:
        self.model_id = model_id
        self.default_dir = default_dir

    async def preview(self, args: dict[str, Any]) -> str | None:
        fake = Schedule(
            title=str(args.get("title", "")),
            prompt="",
            model_id=self.model_id,
            kind=str(args.get("kind", "daily")),
            every_minutes=args.get("every_minutes"),
            at_time=args.get("at_time"),
            weekdays=args.get("weekdays"),
        )
        return f"«{fake.title}» — {_when(fake)}\n\n{str(args.get('prompt', ''))[:1500]}"

    async def run(self, args: dict[str, Any]) -> ToolResult:
        args = {**args}
        if not args.get("working_dir") and self.default_dir:
            args["working_dir"] = self.default_dir
        try:
            row = await _save_schedule(None, args, self.model_id)
        except Exception as exc:  # noqa: BLE001 - validation errors go back to the model
            return ToolResult(ok=False, output=f"ما انعملت: {exc}")
        nxt = f"، أول مرة {row.next_run_at:%Y-%m-%d %H:%M}" if row.next_run_at else ""
        return ToolResult(ok=True, output=f"انعملت «{row.title}» (id: {row.id}) — {_when(row)}{nxt}.")


class ScheduleUpdateTool(Tool):
    name = "schedule_update"
    category = "write"
    description = "عدّل مهمة مجدولة (أي حقل)، أو وقّفها/شغّلها بـ enabled."
    parameters = {
        "type": "object",
        "properties": {"schedule_id": {"type": "string"}, **SCHEDULE_FIELDS},
        "required": ["schedule_id"],
    }

    def __init__(self, model_id: str) -> None:
        self.model_id = model_id

    async def run(self, args: dict[str, Any]) -> ToolResult:
        async with SessionLocal() as session:
            row = await session.get(Schedule, str(args.get("schedule_id", "")))
        if row is None:
            return ToolResult(ok=False, output="ما لقيت هالمهمة المجدولة.")
        try:
            row = await _save_schedule(row, args, self.model_id)
        except Exception as exc:  # noqa: BLE001
            return ToolResult(ok=False, output=f"ما تعدّلت: {exc}")
        return ToolResult(ok=True, output=f"تعدّلت «{row.title}» — {_when(row)} — {'شغّالة' if row.enabled else 'موقّفة'}.")


class ScheduleDeleteTool(Tool):
    name = "schedule_delete"
    category = "write"
    description = "احذف مهمة مجدولة (المهام اللي اشتغلت منها بتضل)."
    parameters = {
        "type": "object",
        "properties": {"schedule_id": {"type": "string"}},
        "required": ["schedule_id"],
    }

    async def run(self, args: dict[str, Any]) -> ToolResult:
        from rafiq_agent.core import schedules as schedule_runs

        async with SessionLocal() as session:
            row = await session.get(Schedule, str(args.get("schedule_id", "")))
            if row is None:
                return ToolResult(ok=False, output="ما لقيت هالمهمة المجدولة.")
            title = row.title
            await schedule_runs.forget(session, row.id)
            await session.delete(row)
            await session.commit()
        return ToolResult(ok=True, output=f"انحذفت «{title}».")


def admin_tools(model_id: str, default_dir: str | None) -> list[Tool]:
    return [
        TaskListTool(),
        TaskCancelTool(),
        ScheduleListTool(),
        ScheduleCreateTool(model_id, default_dir),
        ScheduleUpdateTool(model_id),
        ScheduleDeleteTool(),
    ]

