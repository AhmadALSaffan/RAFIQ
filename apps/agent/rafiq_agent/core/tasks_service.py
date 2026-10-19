from pathlib import Path
from typing import Any

from rafiq_agent.core.attachments import AttachmentError, load_attachments, meta
from rafiq_agent.core.manager import manager
from rafiq_agent.core.workspace import session_dir
from rafiq_agent.i18n import tr
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import LlmModel, Task


class TaskCreateError(Exception):
    pass


def resolve_working_dir(raw: str | None) -> Path | None:
    """A folder the user picked. `None` means "no folder yet" — the caller decides."""
    if not raw:
        return None
    path = Path(raw).expanduser()
    if not path.is_dir():
        raise TaskCreateError(tr("المجلد غير موجود: {0}", path))
    return path.resolve()


async def link_issue(raw: dict[str, Any]) -> dict[str, Any]:
    """What a task keeps about its issue — and, when the account maps the issue's project to
    a folder, that folder ("folder", taken out by the caller)."""
    from rafiq_agent.core import issues as svc
    from rafiq_agent.integrations.base import IntegrationError

    integration_id, key = str(raw.get("integration_id") or ""), str(raw.get("key") or "")
    if not key:
        raise TaskCreateError(tr("ناقص مفتاح المهمة."))
    try:
        row, client = await svc.resolve(key, integration_id or None)
        found = await client.get_issue(key)
    except IntegrationError as exc:
        raise TaskCreateError(str(exc)) from exc
    mapping = svc.settings_of(row).project_map
    folder = None
    for name in filter(None, (found.extra.get("project_key"), found.extra.get("team_key"), found.project)):
        if name in mapping:
            folder = mapping[name]
            break
    return {
        "integration_id": row.id,
        "provider": row.provider,
        "account": row.name,
        "key": found.key,
        "url": found.url,
        "title": found.title,
        "folder": folder,
    }


async def create_task(
    *,
    title: str,
    prompt: str,
    model_id: str,
    working_dir: str | None,
    attachment_ids: list[str] | None = None,
    origin: dict[str, Any] | None = None,
    paths: list[str] | None = None,
    depends_on: list[str] | None = None,
    mode: str = "auto",
    workspace_id: str | None = None,
    issue: dict[str, Any] | None = None,
) -> Task:
    """Validates, stores, and queues a task. Tasks run in parallel unless they'd edit the
    same files (`paths`, or the whole folder when none are given) or wait on `depends_on`."""
    linked = await link_issue(issue) if issue else None
    if linked and not working_dir:
        working_dir = linked.pop("folder", None)
    elif linked:
        linked.pop("folder", None)
    directory = resolve_working_dir(working_dir)
    try:
        attachments = await load_attachments(attachment_ids or [])
    except AttachmentError as exc:
        raise TaskCreateError(str(exc)) from exc
    paths = [str(p).strip() for p in paths or [] if str(p).strip()] or None
    depends_on = list(dict.fromkeys(str(d).strip() for d in depends_on or [] if str(d).strip())) or None

    from rafiq_agent.core.agent_runtime import load_settings
    from rafiq_agent.core.task_git import plan

    planned = await plan(str(directory) if directory else None, (await load_settings()).task_isolation)

    async with SessionLocal() as session:
        if not await session.get(LlmModel, model_id):
            raise TaskCreateError(tr("النموذج غير موجود."))
        for dep in depends_on or []:
            if not await session.get(Task, dep):
                raise TaskCreateError(tr("ما في مهمة بهالرقم: {0}", dep))
        clean_title = (title.strip() or prompt.strip().splitlines()[0])[:120]
        task = Task(
            title=clean_title,
            prompt=prompt,
            model_id=model_id,
            # No folder picked? The task still needs somewhere to write — give it its own
            # folder in the workspace instead of dropping files in the home directory.
            working_dir=str(directory) if directory else "",
            attachments=[meta(a) for a in attachments] or None,
            origin=origin,
            paths=paths,
            depends_on=depends_on,
            git=planned,
            mode=mode if mode in ("auto", "plan", "step") else "auto",
            workspace_id=workspace_id or None,
            issue=linked,
            status="queued",
        )
        session.add(task)
        await session.flush()
        if not task.working_dir:
            task.working_dir = str(session_dir("tasks", task.id, clean_title))
        await session.commit()
        await session.refresh(task)

    manager.enqueue(task.id, task.working_dir, task.paths, task.depends_on, isolated=bool(planned))
    return task
