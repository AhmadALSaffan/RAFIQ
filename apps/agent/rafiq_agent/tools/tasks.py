from collections.abc import Awaitable, Callable
from typing import Any

from rafiq_agent.core.tasks_service import TaskCreateError, create_task
from rafiq_agent.storage.models import Task
from rafiq_agent.tools.base import Tool, ToolResult


class CreateTaskTool(Tool):
    name = "create_task"
    # Creating a task changes nothing on disk by itself; every action the task later takes
    # goes through its own permission checks, so this is allowed without a prompt.
    category = "read_only"
    description = (
        "أنشئ مهمة تنفيذية مستقلة يشتغل عليها رفيق بالخلفية. المهام بتنفّذ بالدور، وحدة ورا التانية، "
        "وكل مهمة عندها أدوات ملفات وshell جوّا مجلد عملها. استخدمها لما المستخدم يعطيك خطة أو يطلب "
        "تنفيذ شغل على جهازه: قسّم الخطة لمهام مرتبة، وكل مهمة لازم تكون واضحة ومكتفية بذاتها "
        "(اكتب بـ prompt كل التفاصيل والسياق اللي بتحتاجه، لأنها ما بتشوف هالمحادثة)."
    )
    parameters = {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "عنوان قصير وواضح للمهمة"},
            "prompt": {"type": "string", "description": "تعليمات كاملة ومفصّلة للمهمة"},
            "working_dir": {
                "type": "string",
                "description": "مسار مطلق لمجلد العمل (اختياري — الافتراضي مجلد هالمحادثة)",
            },
        },
        "required": ["title", "prompt"],
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
        try:
            task = await create_task(
                title=str(args.get("title", "")),
                prompt=str(args.get("prompt", "")),
                model_id=self.model_id,
                working_dir=args.get("working_dir") or self.default_dir,
                origin=self.origin,
            )
        except TaskCreateError as exc:
            return ToolResult(ok=False, output=str(exc))
        await self.on_created(task)
        return ToolResult(
            ok=True, output=f"انضافت المهمة «{task.title}» (id: {task.id}) للدور بمجلد {task.working_dir}."
        )
