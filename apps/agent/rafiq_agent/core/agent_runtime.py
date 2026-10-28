import asyncio
import logging
from pathlib import Path
from typing import Any

from sqlalchemy import select

from rafiq_agent.auth.resolve import llm_for
from rafiq_agent.core import issue_lifecycle
from rafiq_agent.core.attachments import AttachmentError, build_user_content, load_attachments
from rafiq_agent.core.loop import LoopCallbacks, run_agent_loop
from rafiq_agent.core.manager import manager
from rafiq_agent.core.memory import memory_note
from rafiq_agent.core.project_notes import project_instructions
from rafiq_agent.core.prompts import PLAN_APPROVED, PLAN_PROMPT, STEP_NOTE
from rafiq_agent.core.resume import is_resume, resume_message
from rafiq_agent.core.task_git import prepare as prepare_git
from rafiq_agent.core.task_git import settle as settle_git
from rafiq_agent.core.vision import describe_attachments
from rafiq_agent.core.workspace import session_dir
from rafiq_agent.i18n import tr
from rafiq_agent.integrations.tools import issue_tools
from rafiq_agent.llm import usage
from rafiq_agent.llm.discovery import supports_vision
from rafiq_agent.llm.errors import error_event
from rafiq_agent.llm.presets import native_tools
from rafiq_agent.schemas.settings import AppSettings
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import LlmModel, SettingsRow, Task, TaskEvent
from rafiq_agent.tools.base import ToolRegistry
from rafiq_agent.tools.filesystem import (
    FilesystemDeleteTool,
    FilesystemEditTool,
    FilesystemListTool,
    FilesystemReadTool,
    FilesystemWriteTool,
)
from rafiq_agent.tools.image_view import ImageViewTool
from rafiq_agent.tools.office import WordWriteTool
from rafiq_agent.tools.process import ProcessKillTool, ProcessListTool
from rafiq_agent.tools.sheets import ExcelReadTool, ExcelWriteTool
from rafiq_agent.tools.shell import ShellRunTool
from rafiq_agent.tools.skills import skill_tools
from rafiq_agent.tools.slides import SlidesWriteTool

# Maps a tool name to the settings permission key that gates it.
log = logging.getLogger(__name__)

PERMISSION_KEY_BY_TOOL = {
    "filesystem_write": "filesystem_write",
    "filesystem_edit": "filesystem_write",
    "filesystem_delete": "filesystem_write",
    "word_write": "filesystem_write",
    "slides_write": "filesystem_write",
    "excel_write": "filesystem_write",
    "note_create": "notes_new",
    "note_edit": "notes",
    "shell_run": "shell",
    "process_kill": "process",
    "issue_comment": "issue_write",
    "issue_complete": "issue_write",
    "create_tasks": "task_create",
    "schedule_create": "task_create",
    "schedule_update": "task_create",
    "schedule_delete": "task_create",
    "task_cancel": "task_create",
    "task_publish": "git_publish",
    "notify_post": "notify_send",
    "web_fetch": "browser_navigate",
    "web_search": "browser_navigate",
    "memory_save": "memory",
    "motion_tts": "media",
    "motion_transcribe": "media",
    "motion_stock": "media",
    "motion_image": "media",
    "motion_fetch_image": "media",
}
PERMISSION_KEY_BY_PREFIX = {"issue_": "issue_write", "browser_": "browser_navigate", "desktop_": "desktop_control", "mcp__": "mcp", "motion_": "motion"}

SYSTEM_PROMPT = (
    "أنت رفيق، مساعد ذكاء اصطناعي ينفّذ مهام حقيقية على جهاز المستخدم عبر أدوات "
    "(نظام ملفات، أوامر shell، عمليات النظام، الويب والمتصفح، وأدوات MCP إذا كانت مربوطة). "
    "اشرح بإيجاز شو ناوي تعمل قبل استدعاء أداة، استخدم الأدوات فعلياً لتنفيذ المهمة بدل الافتراض، "
    "وقدّم ملخص واضح لما تخلص. إذا الأداة رجعت خطأ أو رفض، عالج الموقف أو اشرح للمستخدم ليش ما قدرت تكمل."
)

