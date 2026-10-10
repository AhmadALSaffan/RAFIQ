import mimetypes
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from rafiq_agent.api.deps import require_token
from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.core import gitops
from rafiq_agent.i18n import tr

router = APIRouter(prefix="/files", tags=["files"], dependencies=[Depends(require_token)])

SKIP_DIRS = {
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "__pycache__",
    "dist",
    "build",
    "target",
    ".next",
    ".nuxt",
    ".cache",
    ".idea",
    ".vscode",
    "vendor",
    ".mypy_cache",
    ".pytest_cache",
}
MAX_WALK = 20_000


@router.get("/git")
async def git_info(dir: str = Query(..., description="a folder the user picked")) -> dict[str, object]:
    """Whether a folder is in a git repository, and its current branch — what a task
    template's `{{branch}}` starts out as."""
    branch = await gitops.current_branch(Path(dir).expanduser())
    repo = branch is not None or await gitops.repo_root(Path(dir).expanduser()) is not None
    return {"repo": repo, "branch": branch}


@router.get("")
async def list_files(
    dir: str = Query(..., description="folder to list, usually the chat's working dir"),
    query: str = "",
    limit: int = 60,
) -> list[dict[str, object]]:
    """Files under a folder for the chat's @-mention picker. Skips build/vendor noise."""
    root = Path(dir).expanduser()
    if not root.is_dir():
        raise HTTPException(status_code=400, detail=tr("المجلد غير موجود: {0}", root))
    root = root.resolve()

    needle = query.lower().strip()
    matches: list[dict[str, object]] = []
    seen = 0
    for path in root.rglob("*"):
        seen += 1
        if seen > MAX_WALK:
            break
        if any(
            part in SKIP_DIRS or part.startswith(".") and part not in (".env",)
            for part in path.relative_to(root).parts[:-1]
        ):
            continue
        if path.is_dir():
            continue
        rel = path.relative_to(root).as_posix()
        if needle and needle not in rel.lower():
            continue
        try:
            size = path.stat().st_size
        except OSError:
            continue
        matches.append({"path": rel, "name": path.name, "size": size, "depth": rel.count("/")})
        if len(matches) >= limit * 4:
            break

    # Shallow, exact-ish matches first — that's what the user usually means.
    matches.sort(key=lambda m: (needle not in str(m["name"]).lower(), m["depth"], str(m["path"]).lower()))
    return matches[:limit]


# ── Previewing what the model made ─────────────────────────────────────────────────────
# The chat's side panel shows the files the model wrote. Text comes back as text; pictures,
# web pages and PDFs are fetched raw by the panel itself (an <img>/<iframe> can't send the
# Authorization header, so that one route takes ?token= like attachments do).

PREVIEW_CHARS = 300_000
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"}
HTML_SUFFIXES = {".html", ".htm"}
MARKDOWN_SUFFIXES = {".md", ".markdown"}


def _inside(dir: str, path: str) -> Path:
    root = Path(dir).expanduser().resolve()
    target = (root / path).resolve()
    if target != root and root not in target.parents:
        raise HTTPException(status_code=400, detail=tr("الملف برا مجلد المحادثة."))
    if not target.is_file():
        raise HTTPException(status_code=404, detail=tr("الملف مش موجود: {0}", path))
    return target


def preview_kind(target: Path) -> str:
    suffix = target.suffix.lower()
    if suffix in IMAGE_SUFFIXES:
        return "image"
    if suffix in HTML_SUFFIXES:
        return "html"
    if suffix == ".pdf":
        return "pdf"
    with target.open("rb") as f:
        if b"\x00" in f.read(4096):
            return "binary"
    return "markdown" if suffix in MARKDOWN_SUFFIXES else "text"


@router.get("/preview")
async def preview(dir: str = Query(...), path: str = Query(...)) -> dict[str, object]:
    target = _inside(dir, path)
    kind = preview_kind(target)
    out: dict[str, object] = {"path": path, "name": target.name, "size": target.stat().st_size, "kind": kind}
    if kind in ("text", "markdown", "html"):
        text = target.read_text(encoding="utf-8", errors="replace")
        out["text"] = text[:PREVIEW_CHARS]
        out["truncated"] = len(text) > PREVIEW_CHARS
    return out


raw_router = APIRouter(prefix="/files", tags=["files"])


@raw_router.get("/raw")
async def raw(dir: str = Query(...), path: str = Query(...), token: str = Query(...)) -> FileResponse:
    if token != AUTH_TOKEN:
        raise HTTPException(status_code=401, detail="invalid token")
    target = _inside(dir, path)
    media = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    return FileResponse(target, media_type=media)
