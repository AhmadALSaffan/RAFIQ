import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy import select

from rafiq_agent.core.manager import MAX_PARALLEL, TERMINAL, statuses
from rafiq_agent.core.tasks_service import TaskCreateError, create_task
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import Task, TaskEvent
from rafiq_agent.tools.base import Tool, ToolResult

REPORT_CHARS = 2000


class CreateTasksTool(Tool):
    name = "create_tasks"
    # Creating a task changes nothing on disk by itself; every action the task later takes
    # goes through its own permission checks, so this is allowed without a prompt.
    category = "read_only"
    description = (
        "أنشئ مهمة تنفيذية أو أكتر (لحد 100 بالمرة) يشتغل عليها رفيق بالخلفية، كل مهمة عندها أدوات ملفات "
        "وshell جوّا مجلد عملها. المهام بتشتغل **بالتوازي** إلا إذا بدها تعدّل نفس الملفات: حدد بـ paths "
        "الملفات أو المجلدات (نسبية لمجلد العمل) اللي رح تعدّلها المهمة، ومهام paths تبعها ما بتتقاطع "
        "بتشتغل مع بعض؛ بدون paths المهمة بتحجز المجلد كله. استخدم depends_on لما مهمة لازم تستنى غيرها "
        "(بتحط فيها key مهمة من نفس الطلب أو id مهمة موجودة). كل مهمة لازم تكون مكتفية بذاتها: اكتب بـ "
        "prompt كل التفاصيل والسياق لأنها ما بتشوف هالمحادثة. بعد ما تنشئ المهام استدعِ wait_for_tasks."
    )
    parameters = {
        "type": "object",
        "properties": {
            "tasks": {
                "type": "array",
                "maxItems": MAX_PARALLEL,
                "items": {
                    "type": "object",
                    "properties": {
                        "key": {"type": "string", "description": "اسم قصير للمهمة بتستعمله بـ depends_on"},
                        "title": {"type": "string", "description": "عنوان قصير وواضح للمهمة"},
                        "prompt": {"type": "string", "description": "تعليمات كاملة ومفصّلة للمهمة"},
                        "working_dir": {
                            "type": "string",
                            "description": "مسار مطلق لمجلد العمل (اختياري — الافتراضي مجلد هالمحادثة)",
                        },
                        "paths": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "الملفات/المجلدات اللي رح تعدّلها المهمة، نسبية لمجلد العمل",
                        },
                        "depends_on": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "key أو id مهام لازم تخلص قبل ما تبلش هالمهمة",
                        },
                    },
                    "required": ["title", "prompt"],
                },
            },
        },
        "required": ["tasks"],
    }

    def __init__(
        self,
        model_id: str,
        default_dir: str | None,
        origin: dict[str, Any],
        on_created: Callable[[Task], Awaitable[None]],
    ) -> None:
        self.model_id = model_id
        self.default_dir = default_dir
        self.origin = origin
        self.on_created = on_created

    async def run(self, args: dict[str, Any]) -> ToolResult:
        specs = args.get("tasks")
        if not isinstance(specs, list) or not specs:
            # A model that sends one task's fields directly still gets its task.
            specs = [args] if args.get("title") or args.get("prompt") else []
        if not specs:
            return ToolResult(ok=False, output="ما وصلت ولا مهمة — ابعت tasks فيها title و prompt لكل مهمة.")

        ids_by_key: dict[str, str] = {}
        lines: list[str] = []
        created = 0
        for i, spec in enumerate(specs[:MAX_PARALLEL], start=1):
            if not isinstance(spec, dict):
                lines.append(f"{i}. تجاهلتها: مو object.")
                continue
            key = str(spec.get("key") or "").strip()
            deps = [ids_by_key.get(str(d), str(d)) for d in spec.get("depends_on") or []]
            try:
                task = await create_task(
                    title=str(spec.get("title", "")),
                    prompt=str(spec.get("prompt", "")),
                    model_id=self.model_id,
                    working_dir=spec.get("working_dir") or self.default_dir,
                    origin=self.origin,
                    paths=spec.get("paths") or None,
                    depends_on=deps or None,
                )
            except TaskCreateError as exc:
                lines.append(f"{i}. «{spec.get('title', '')}» ما انضافت: {exc}")
                continue
            if key:
                ids_by_key[key] = task.id
            created += 1
            await self.on_created(task)
            lines.append(f"{i}. «{task.title}» (id: {task.id}{f', key: {key}' if key else ''}) بمجلد {task.working_dir}")

        if len(specs) > MAX_PARALLEL:
            lines.append(f"الباقي ({len(specs) - MAX_PARALLEL}) ما انضاف — الحد {MAX_PARALLEL} مهمة بالطلب.")
        head = f"انضافت {created} مهمة من {len(specs)}:" if created else "ما انضافت ولا مهمة:"
        return ToolResult(ok=created > 0, output="\n".join([head, *lines]))