WORKTREE_NOTE = (
    "إنت شغّال بنسخة معزولة من المشروع (git worktree) عشان مهام تانية تقدر تشتغل بنفس الوقت. "
    "عدّل الملفات عادي هون؛ لما تخلص المهمة، رفيق بيطبّق تغييراتك على مجلد المستخدم الأصلي. "
    "لا تعمل commit ولا تغيّر فروع git."
)

SETTINGS_KEY = "app"


def permission_key(tool_name: str) -> str:
    if tool_name in PERMISSION_KEY_BY_TOOL:
        return PERMISSION_KEY_BY_TOOL[tool_name]
    for prefix, key in PERMISSION_KEY_BY_PREFIX.items():
        if tool_name.startswith(prefix):
            return key
    return "shell"


# Every tool group a run can be given. Whatever isn't in the set is never described to the
# model, and an unused schema is paid for on every single request.
ALL_GROUPS = frozenset({"files", "web", "browser", "issues", "skills", "mcp", "desktop"})


async def _has_integrations() -> bool:
    """Whether any issue tracker is connected. No account, no issue tools."""
    from rafiq_agent.storage.models import IntegrationAccount

    try:
        async with SessionLocal() as session:
            rows = await session.execute(select(IntegrationAccount).limit(1))
            return rows.first() is not None
    except Exception:  # noqa: BLE001 - a database hiccup must not cost the run its tools
        return False


async def build_registry(
    working_dir: Path | None,
    settings: AppSettings,
    native: frozenset[str] = frozenset(),
    groups: frozenset[str] = ALL_GROUPS,
    source: dict[str, Any] | None = None,
) -> ToolRegistry:
    """The tools a run gets. File and shell tools need a folder, issue tools need a
    connected tracker, and the rest are asked for by `groups`. Call `aclose()` when the run
    ends.

    `native` names tools this model already has (see llm/presets.py): Rafiq leaves those to
    the model rather than offering a second one of its own."""
    from rafiq_agent.mcp_bridge import register_mcp_tools
    from rafiq_agent.tools.browser import register_browser_tools
    from rafiq_agent.tools.desktop import register_desktop_tools
    from rafiq_agent.tools.web import WebFetchTool, search_tool

    registry = ToolRegistry()
    tools: list[Any] = []
    if "issues" in groups and await _has_integrations():
        tools += issue_tools(source, working_dir)
    if "issues" in groups:
        from rafiq_agent.tools.notify import notify_tools

        tools += await notify_tools()
    if "skills" in groups:
        tools += skill_tools()
    if "web" in groups:
        tools.append(WebFetchTool())
    if working_dir is not None and "files" in groups:
        tools += [
            FilesystemListTool(working_dir),
            FilesystemReadTool(working_dir),
            FilesystemWriteTool(working_dir),
            FilesystemEditTool(working_dir),
            FilesystemDeleteTool(working_dir),
            ShellRunTool(working_dir),
            ProcessListTool(),
            ProcessKillTool(),
        ]
    if "files" in groups:
        # Office documents and pictures work in any chat: without a folder they go to
        # Documents\Rafiq\documents, so "write me a report" never needs a folder first.
        from rafiq_agent.core.workspace import workspace_root

        office_dir = working_dir if working_dir is not None else workspace_root() / "documents"
        office_dir.mkdir(parents=True, exist_ok=True)
        tools += [
            WordWriteTool(office_dir),
            SlidesWriteTool(office_dir),
            ExcelReadTool(office_dir),
            ExcelWriteTool(office_dir),
            ImageViewTool(office_dir),
        ]
        # The user's notes, in every chat too: "save this as a note", "what did I write about…".
        from rafiq_agent.core.notes import notes_root
        from rafiq_agent.tools.notes import note_tools

        tools += note_tools(notes_root(settings.notes_dir))
    if "web" in groups and (search := search_tool(settings)):
        tools.append(search)
    for tool in tools:
        if tool.name not in native:
            registry.register(tool)
    if "browser" in groups:
        register_browser_tools(registry, settings.browser_visible)
    if "desktop" in groups and settings.desktop_control_enabled:
        register_desktop_tools(registry)
    if "mcp" in groups:
        await register_mcp_tools(registry)
    return registry


