import re
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rafiq_agent.api.deps import require_token
from rafiq_agent.core.designs import brief_message, handoff_message, localized_questions
from rafiq_agent.core.tasks_service import TaskCreateError, create_task, resolve_working_dir
from rafiq_agent.core.workspace import session_dir, workspace_root
from rafiq_agent.i18n import tr
from rafiq_agent.schemas.chats import ReplySettings
from rafiq_agent.skills.install import SkillInstallError, fetch, find_skills, install_folder
from rafiq_agent.skills.registry import USER_DIR, Skill, all_skills, get_skill, reload_skills
from rafiq_agent.storage.db import get_session
from rafiq_agent.storage.models import Chat, Design, LlmModel

router = APIRouter(tags=["designs"], dependencies=[Depends(require_token)])


def _now() -> datetime:
    return datetime.now(UTC)


class DesignCreate(BaseModel):
    model_id: str
    brief: dict[str, Any] = {}
    title: str | None = None
    working_dir: str | None = None
    # The design chat starts by sending on its own, so the search tool has to be settled
    # before it exists. None = decide by the model (see ReplySettings.web_search).
    web_search: bool | None = None
    workspace_id: str | None = None


class DesignUpdate(BaseModel):
    title: str | None = None
    status: str | None = None
    working_dir: str | None = None  # "" clears it


class DesignDocumentOut(BaseModel):
    """One thing the preview can show. "chat" documents came from the conversation and
    their HTML is already in the design; "folder" ones are HTML files sitting in the
    design's folder (the model may have written them with the filesystem tool)."""

    name: str
    source: str  # "chat" | "folder"
    path: str | None = None
    size: int | None = None


class DesignFileOut(BaseModel):
    """One document of a design — what the preview's switcher lists."""

    name: str
    html: str
    path: str | None = None


class DesignOut(BaseModel):
    # The first message of the design chat. Sent automatically when that chat is still
    # empty, so a reload never loses (or duplicates) the kickoff.
    kickoff: str = ""
    id: str
    title: str
    brief: dict[str, Any] | None = None
    spec: str | None = None
    preview_html: str | None = None
    # Every document, oldest first; the preview opens on the last one the model touched.
    files: list[DesignFileOut] = []

    @field_validator("files", mode="before")
    @classmethod
    def _no_files_is_an_empty_list(cls, value: Any) -> Any:
        # Designs made before documents were named have NULL in that column.
        return value or []

    chat_id: str
    model_id: str | None = None
    working_dir: str | None = None
    saved_path: str | None = None
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DesignSummaryOut(BaseModel):
    id: str
    title: str
    chat_id: str
    model_id: str | None = None
    working_dir: str | None = None
    status: str
    has_preview: bool = False
    created_at: datetime
    updated_at: datetime


class HandoffIn(BaseModel):
    target: str  # "chat" | "task"
    chat_id: str | None = None
    model_id: str | None = None
    working_dir: str | None = None


class HandoffOut(BaseModel):
    message: str
    chat_id: str | None = None
    task_id: str | None = None


class SkillCommandOut(BaseModel):
    name: str
    description: str = ""
    prompt: str


class SkillOut(BaseModel):
    name: str
    description: str
    source: str
    files: list[str]
    # Slash commands the skill adds to the chat composer.
    commands: list[SkillCommandOut] = []


class SkillInstallOut(BaseModel):
    skills: list[SkillOut]
    # Every command the install brought, so the UI can announce them.
    commands: list[str] = []


def _skill_out(skill: Skill) -> SkillOut:
    return SkillOut(
        name=skill.name,
        description=skill.description,
        source=skill.source,
        files=skill.files,
        commands=[SkillCommandOut(name=c.name, description=c.description, prompt=c.prompt) for c in skill.commands],
    )


@router.get("/skills", response_model=list[SkillOut])
async def list_skills() -> list[SkillOut]:
    return [_skill_out(s) for s in all_skills()]


