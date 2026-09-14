from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query

from rafiq_agent.api.deps import require_token
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