def policy_decision(tool_name: str, category: str, permissions: dict[str, str]) -> str:
    """'allow' | 'deny' | 'ask' for one tool call under the user's settings. An MCP tool
    follows its server's own settings first (mcp_bridge.resolve_mode), then the global one."""
    from rafiq_agent.mcp_bridge import mode_for

    if category == "read_only":
        return "allow"
    mode = (mode_for(tool_name) if tool_name.startswith("mcp__") else None) or permissions.get(
        permission_key(tool_name), "ask"
    )
    return {"auto": "allow", "deny": "deny"}.get(mode, "ask")


async def load_settings() -> AppSettings:
    async with SessionLocal() as session:
        row = await session.get(SettingsRow, SETTINGS_KEY)
    return AppSettings.model_validate(row.value) if row else AppSettings()


async def allow_always(tool_name: str, permissions: dict[str, str] | None = None) -> str | None:
    """The user answered "always allow" on a permission card: the tool's whole group runs
    without asking from now on, exactly as if they had set it in Settings. MCP tools keep
    their per-server settings, so the answer stays a one-off approval for them. Returns the
    group that changed, if any."""
    if tool_name.startswith("mcp__"):
        return None
    key = permission_key(tool_name)
    async with SessionLocal() as session:
        row = await session.get(SettingsRow, SETTINGS_KEY)
        current = AppSettings.model_validate(row.value) if row else AppSettings()
        current.permissions = {**current.permissions, key: "auto"}  # type: ignore[dict-item]
        if row:
            row.value = current.model_dump()
        else:
            session.add(SettingsRow(key=SETTINGS_KEY, value=current.model_dump()))
        await session.commit()
    if permissions is not None:
        permissions[key] = "auto"  # the run that asked stops asking too
    return key


def working_dir_system_note(working_dir: Path) -> str:
    return (
        f"مجلد العمل: {working_dir}\n"
        "كل مسارات أدوات الملفات نسبية لهالمجلد، وأوامر الـ shell بتنفّذ جوّاه، وما فيك تطلع برّاه.\n"
        "لتغيّر جزء من ملف موجود استخدم filesystem_edit (النص القديم بالحرف والنص الجديد)، "
        "مش filesystem_write للملف كله ولا سكربت. وأي كود (بايثون، Node، regex، نص عربي) ابعته "
        "لـ shell_run كـ script مع language، مش جوّا سطر أوامر: الـ cmd بيخرّب علامات التنصيص والـ ^ "
        "والحروف العربية. واطبع بس اللي بتحتاجه (طول، عدد، كم سطر)، مش ملفات كاملة."
    )


def parallel_note(paths: list[str]) -> str:
    """For a task that claimed only part of its folder — others may be editing the rest."""
    listed = "، ".join(paths)
    return (
        f"هالمهمة ممكن تشتغل بنفس الوقت مع مهام تانية بنفس المجلد، وحجزتلك بس: {listed}. "
        "عدّل ضمنهن بس؛ وإذا لزمك تغيّر شي برّاهن، لا تعدّله واذكره بتقريرك الأخير."
    )


async def _plan_task(
    task_id: str,
    model: LlmModel,
    fallback: LlmModel | None,
    prompt: str,
    working_dir: Path,
    attachment_ids: list[str],
) -> None:
    """Plan-first mode: the model writes a plan with no tools, the task parks as "planned"."""
    try:
        llm = llm_for(model, fallback=fallback)
        attachments = await load_attachments(attachment_ids)
        vision = supports_vision(llm.model)
        described = await describe_attachments(attachments) if vision is False else {}
        user_content = build_user_content(prompt, attachments, vision, described)
        system = "\n\n".join([SYSTEM_PROMPT, working_dir_system_note(working_dir), PLAN_PROMPT])
        if project := project_instructions(working_dir):
            system += f"\n\n{project}"
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ]

        async def deny(*_: Any) -> bool:
            return False

        result = await run_agent_loop(
            llm, messages, ToolRegistry(), LoopCallbacks(permit=deny), max_iterations=2
        )
        plan = result.text.strip()
        if not plan:
            await manager.emit_event(task_id, "error", {"message": tr("النموذج ما رجّع خطة.")})
            await manager.set_status(task_id, "failed")
            return
        async with SessionLocal() as session:
            task = await session.get(Task, task_id)
            if task:
                task.plan = plan
                await session.commit()
        await manager.emit_event(task_id, "plan", {"text": plan})
        await manager.set_status(task_id, "planned")
    except asyncio.CancelledError:
        await manager.set_status(task_id, "cancelled")
        raise
    except Exception as exc:  # noqa: BLE001 - surface any failure to the transcript
        await manager.emit_event(task_id, "error", error_event(exc))
        await manager.set_status(task_id, "failed")