@router.post("/skills/install", response_model=SkillInstallOut, status_code=201)
async def install_skill_from_url(body: "SkillImport") -> SkillInstallOut:
    """Installs from a URL: a GitHub repo (or folder in one), a raw SKILL.md, or a zip. A
    repository holding several skills installs all of them."""
    if not body.url:
        raise HTTPException(status_code=400, detail=tr("ابعت رابط المهارة"))
    try:
        fetched = await fetch(body.url.strip())
    except SkillInstallError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        folders = find_skills(fetched.root)
        if not folders:
            raise HTTPException(status_code=400, detail=tr("ما لقيت ملف SKILL.md بهالرابط"))
        installed = []
        for folder in folders:
            name = body.name if len(folders) == 1 else None
            try:
                installed.append(install_folder(folder, name))
            except SkillInstallError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        if fetched.temp:
            shutil.rmtree(fetched.temp, ignore_errors=True)
    reload_skills()
    skills = [s for s in all_skills() if s.path in installed]
    return SkillInstallOut(
        skills=[_skill_out(s) for s in skills],
        commands=[f"/{c.name}" for s in skills for c in s.commands],
    )


@router.get("/skills/{name}")
async def read_skill(name: str, file: str | None = None) -> dict[str, str]:
    skill = get_skill(name)
    if not skill:
        raise HTTPException(status_code=404, detail="skill not found")
    try:
        return {"name": skill.name, "file": file or "SKILL.md", "content": skill.read(file)}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _checked_dir(raw: str | None) -> str | None:
    if not raw:
        return None
    try:
        return str(resolve_working_dir(raw))
    except TaskCreateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _out(design: Design) -> DesignOut:
    out = DesignOut.model_validate(design)
    out.kickoff = brief_message(design.brief or {})
    # A design from before documents were named still has only its preview.
    if not out.files and design.preview_html:
        out.files = [DesignFileOut(name=design.title[:40], html=design.preview_html, path=design.saved_path)]
    return out


class SkillImport(BaseModel):
    """Either a folder to copy, or a name + markdown to write."""

    path: str | None = None
    name: str | None = None
    content: str | None = None
    url: str | None = None


@router.post("/skills", response_model=SkillOut, status_code=201)
async def add_skill(body: SkillImport) -> SkillOut:
    """Adds one of the user's own skills — from a folder on disk, or pasted markdown."""
    USER_DIR.mkdir(parents=True, exist_ok=True)

    if body.path:
        source = Path(body.path).expanduser()
        if source.is_file() and source.name.lower().endswith(".md"):
            source = source.parent if (source.parent / "SKILL.md").is_file() else source
        if source.is_file():
            name = _skill_name(body.name) or source.stem
            target = USER_DIR / name
            target.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target / "SKILL.md")
        elif source.is_dir():
            if not (source / "SKILL.md").is_file():
                raise HTTPException(status_code=400, detail=tr("المجلد لازم يكون فيه ملف SKILL.md"))
            name = _skill_name(body.name) or source.name
            target = USER_DIR / name
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(
                source, target, ignore=shutil.ignore_patterns(".git", "node_modules", "__pycache__")
            )
        else:
            raise HTTPException(status_code=400, detail=tr("ما لقيت هالمسار"))
    elif body.content:
        name = _skill_name(body.name)
        if not name:
            raise HTTPException(status_code=400, detail=tr("لازم اسم للمهارة"))
        target = USER_DIR / name
        target.mkdir(parents=True, exist_ok=True)
        text = body.content
        if not text.lstrip().startswith("---"):
            text = f"---\nname: {name}\ndescription: {tr('مهارة من عند المستخدم')}\n---\n\n{text}"
        (target / "SKILL.md").write_text(text, encoding="utf-8")
    else:
        raise HTTPException(status_code=400, detail=tr("ابعت مسار مجلد أو محتوى المهارة"))

    reload_skills()
    skill = get_skill(_skill_name(body.name) or target.name) or next(
        (s for s in all_skills() if s.path == target), None
    )
    if not skill:
        raise HTTPException(status_code=500, detail=tr("انضافت المهارة بس ما قدرت أقرأها"))
    return _skill_out(skill)


@router.delete("/skills/{name}", status_code=204)
async def remove_skill(name: str) -> None:
    """Only the user's own skills can be removed; the bundled ones stay."""
    skill = get_skill(name)
    if not skill or skill.source != "user":
        raise HTTPException(status_code=404, detail=tr("ما في مهارة خاصة فيك بهالاسم"))
    shutil.rmtree(skill.path, ignore_errors=True)
    reload_skills()


