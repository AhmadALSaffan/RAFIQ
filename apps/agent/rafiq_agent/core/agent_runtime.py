import asyncio
from pathlib import Path
from typing import Any

from rafiq_agent.core.attachments import AttachmentError, build_user_content, load_attachments
from rafiq_agent.core.loop import LoopCallbacks, run_agent_loop
from rafiq_agent.core.manager import manager
from rafiq_agent.core.workspace import session_dir
from rafiq_agent.integrations.tools import issue_tools
from rafiq_agent.llm.base import LlmProvider
from rafiq_agent.llm.discovery import friendly_error, supports_vision
from rafiq_agent.schemas.settings import AppSettings
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import LlmModel, SettingsRow, Task
from rafiq_agent.storage.secrets import get_api_key
from rafiq_agent.tools.base import ToolRegistry
from rafiq_agent.tools.filesystem import (
    FilesystemDeleteTool,
    FilesystemListTool,
    FilesystemReadTool,
    FilesystemWriteTool,
)
from rafiq_agent.tools.process import ProcessKillTool, ProcessListTool
from rafiq_agent.tools.shell import ShellRunTool
from rafiq_agent.tools.skills import skill_tools

# Maps a tool name to the settings permission key that gates it.
PERMISSION_KEY_BY_TOOL = {
    "filesystem_write": "filesystem_write",
    "filesystem_delete": "filesystem_write",
    "shell_run": "shell",
    "process_kill": "process",
    "issue_comment": "issue_write",
    "issue_complete": "issue_write",
}

SYSTEM_PROMPT = (
    "أنت رفيق، مساعد ذكاء اصطناعي ينفّذ مهام حقيقية على جهاز المستخدم عبر أدوات "
    "(نظام ملفات، أوامر shell، عمليات النظام). اشرح بإيجاز شو ناوي تعمل قبل استدعاء أداة، "
    "استخدم الأدوات فعلياً لتنفيذ المهمة بدل الافتراض، وقدّم ملخص واضح لما تخلص. "
    "إذا الأداة رجعت خطأ أو رفض، عالج الموقف أو اشرح للمستخدم ليش ما قدرت تكمل."
)

SETTINGS_KEY = "app"


def build_registry(working_dir: Path) -> ToolRegistry:
    registry = ToolRegistry()
    for tool in [
        FilesystemListTool(working_dir),
        FilesystemReadTool(working_dir),
        FilesystemWriteTool(working_dir),
        FilesystemDeleteTool(working_dir),
        ShellRunTool(working_dir),
        ProcessListTool(),
        ProcessKillTool(),
        *issue_tools(),
        *skill_tools(),
    ]:
        registry.register(tool)
    return registry


def policy_decision(tool_name: str, category: str, permissions: dict[str, str]) -> str:
    """'allow' | 'deny' | 'ask' for one tool call under the user's settings."""
    if category == "read_only":
        return "allow"
    mode = permissions.get(PERMISSION_KEY_BY_TOOL.get(tool_name, "shell"), "ask")
    return {"auto": "allow", "deny": "deny"}.get(mode, "ask")


async def load_settings() -> AppSettings:
    async with SessionLocal() as session:
        row = await session.get(SettingsRow, SETTINGS_KEY)
    return AppSettings.model_validate(row.value) if row else AppSettings()


def working_dir_system_note(working_dir: Path) -> str:
    return (
        f"مجلد العمل: {working_dir}\n"
        "كل مسارات أدوات الملفات نسبية لهالمجلد، وأوامر الـ shell بتنفّذ جوّاه، وما فيك تطلع برّاه."
    )


async def run_task(task_id: str) -> None:
    async with SessionLocal() as session:
        task = await session.get(Task, task_id)
        if not task or task.status != "queued":
            return
        model = await session.get(LlmModel, task.model_id)
        prompt = task.prompt
        # Tasks created before the workspace existed may have no folder recorded.
        working_dir = (
            Path(task.working_dir) if task.working_dir else session_dir("tasks", task.id, task.title)
        )
        attachment_ids = [a["id"] for a in (task.attachments or [])]

    if not model:
        await manager.emit_event(task_id, "error", {"message": "النموذج تبع هالمهمة انحذف."})
        await manager.set_status(task_id, "failed")
        return

    await manager.set_status(task_id, "running")
    try:
        settings = await load_settings()
        llm = LlmProvider(model.provider, model.model_id, get_api_key(model.api_key_ref), model.base_url)
        attachments = await load_attachments(attachment_ids)
        user_content = build_user_content(prompt, attachments, supports_vision(llm.model))
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": f"{SYSTEM_PROMPT}\n\n{working_dir_system_note(working_dir)}"},
            {"role": "user", "content": user_content},
        ]

        async def permit(tool_name: str, category: str, args: dict[str, Any]) -> bool:
            decision = policy_decision(tool_name, category, settings.permissions)
            if decision != "ask":
                return decision == "allow"
            call = {"tool": tool_name, "category": category, "args": args}
            event = await manager.emit_event(
                task_id, "permission_request", {"call": call, "resolution": "pending"}
            )
            resolution = await manager.await_permission(task_id, event.id)
            await manager.update_event_payload(task_id, event.id, {"call": call, "resolution": resolution})
            return resolution == "approved"

        async def on_turn_text(text: str) -> None:
            await manager.emit_event(task_id, "message", {"role": "agent", "text": text})

        async def on_tool_call(_id: str, name: str, category: str, args: dict[str, Any]) -> None:
            await manager.emit_event(
                task_id, "tool_call", {"call": {"tool": name, "category": category, "args": args}}
            )

        async def on_tool_result(_id: str, name: str, ok: bool, output: str) -> None:
            await manager.emit_event(task_id, "tool_result", {"tool": name, "ok": ok, "output": output})

        result = await run_agent_loop(
            llm,
            messages,
            build_registry(working_dir),
            LoopCallbacks(
                permit=permit,
                on_turn_text=on_turn_text,
                on_tool_call=on_tool_call,
                on_tool_result=on_tool_result,
            ),
        )
        if result.status == "max_iterations":
            await manager.emit_event(task_id, "error", {"message": "تجاوزت المهمة الحد الأقصى من الخطوات."})
            await manager.set_status(task_id, "failed")
        else:
            await manager.set_status(task_id, "completed")

    except asyncio.CancelledError:
        await manager.set_status(task_id, "cancelled")
        raise
    except AttachmentError as exc:
        await manager.emit_event(task_id, "error", {"message": str(exc)})
        await manager.set_status(task_id, "failed")
    except Exception as exc:  # noqa: BLE001 - surface any failure to the transcript
        await manager.emit_event(task_id, "error", {"message": friendly_error(exc)})
        await manager.set_status(task_id, "failed")