def register_task_tools(registry: ToolRegistry, task_id: str, model_id: str, folder: str | None, depth: int) -> None:
    """A task can hand work on: start follow-up tasks (in the user's folder, not its own
    worktree), wait for them, and see or schedule Rafiq's work — each start asks first."""
    from rafiq_agent.tools.task_admin import admin_tools
    from rafiq_agent.tools.tasks import CreateTasksTool, WaitForTasksTool

    created: list[str] = []

    async def on_created(task: Task) -> None:
        created.append(task.id)

    registry.register(
        CreateTasksTool(model_id, folder, {"task_id": task_id, "depth": depth + 1}, on_created)
    )
    registry.register(WaitForTasksTool(lambda: list(created)))
    for tool in admin_tools(model_id, folder):
        registry.register(tool)


async def _issue_hook(step: Any) -> None:
    """The tracker side of a task never stops the task itself."""
    try:
        await step
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001 - reported, not raised
        log.warning("issue lifecycle step failed: %s", exc)


async def parallel_limit() -> int:
    """The scheduler reads the user's limit before every pass, so a change applies at once."""
    return (await load_settings()).max_parallel_tasks


async def run_task(task_id: str) -> None:
    # Everything this task spends is counted against the task (see llm/usage.py).
    usage.scope("task", task_id).apply()
    async with SessionLocal() as session:
        task = await session.get(Task, task_id)
        if not task or task.status != "queued":
            return
        model = await session.get(LlmModel, task.model_id)
        fallback = (
            await session.get(LlmModel, model.fallback_model_id) if model and model.fallback_model_id else None
        )
        prompt, title, planned = task.prompt, task.title, task.git
        origin_folder = task.working_dir or None
        depth = int((task.origin or {}).get("depth") or 0)
        mode, plan_text, workspace_id = task.mode or "auto", task.plan, task.workspace_id
        # Tasks created before the workspace existed may have no folder recorded.
        working_dir = (
            Path(task.working_dir) if task.working_dir else session_dir("tasks", task.id, task.title)
        )
        attachment_ids = [a["id"] for a in (task.attachments or [])]
        paths = list(task.paths or [])
        # A task the user resumed carries its earlier steps into this run (core/resume.py).
        saved = (
            await session.execute(
                select(TaskEvent.type, TaskEvent.payload)
                .where(TaskEvent.task_id == task_id)
                .order_by(TaskEvent.created_at, TaskEvent.id)
            )
        ).all()
        history = [(kind, dict(payload or {})) for kind, payload in saved]
        resumed = is_resume(history)

    if not model:
        await manager.emit_event(task_id, "error", {"message": tr("النموذج تبع هالمهمة انحذف.")})
        await manager.set_status(task_id, "failed")
        return

    usage.scope("task", task_id, model.id, workspace_id).apply()
    await manager.set_status(task_id, "running")
    if mode == "plan" and not plan_text:
        # First pass: only a plan. The task waits ("planned") until the user approves it.
        await _plan_task(task_id, model, fallback, prompt, working_dir, attachment_ids)
        return
    registry: ToolRegistry | None = None
    git_info: dict[str, Any] | None = None
    outcome, cancelled = "failed", False
    final_text, began = "", asyncio.get_running_loop().time()
    permit: Any = None
    await _issue_hook(issue_lifecycle.started(task_id))
    try:
        settings = await load_settings()
        # A worktree of its own when the folder is a git repo (and isolation is on), or a
        # checkpoint before it edits in place — either way its changes can be reviewed.
        effective, git_info = await prepare_git(task_id, title, working_dir, paths, planned, resume=resumed)
        llm = llm_for(model, fallback=fallback)
        attachments = await load_attachments(attachment_ids)
        vision = supports_vision(llm.model)
        described = await describe_attachments(attachments) if vision is False else {}
        user_content = build_user_content(prompt, attachments, vision, described)
        notes = [SYSTEM_PROMPT, working_dir_system_note(effective)]
        if git_info and git_info.get("mode") == "worktree":
            notes.append(WORKTREE_NOTE)
        if paths:
            notes.append(parallel_note(paths))
        if project := project_instructions(effective):
            notes.append(project)
        if mode == "step":
            notes.append(STEP_NOTE)
        if settings.memory_enabled and (memories := await memory_note()):
            notes.append(memories)
        if workspace_id:
            from rafiq_agent.api.workspaces import workspace_note

            if note := await workspace_note(workspace_id):
                notes.append(note)
        system = "\n\n".join(notes)
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ]
        if mode == "plan" and plan_text:
            # The approved plan is part of the conversation, so the run follows it.
            messages.append({"role": "assistant", "content": plan_text})
            messages.append({"role": "user", "content": PLAN_APPROVED})
        if resumed:
            messages.append({"role": "user", "content": resume_message(history[:-1])})

        async def permit(
            tool_name: str, category: str, args: dict[str, Any], preview: str | None = None
        ) -> bool:
            decision = policy_decision(tool_name, category, settings.permissions)
            if mode == "step" and category != "read_only" and decision == "allow":
                decision = "ask"  # step-by-step: the user sees every change before it happens
            if decision != "ask":
                return decision == "allow"
            call: dict[str, Any] = {"tool": tool_name, "category": category, "args": args}
            if preview:
                call["preview"] = preview
            event = await manager.emit_event(
                task_id, "permission_request", {"call": call, "resolution": "pending"}
            )
            resolution = await manager.await_permission(task_id, event.id)
            if resolution == "always":
                await allow_always(tool_name, settings.permissions)
                resolution = "approved"
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

        # Tools this model already has of its own aren't offered a second time.
        registry = await build_registry(
            effective, settings, native_tools(model.provider, model.model_id), source={"task_id": task_id}
        )
        register_task_tools(registry, task_id, model.id, origin_folder, depth)
        result = await run_agent_loop(
            llm,
            messages,
            registry,
            LoopCallbacks(
                permit=permit,
                on_turn_text=on_turn_text,
                on_tool_call=on_tool_call,
                on_tool_result=on_tool_result,
            ),
        )
        if result.status == "max_iterations":
            await manager.emit_event(
                task_id, "error", {"message": tr("تجاوزت المهمة الحد الأقصى من الخطوات.")}
            )
        elif result.status == "cut":
            await manager.emit_event(
                task_id,
                "error",
                {"message": tr("الموديل وصل لأقصى طول بيقدر يكتبه بمرة وحدة، حتى بعد ما طلبت منه يقسّم الشغل. اطلب منه أجزاء أصغر (صفحة صفحة مثلاً) أو جرّب موديل بيكتب ردود أطول.")},
            )
        else:
            outcome = "completed"
            final_text = result.text or ""

    except asyncio.CancelledError:
        outcome, cancelled = "cancelled", True
    except AttachmentError as exc:
        await manager.emit_event(task_id, "error", {"message": str(exc)})
    except Exception as exc:  # noqa: BLE001 - surface any failure to the transcript
        await manager.emit_event(task_id, "error", error_event(exc))
    finally:
        if registry is not None:
            await registry.aclose()
        if git_info is not None:
            # Before the status changes, so a task waiting on this one starts from its changes.
            await settle_git(task_id, title, git_info, completed=outcome == "completed")
        if outcome == "completed" and permit is not None:
            # The issue moves on before the status changes, so a waiting task sees it done.
            elapsed = asyncio.get_running_loop().time() - began
            await _issue_hook(issue_lifecycle.finished(task_id, outcome, final_text, elapsed, permit))
        await manager.set_status(task_id, outcome)
        if outcome == "completed":
            from rafiq_agent.core.issue_watch import deliver

            await _issue_hook(deliver("task_done", tr("✅ خلصت «{0}»", title), final_text[:1500]))
    if cancelled:
        raise asyncio.CancelledError