def _skill_name(raw: str | None) -> str | None:
    """A folder-safe slug — the skill's identity is its folder name."""
    if not raw:
        return None
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "-", raw.strip()).strip("-").lower()
    return cleaned[:60] or None


@router.get("/workspace")
async def workspace() -> dict[str, str]:
    """Where sessions without a folder of their own keep their files."""
    return {"path": str(workspace_root())}


@router.get("/designs/questions")
async def init_questions() -> list[dict[str, Any]]:
    """`impeccable init` — the brief Rafiq collects before the design chat opens."""
    return localized_questions()


@router.get("/designs", response_model=list[DesignSummaryOut])
async def list_designs(
    workspace_id: str | None = None, session: AsyncSession = Depends(get_session)
) -> list[DesignSummaryOut]:
    query = select(Design).order_by(Design.updated_at.desc())
    if workspace_id:
        query = query.where(Design.workspace_id == workspace_id)
    rows = (await session.execute(query)).scalars().all()
    return [
        DesignSummaryOut(
            id=d.id,
            title=d.title,
            chat_id=d.chat_id,
            model_id=d.model_id,
            working_dir=d.working_dir,
            status=d.status,
            has_preview=bool(d.preview_html),
            created_at=d.created_at,
            updated_at=d.updated_at,
        )
        for d in rows
    ]


