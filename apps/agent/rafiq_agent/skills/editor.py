"""Writing skills inside the app: check a SKILL.md before it's saved, and read/write the
files of one of the user's own skills.

A skill is a folder: `SKILL.md` (front matter + body), optional reference files next to it
(`*.md`, which the model asks for by name), and an optional `commands/` folder with one
`<name>.md` per slash command. The editor touches only those — text files inside the folder,
never anything else on disk — and only for skills in the user's own folder; a bundled skill
is copied there first ("my own version"), which then overrides it by name.
"""

from __future__ import annotations

import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from rafiq_agent.i18n import tr
from rafiq_agent.skills.registry import (
    _FRONT_MATTER,
    MAX_SKILL_CHARS,
    USER_DIR,
    Skill,
    _front_matter,
    all_skills,
    command_name,
    get_skill,
    reload_skills,
)

# Files the editor will read or write, relative to the skill folder.
_FILE = re.compile(r"^(?:commands/)?[A-Za-z0-9][A-Za-z0-9_.-]{0,80}\.md$")
_SLUG = re.compile(r"^[a-z0-9][a-z0-9_-]{0,59}$")
MAX_FILE_CHARS = 200_000
SHORT_DESCRIPTION = 20
LONG_DESCRIPTION = 1024


class SkillEditError(ValueError):
    """Something the user can fix; the message is already translated."""


@dataclass
class Issue:
    message: str
    line: int | None = None


@dataclass
class SkillCheck:
    name: str = ""
    description: str = ""
    commands: list[tuple[str, str]] = field(default_factory=list)
    errors: list[Issue] = field(default_factory=list)
    warnings: list[Issue] = field(default_factory=list)
    size: int = 0

    @property
    def ok(self) -> bool:
        return not self.errors


def _line_of(text: str, key: str) -> int | None:
    for number, line in enumerate(text.splitlines(), start=1):
        if line.strip().lower().startswith(f"{key}:"):
            return number
    return None


def check_skill(text: str, folder: Path | None = None) -> SkillCheck:
    """What would go wrong with this SKILL.md, before it's saved. Errors block saving;
    warnings are advice (the model still reads the skill)."""
    result = SkillCheck(size=len(text))
    head = _FRONT_MATTER.match(text)
    if not head:
        result.errors.append(Issue(tr("الملف لازم يبلّش بترويسة بين سطرين --- فيها name و description."), 1))
        return result

    scalars, declared = _front_matter(text)
    result.name = scalars.get("name", "").strip()
    result.description = scalars.get("description", "").strip()

    if not result.name:
        result.errors.append(Issue(tr("ناقص name بالترويسة — هو الاسم اللي النموذج بيطلب فيه المهارة."), 2))
    elif not _SLUG.match(result.name):
        result.warnings.append(
            Issue(tr("الأفضل يكون الاسم أحرف إنجليزية صغيرة وأرقام و - بس (مثلاً my-skill)."), _line_of(text, "name"))
        )

    if not result.description:
        result.errors.append(Issue(tr("ناقص description — النموذج بيقرّر يقرأ المهارة أو لا من الوصف."), 2))
    elif len(result.description) < SHORT_DESCRIPTION:
        result.warnings.append(
            Issue(tr("الوصف قصير كتير: قول متى لازم النموذج يستعمل هالمهارة."), _line_of(text, "description"))
        )
    elif len(result.description) > LONG_DESCRIPTION:
        result.warnings.append(
            Issue(tr("الوصف طويل ({0} حرف) — بينبعت مع كل رسالة، خلّيه أقل من {1}.", len(result.description), LONG_DESCRIPTION), _line_of(text, "description"))
        )

    body = text[head.end():].strip()
    if not body:
        result.errors.append(Issue(tr("المهارة فاضية — اكتب التعليمات تحت الترويسة.")))
    if len(text) > MAX_SKILL_CHARS:
        result.warnings.append(
            Issue(tr("الملف أطول من {0} حرف: النموذج بيقرأ أول {0} بس. انقل التفاصيل لملفات مرجعية.", MAX_SKILL_CHARS))
        )

    for index, entry in enumerate(declared, start=1):
        name = command_name(entry.get("name", ""))
        if not name:
            result.errors.append(Issue(tr("الأمر رقم {0} بلا name.", index), _line_of(text, "commands")))
            continue
        prompt_file = entry.get("prompt_file", "")
        if not entry.get("prompt") and not prompt_file:
            result.errors.append(Issue(tr("الأمر /{0} لازم يكون إله prompt أو prompt_file.", name), _line_of(text, "commands")))
            continue
        if prompt_file and folder is not None and not (folder / prompt_file).is_file():
            result.warnings.append(Issue(tr("الأمر /{0} بيشاور على {1} وهالملف مش موجود.", name, prompt_file), _line_of(text, "commands")))
        result.commands.append((name, entry.get("description", "")))
    return result