class WaitForTasksTool(Tool):
    name = "wait_for_tasks"
    category = "read_only"
    description = (
        "استنى لحتى تخلص المهام، وبعدها بترجعلك نتيجة كل وحدة: حالتها وآخر تقرير كتبته أو الخطأ اللي وقفها. "
        "استدعيها بعد create_tasks وقبل ما ترد على المستخدم، وابني ردك على النتائج الحقيقية. "
        "بدون task_ids بتستنى كل المهام اللي أنشأتها بهالرد. إذا خلص الوقت قبلهن بترجعلك حالتهن الحالية "
        "وفيك تستدعيها مرة تانية."
    )
    parameters = {
        "type": "object",
        "properties": {
            "task_ids": {"type": "array", "items": {"type": "string"}, "description": "ids المهام (اختياري)"},
            "timeout_minutes": {"type": "number", "description": "أقصى مدة انتظار بالدقايق (الافتراضي 30)"},
        },
        "required": [],
    }

    def __init__(self, created: Callable[[], list[str]], poll_seconds: float = 1.5) -> None:
        self.created = created
        self.poll_seconds = poll_seconds

    async def run(self, args: dict[str, Any]) -> ToolResult:
        ids = [str(i) for i in args.get("task_ids") or []] or self.created()
        if not ids:
            return ToolResult(ok=False, output="ما في مهام لتستنى عليها — أنشئها أول بـ create_tasks.")
        try:
            minutes = float(args.get("timeout_minutes") or 30)
        except (TypeError, ValueError):
            minutes = 30
        loop = asyncio.get_running_loop()
        deadline = loop.time() + min(max(minutes, 0.05), 180) * 60

        while True:
            status = await statuses(ids)
            if all(status.get(i) in TERMINAL for i in ids if i in status) or loop.time() >= deadline:
                break
            await asyncio.sleep(self.poll_seconds)
        return ToolResult(ok=True, output=await report(ids))


async def report(ids: list[str]) -> str:
    """One paragraph per task: its status and what it last said (or the error that stopped it)."""
    async with SessionLocal() as session:
        tasks = {
            t.id: t for t in (await session.execute(select(Task).where(Task.id.in_(ids)))).scalars().all()
        }
        events = (
            await session.execute(
                select(TaskEvent)
                .where(TaskEvent.task_id.in_(ids), TaskEvent.type.in_(("message", "error")))
                .order_by(TaskEvent.created_at)
            )
        ).scalars().all()
    last: dict[str, dict[str, str]] = {}
    for event in events:
        text = str(event.payload.get("text") or event.payload.get("message") or "")
        last.setdefault(event.task_id, {})[event.type] = text

    counts: dict[str, int] = {}
    blocks: list[str] = []
    for task_id in ids:
        task = tasks.get(task_id)
        if task is None:
            blocks.append(f"— {task_id}: انحذفت.")
            continue
        counts[task.status] = counts.get(task.status, 0) + 1
        said = last.get(task_id, {})
        body = said.get("error") if task.status == "failed" and said.get("error") else said.get("message")
        body = (body or "").strip()
        if len(body) > REPORT_CHARS:
            body = body[:REPORT_CHARS] + " …"
        blocks.append(f"— «{task.title}» (id: {task.id}) — {task.status}" + (f"\n{body}" if body else ""))
    summary = "، ".join(f"{n} {s}" for s, n in counts.items())
    return f"حالة المهام: {summary}\n\n" + "\n\n".join(blocks)