@router.post("/designs", response_model=DesignOut, status_code=201)
async def create_design(body: DesignCreate, session: AsyncSession = Depends(get_session)) -> DesignOut:
    model = await session.get(LlmModel, body.model_id)
    if not model:
        raise HTTPException(status_code=404, detail="model not found")

    title = (body.title or str(body.brief.get("what") or "").strip() or tr("تصميم جديد"))[:80]
    folder = _checked_dir(body.working_dir)
    # The design chat gets the same folder, so the model can read the project it designs for.
    chat = Chat(
        title=tr("تصميم: {0}", title),
        model_id=model.id,
        mode="design",
        working_dir=folder,
        settings=ReplySettings(web_search=body.web_search).model_dump(),
        workspace_id=body.workspace_id or None,
    )
    session.add(chat)
    await session.flush()

    design = Design(
        title=title,
        brief=body.brief,
        chat_id=chat.id,
        model_id=model.id,
        working_dir=folder,
        workspace_id=body.workspace_id or None,
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
    return _out(design)


@router.get("/designs/{design_id}", response_model=DesignOut)
async def get_design(design_id: str, session: AsyncSession = Depends(get_session)) -> DesignOut:
    design = await session.get(Design, design_id)
    if not design:
        raise HTTPException(status_code=404, detail="design not found")
    return _out(design)


@router.patch("/designs/{design_id}", response_model=DesignOut)
async def update_design(
    design_id: str, body: DesignUpdate, session: AsyncSession = Depends(get_session)
) -> DesignOut:
    design = await session.get(Design, design_id)
    if not design:
        raise HTTPException(status_code=404, detail="design not found")
    if body.title is not None and body.title.strip():
        design.title = body.title.strip()[:80]
    if body.status is not None:
        design.status = body.status
    if body.working_dir is not None:
        design.working_dir = _checked_dir(body.working_dir)
        chat = await session.get(Chat, design.chat_id)
        if chat:
            chat.working_dir = design.working_dir
    design.updated_at = _now()
    await session.commit()
    await session.refresh(design)
    return _out(design)


MAX_DOCUMENT_BYTES = 4 * 1024 * 1024
DOCUMENT_SUFFIXES = (".html", ".htm")


def _folder_documents(design: Design, taken: set[str]) -> list[DesignDocumentOut]:
    """HTML files in the design's folder, minus the ones a chat document already covers."""
    if not design.working_dir:
        return []
    root = Path(design.working_dir)
    if not root.is_dir():
        return []
    out: list[DesignDocumentOut] = []
    for path in sorted(root.iterdir()):
        if not path.is_file() or path.suffix.lower() not in DOCUMENT_SUFFIXES:
            continue
        resolved = str(path.resolve())
        if resolved in taken:
            continue
        try:
            size = path.stat().st_size
        except OSError:
            continue
        out.append(DesignDocumentOut(name=path.stem, source="folder", path=resolved, size=size))
    return out[:40]


@router.get("/designs/{design_id}/documents", response_model=list[DesignDocumentOut])
async def design_documents(design_id: str, session: AsyncSession = Depends(get_session)) -> list[DesignDocumentOut]:
    """Everything the preview can open, in the order the switcher shows it."""
    design = await session.get(Design, design_id)
    if not design:
        raise HTTPException(status_code=404, detail="design not found")
    chat_documents = [
        DesignDocumentOut(name=f.get("name") or design.title, source="chat", path=f.get("path"))
        for f in (design.files or [])
    ]
    if not chat_documents and design.preview_html:
        chat_documents = [DesignDocumentOut(name=design.title[:40], source="chat", path=design.saved_path)]
    taken = {str(Path(d.path).resolve()) for d in chat_documents if d.path}
    return chat_documents + _folder_documents(design, taken)


@router.get("/designs/{design_id}/documents/read")
async def read_design_document(design_id: str, path: str, session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    """One HTML file from the design's folder. Nothing outside that folder is readable."""
    design = await session.get(Design, design_id)
    if not design:
        raise HTTPException(status_code=404, detail="design not found")
    if not design.working_dir:
        raise HTTPException(status_code=400, detail=tr("هالتصميم ما إله مجلد."))
    root = Path(design.working_dir).resolve()
    target = Path(path).expanduser().resolve()
    if root not in target.parents or target.suffix.lower() not in DOCUMENT_SUFFIXES or not target.is_file():
        raise HTTPException(status_code=400, detail=tr("ما فيك تقرأ هالملف."))
    if target.stat().st_size > MAX_DOCUMENT_BYTES:
        raise HTTPException(status_code=400, detail=tr("الملف كبير كتير على المعاينة."))
    return {"name": target.stem, "html": target.read_text(encoding="utf-8", errors="replace")}


@router.delete("/designs/{design_id}", status_code=204)
async def delete_design(design_id: str, session: AsyncSession = Depends(get_session)) -> None:
    design = await session.get(Design, design_id)
    if not design:
        raise HTTPException(status_code=404, detail="design not found")
    chat = await session.get(Chat, design.chat_id)
    if chat:
        await session.delete(chat)
    await session.delete(design)
    await session.commit()


@router.post("/designs/{design_id}/handoff", response_model=HandoffOut)
async def handoff(
    design_id: str, body: HandoffIn, session: AsyncSession = Depends(get_session)
) -> HandoffOut:
    """Sends the finished design to whoever is going to build it."""
    design = await session.get(Design, design_id)
    if not design:
        raise HTTPException(status_code=404, detail="design not found")
    if not design.preview_html and not design.spec:
        raise HTTPException(status_code=400, detail=tr("لسا ما في تصميم — خلّص التصميم أول."))

    message = handoff_message(design.title, design.spec, design.preview_html)

    if body.target == "task":
        try:
            task = await create_task(
                title=tr("ابنِ تصميم: {0}", design.title),
                prompt=message,
                model_id=body.model_id or design.model_id or "",
                working_dir=body.working_dir or design.working_dir,
                origin={"design_id": design.id},
            )
        except TaskCreateError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        design.status = "handed_off"
        design.updated_at = _now()
        await session.commit()
        return HandoffOut(message=message, task_id=task.id)

    if body.target != "chat":
        raise HTTPException(status_code=400, detail=tr("target لازم يكون chat أو task"))

    chat_id = body.chat_id
    if chat_id:
        chat = await session.get(Chat, chat_id)
        if not chat:
            raise HTTPException(status_code=404, detail="chat not found")
    else:
        chat = Chat(title=tr("برمجة: {0}", design.title), model_id=body.model_id or design.model_id)
        session.add(chat)
        await session.flush()
        chat_id = chat.id

    design.status = "handed_off"
    design.updated_at = _now()
    await session.commit()
    return HandoffOut(message=message, chat_id=chat_id)
