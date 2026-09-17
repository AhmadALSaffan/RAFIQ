"""Installing a skill from the internet: a GitHub repository (or a folder inside one), a
raw `SKILL.md`, or a zip archive.

Only public HTTPS URLs are fetched, nothing is executed, and only markdown and small
text files are kept — a skill is instructions, not code.
"""

from __future__ import annotations

import io
import re
import shutil
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

import httpx

from rafiq_agent.i18n import tr
from rafiq_agent.skills.registry import USER_DIR

MAX_ARCHIVE_BYTES = 60 * 1024 * 1024
# Extracted text may be larger than the archive (repos mirror a skill into many folders).
MAX_EXTRACT_BYTES = 200 * 1024 * 1024
MAX_FILE_BYTES = 2 * 1024 * 1024
KEEP_SUFFIXES = {".md", ".txt", ".json", ".yaml", ".yml", ".csv", ".css", ".html"}
_GITHUB = re.compile(r"^/(?P<owner>[\w.-]+)/(?P<repo>[\w.-]+?)(?:\.git)?(?:/(?P<kind>tree|blob)/(?P<ref>[^/]+)(?P<path>/.*)?)?/?$")
_SAFE_NAME = re.compile(r"[^a-z0-9؀-ۿ_-]+")


class SkillInstallError(Exception):
    pass


@dataclass
class Fetched:
    """A folder on disk holding the downloaded skill(s), plus the temp root to remove."""

    root: Path
    temp: Path | None


def skill_folder_name(raw: str) -> str:
    return _SAFE_NAME.sub("-", raw.strip().lower()).strip("-")[:60] or "skill"


def _github_parts(url: str) -> tuple[str, str, str | None, str] | None:
    parsed = urlparse(url)
    if parsed.hostname not in ("github.com", "www.github.com"):
        return None
    match = _GITHUB.match(parsed.path)
    if not match:
        return None
    return match["owner"], match["repo"], match["ref"], (match["path"] or "").strip("/")


async def _get(client: httpx.AsyncClient, url: str) -> httpx.Response:
    response = await client.get(url, follow_redirects=True)
    if response.status_code == 404:
        raise SkillInstallError(tr("ما لقيت شي على هالرابط."))
    response.raise_for_status()
    if len(response.content) > MAX_ARCHIVE_BYTES:
        raise SkillInstallError(tr("الملف أكبر من الحد المسموح."))
    return response


async def fetch(url: str) -> Fetched:
    """Downloads whatever the URL points at into a temp folder."""
    if urlparse(url).scheme != "https":
        raise SkillInstallError(tr("الرابط لازم يبلّش بـ https://"))
    temp = Path(tempfile.mkdtemp(prefix="rafiq-skill-"))
    try:
        async with httpx.AsyncClient(timeout=60, headers={"User-Agent": "rafiq-agent"}) as client:
            github = _github_parts(url)
            if github:
                owner, repo, ref, subpath = github
                if subpath.lower().endswith(".md"):
                    raw = f"https://raw.githubusercontent.com/{owner}/{repo}/{ref or 'HEAD'}/{subpath}"
                    (temp / "SKILL.md").write_bytes((await _get(client, raw)).content[:MAX_FILE_BYTES])
                    return Fetched(temp, temp)
                refs = [ref] if ref else ["main", "master"]
                archive = None
                for candidate in refs:
                    response = await client.get(
                        f"https://codeload.github.com/{owner}/{repo}/zip/refs/heads/{candidate}",
                        follow_redirects=True,
                    )
                    if response.status_code == 200:
                        archive = response.content
                        break
                if archive is None:
                    raise SkillInstallError(tr("ما قدرت أنزّل المستودع من GitHub."))
                root = _unzip(archive, temp)
                target = root / subpath if subpath else root
                if not target.is_dir():
                    raise SkillInstallError(tr("المجلد {0} مش موجود بالمستودع.", subpath))
                return Fetched(target, temp)
            response = await _get(client, url)
            kind = response.headers.get("content-type", "").split(";")[0].strip()
            if url.lower().endswith(".zip") or kind in ("application/zip", "application/x-zip-compressed"):
                return Fetched(_unzip(response.content, temp), temp)
            text = response.content[:MAX_FILE_BYTES].decode("utf-8", errors="replace")
            (temp / "SKILL.md").write_text(text, encoding="utf-8")
            return Fetched(temp, temp)
    except SkillInstallError:
        shutil.rmtree(temp, ignore_errors=True)
        raise
    except Exception as exc:  # noqa: BLE001 - the reason is the message
        shutil.rmtree(temp, ignore_errors=True)
        raise SkillInstallError(tr("ما قدرت أنزّل الرابط: {0}", exc)) from exc


def _unzip(data: bytes, into: Path) -> Path:
    """Extracts safely (no paths outside `into`, only text-like files) and returns the
    single top-level folder GitHub archives have, or `into` itself."""
    total = 0
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for member in archive.infolist():
            if member.is_dir():
                continue
            name = member.filename.replace("\\", "/")
            if name.startswith("/") or ".." in name.split("/"):
                continue
            if Path(name).suffix.lower() not in KEEP_SUFFIXES or member.file_size > MAX_FILE_BYTES:
                continue
            total += member.file_size
            if total > MAX_EXTRACT_BYTES:
                raise SkillInstallError(tr("الملف أكبر من الحد المسموح."))
            out = into / name
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(archive.read(member))
    children = [p for p in into.iterdir() if p.is_dir()]
    files = [p for p in into.iterdir() if p.is_file()]
    return children[0] if len(children) == 1 and not files else into


_SKIP_PARTS = {".git", "node_modules", "tests", "test", "__tests__", "fixtures", "examples"}


def find_skills(root: Path) -> list[Path]:
    """Every skill folder under `root` (including root) — a repo can hold many. Repos that
    mirror one skill into per-tool folders (.claude/, .cursor/, .gemini/…) count it once,
    preferring the .claude/ or plain skills/ copy."""
    if (root / "SKILL.md").is_file():
        return [root]
    best: dict[str, tuple[tuple[int, int], Path]] = {}
    for doc in sorted(root.rglob("SKILL.md")):
        rel = doc.parent.relative_to(root).parts
        if _SKIP_PARTS & set(rel):
            continue
        hidden = [part for part in rel if part.startswith(".")]
        rank = (0 if ".claude" in hidden else 1 if not hidden else 2, len(rel))
        name = doc.parent.name
        if name not in best or rank < best[name][0]:
            best[name] = (rank, doc.parent)
    return [folder for _, folder in sorted(best.values(), key=lambda item: item[1].name)][:50]


def install_folder(source: Path, name: str | None = None) -> Path:
    """Copies one skill folder into the user's skills. Returns the installed path."""
    if not (source / "SKILL.md").is_file():
        raise SkillInstallError(tr("المجلد لازم يكون فيه ملف SKILL.md"))
    folder = skill_folder_name(name or source.name)
    target = USER_DIR / folder
    USER_DIR.mkdir(parents=True, exist_ok=True)
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(
        source,
        target,
        ignore=shutil.ignore_patterns(".git", "node_modules", "__pycache__", "*.pyc", "*.exe", "*.dll"),
    )
    return target
