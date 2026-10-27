"""Designs and motion projects, made from their pages or from any chat.

The pages call these through the API; a chat's model calls them through `design_start` and
`motion_start` (tools/studio.py), and then the new session's first turn starts right away
on the server — it keeps going with no page open, and the page joins it when opened."""

from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rafiq_agent.core import art_direction
from rafiq_agent.core import identity as identity_core
from rafiq_agent.core.workspace import session_dir
from rafiq_agent.i18n import tr
from rafiq_agent.motion import brand
from rafiq_agent.motion import scene as rms
from rafiq_agent.schemas.chats import ReplySettings
from rafiq_agent.storage.models import Chat, Design, LlmModel, MotionProject, MotionVersion


async def new_design(
    session: AsyncSession,
    model: LlmModel,
    brief: dict[str, Any],
    *,
    identity: dict[str, Any] | None = None,
    title: str | None = None,
    working_dir: str | None = None,
    workspace_id: str | None = None,
    web_search: bool | None = None,
) -> Design:
    """A design and its chat, committed. `working_dir` is already checked by the caller."""
    title = (title or str(brief.get("what") or "").strip() or tr("تصميم جديد"))[:80]
    if art_direction.wants_direction(brief) and brief.get("art") not in art_direction.DIRECTIONS:
        # a composition of its own, not one the user's recent sites got
        recent_briefs = (await session.execute(select(Design.brief).order_by(Design.created_at.desc()).limit(8))).scalars().all()
        recent = [str(b.get("art")) for b in recent_briefs if isinstance(b, dict) and b.get("art")]
        brief = {**brief, "art": art_direction.pick(brief, recent)}
    # The design chat gets the same folder, so the model can read the project it designs for.
    chat = Chat(
        title=tr("تصميم: {0}", title),
        model_id=model.id,
        mode="design",
        working_dir=working_dir,
        settings=ReplySettings(web_search=web_search).model_dump(),
        workspace_id=workspace_id or None,
    )
    session.add(chat)
    await session.flush()
    design = Design(
        title=title,
        brief=brief,
        identity=identity_core.normalize(identity) if identity else None,
        chat_id=chat.id,
        model_id=model.id,
        working_dir=working_dir,
        workspace_id=workspace_id or None,
    )
    session.add(design)
    await session.flush()
    if not design.working_dir:
        # Without a folder the design would live only in the database; give it one so every
        # version lands on disk where the user can find it.
        design.working_dir = str(session_dir("designs", design.id, title))
        chat.working_dir = design.working_dir
    await session.commit()
    await session.refresh(design)
    return design


async def new_motion(
    session: AsyncSession,
    model: LlmModel,
    *,
    title: str | None = None,
    aspect: str = "9:16",
    fps: int = 30,
    duration: float = 10.0,
    brand_name: str | None = None,
    working_dir: str | None = None,
    workspace_id: str | None = None,
) -> MotionProject:
    """A motion project with an empty scene and its chat, committed. The caller checks the
    aspect and the frame rate."""
    from rafiq_agent.core import motion as service

    title = (title or tr("مشروع موشن")).strip()[:80]
    scene = rms.new_scene(aspect, fps, max(0.5, min(duration, 7200)), title)
    if brand_name and brand_name in brand.TEMPLATES:
        scene["brand"] = brand_name
    chat = Chat(
        title=tr("موشن: {0}", title),
        model_id=model.id,
        mode="motion",
        settings=ReplySettings().model_dump(),
        workspace_id=workspace_id or None,
    )
    session.add(chat)
    await session.flush()
    project = MotionProject(title=title, workspace_id=workspace_id or None, chat_id=chat.id, model_id=model.id, folder="", scene=scene, version=1)
    session.add(project)
    await session.flush()
    folder = Path(working_dir) if working_dir and Path(working_dir).is_dir() else session_dir("motion", project.id, title)
    project.folder = str(folder)
    chat.working_dir = str(folder)
    session.add(MotionVersion(project_id=project.id, number=1, scene=scene, author="user", summary=tr("مشهد فاضي")))
    await session.commit()
    await session.refresh(project)
    service.write_scene_file(project)
    return project


async def kick_off(chat_id: str, message: str, model_id: str) -> None:
    """Sends a new session's first message and lets the reply run on the server."""
    from rafiq_agent.core.chat_service import ChatTurn

    turn = ChatTurn(chat_id, message, model_id, [])
    await turn.prepare()
    await turn.start()