def _owned(name: str) -> Skill:
    skill = get_skill(name)
    if not skill:
        raise SkillEditError(tr("ما لقيت هالمهارة."))
    if skill.source != "user":
        raise SkillEditError(tr("هاي مهارة مدمجة — اعمل نسختك منها أول وعدّل عليها."))
    return skill


def _target(skill: Skill, path: str) -> Path:
    clean = path.replace("\\", "/").strip().lstrip("/")
    if clean != "SKILL.md" and not _FILE.match(clean):
        raise SkillEditError(tr("اسم الملف لازم ينتهي بـ .md ويكون جوّا المهارة (أو جوّا commands/)."))
    target = (skill.path / clean).resolve()
    root = skill.path.resolve()
    if root not in target.parents:
        raise SkillEditError(tr("اسم الملف لازم ينتهي بـ .md ويكون جوّا المهارة (أو جوّا commands/)."))
    return target


def list_files(skill: Skill) -> list[dict[str, object]]:
    """SKILL.md first, then the reference files, then the commands."""
    files: list[dict[str, object]] = []
    root = skill.path
    main = root / "SKILL.md"
    if main.is_file():
        files.append({"path": "SKILL.md", "size": main.stat().st_size})
    for file in sorted(root.glob("*.md")):
        if file.name != "SKILL.md":
            files.append({"path": file.name, "size": file.stat().st_size})
    commands = root / "commands"
    if commands.is_dir():
        for file in sorted(commands.glob("*.md")):
            files.append({"path": f"commands/{file.name}", "size": file.stat().st_size})
    return files


def read_file(skill: Skill, path: str) -> str:
    """The whole file — unlike Skill.read, which trims what the model gets."""
    target = _target(skill, path)
    if not target.is_file():
        raise SkillEditError(tr("ما لقيت هالملف بالمهارة."))
    return target.read_text(encoding="utf-8")


def write_file(name: str, path: str, content: str) -> Skill:
    """Saves one file of the user's own skill. SKILL.md has to pass the check first."""
    skill = _owned(name)
    target = _target(skill, path)
    if len(content) > MAX_FILE_CHARS:
        raise SkillEditError(tr("الملف كبير كتير (أكتر من {0} حرف).", MAX_FILE_CHARS))
    if target.name == "SKILL.md" and target.parent == skill.path.resolve():
        check = check_skill(content, skill.path)
        if not check.ok:
            raise SkillEditError(check.errors[0].message)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    reload_skills()
    # The name may have changed in the front matter; find the skill by its folder.
    return _by_folder(skill.path) or skill


def delete_file(name: str, path: str) -> None:
    skill = _owned(name)
    target = _target(skill, path)
    if target.name == "SKILL.md" and target.parent == skill.path.resolve():
        raise SkillEditError(tr("ما بينحذف SKILL.md — احذف المهارة كلها بدالها."))
    target.unlink(missing_ok=True)
    reload_skills()


def create_skill(content: str) -> Skill:
    """A new skill of the user's, from its SKILL.md. The folder is named after `name`."""
    check = check_skill(content)
    if not check.ok:
        raise SkillEditError(check.errors[0].message)
    folder = _folder_name(check.name)
    target = USER_DIR / folder
    if target.exists():
        raise SkillEditError(tr("في مهارة إلك بهالاسم من قبل — اختار اسم تاني."))
    target.mkdir(parents=True)
    (target / "SKILL.md").write_text(content, encoding="utf-8")
    reload_skills()
    skill = _by_folder(target)
    if not skill:
        raise SkillEditError(tr("انضافت المهارة بس ما قدرت أقرأها"))
    return skill


def copy_skill(name: str) -> Skill:
    """The user's own version of a skill (usually a bundled one): same name, so it takes over."""
    skill = get_skill(name)
    if not skill:
        raise SkillEditError(tr("ما لقيت هالمهارة."))
    if skill.source == "user":
        return skill
    target = USER_DIR / skill.path.name
    if target.exists():
        raise SkillEditError(tr("في مهارة إلك بهالاسم من قبل — اختار اسم تاني."))
    USER_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copytree(skill.path, target, ignore=shutil.ignore_patterns("__pycache__", "*.py", "*.pyc"))
    reload_skills()
    return _by_folder(target) or skill


def _folder_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "-", name.strip()).strip("-").lower()[:60]
    return cleaned or "skill"


def _by_folder(folder: Path) -> Skill | None:
    resolved = folder.resolve()
    return next((s for s in all_skills() if s.path.resolve() == resolved), None)
