"""Agent skills — long-form guidance the model reads on demand.

These are plain folders with a `SKILL.md` (YAML front matter + markdown) and optional
reference files next to it, the same shape Claude Code uses. Rafiq loads them itself and
hands them to the model through ordinary tool calls, so they work with **every** provider
(OpenAI, DeepSeek, Ollama, Anthropic…), not just the ones with a native skill system.

Users can drop their own folders into `<data dir>/skills` and they show up alongside the
bundled ones.

A skill can also bring slash commands for the chat composer, two ways:

* a `commands:` list in the front matter — each entry has `name`, `description` and a
  `prompt` (or `prompt_file`, a file inside the skill folder);
* a `commands/` folder with one `<name>.md` per command (the first heading is the
  description, the body is the prompt).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from rafiq_agent.config import DATA_DIR

BUNDLED_DIR = Path(__file__).parent / "bundled"
USER_DIR = DATA_DIR / "skills"
# Skills are long (one is 40KB+). Sending all of that back as a tool result blows up the
# context of smaller models and they answer with nothing at all, so trim hard.
MAX_SKILL_CHARS = 14_000
MAX_COMMAND_PROMPT = 4_000

_FRONT_MATTER = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
_COMMAND_NAME = re.compile(r"[^a-z0-9؀-ۿ_-]+")


@dataclass
class SkillCommand:
    name: str
    description: str
    prompt: str


@dataclass
class Skill:
    name: str
    description: str
    path: Path
    source: str  # "bundled" | "user"
    commands: list[SkillCommand] = field(default_factory=list)

    @property
    def files(self) -> list[str]:
        """Extra reference files the model can ask for by name."""
        return sorted(p.name for p in self.path.glob("*.md") if p.name != "SKILL.md")

    def read(self, file: str | None = None) -> str:
        target = self.path / (file or "SKILL.md")
        # Keep the model inside the skill folder, whatever name it passes.
        if target.resolve().parent != self.path.resolve() or not target.is_file():
            raise FileNotFoundError(file or "SKILL.md")
        text = target.read_text(encoding="utf-8")
        return text if len(text) <= MAX_SKILL_CHARS else text[:MAX_SKILL_CHARS] + "\n\n… (مقطوع)"


def _unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        return value[1:-1]
    return value


def command_name(raw: str) -> str:
    """A slash-command name: lowercase, no spaces, letters (Latin or Arabic), digits, - and _."""
    return _COMMAND_NAME.sub("-", raw.strip().lower().lstrip("/")).strip("-")[:40]


def _front_matter(text: str) -> tuple[dict[str, str], list[dict[str, str]]]:
    """The scalar keys and the `commands:` list. A tiny reader for the subset skills use —
    no YAML dependency, and a malformed header never breaks the skill."""
    head = _FRONT_MATTER.match(text)
    scalars: dict[str, str] = {}
    commands: list[dict[str, str]] = []
    if not head:
        return scalars, commands
    in_commands = False
    for raw in head.group(1).splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip())
        line = raw.strip()
        if indent == 0:
            key, _, value = line.partition(":")
            key = key.strip().lower()
            in_commands = key == "commands"
            if not in_commands and value.strip():
                scalars[key] = _unquote(value)
            continue
        if not in_commands:
            continue
        if line.startswith("- "):
            commands.append({})
            line = line[2:].strip()
            if not line:
                continue
        if not commands:
            continue
        key, _, value = line.partition(":")
        commands[-1][key.strip().lower()] = _unquote(value)
    return scalars, commands


def _load_commands(skill_dir: Path, declared: list[dict[str, str]]) -> list[SkillCommand]:
    found: dict[str, SkillCommand] = {}
    for entry in declared:
        name = command_name(entry.get("name", ""))
        if not name:
            continue
        prompt = entry.get("prompt", "")
        if not prompt and (file := entry.get("prompt_file")):
            target = (skill_dir / file).resolve()
            if target.parent == skill_dir.resolve() or skill_dir.resolve() in target.parents:
                try:
                    prompt = target.read_text(encoding="utf-8")
                except OSError:
                    prompt = ""
        if prompt:
            found[name] = SkillCommand(name, entry.get("description", ""), prompt[:MAX_COMMAND_PROMPT])
    commands_dir = skill_dir / "commands"
    if commands_dir.is_dir():
        for file in sorted(commands_dir.glob("*.md")):
            name = command_name(file.stem)
            if not name or name in found:
                continue
            try:
                text = file.read_text(encoding="utf-8").strip()
            except OSError:
                continue
            scalars, _ = _front_matter(text)
            body = _FRONT_MATTER.sub("", text, count=1).strip()
            description = scalars.get("description", "")
            if not description and body.startswith("#"):
                first, _, rest = body.partition("\n")
                description, body = first.lstrip("# ").strip(), rest.strip()
            if body:
                found[name] = SkillCommand(name, description, body[:MAX_COMMAND_PROMPT])
    return list(found.values())


def _parse(skill_dir: Path, source: str) -> Skill | None:
    doc = skill_dir / "SKILL.md"
    if not doc.is_file():
        return None
    scalars, declared = _front_matter(doc.read_text(encoding="utf-8"))
    return Skill(
        name=scalars.get("name") or skill_dir.name,
        description=scalars.get("description", ""),
        path=skill_dir,
        source=source,
        commands=_load_commands(skill_dir, declared),
    )


@lru_cache(maxsize=1)
def _load() -> dict[str, Skill]:
    found: dict[str, Skill] = {}
    for directory, source in ((BUNDLED_DIR, "bundled"), (USER_DIR, "user")):
        if not directory.is_dir():
            continue
        for child in sorted(directory.iterdir()):
            if not child.is_dir():
                continue
            skill = _parse(child, source)
            if skill:
                found[skill.name] = skill  # a user skill may override a bundled one by name
    return found


def reload_skills() -> None:
    _load.cache_clear()


def all_skills() -> list[Skill]:
    return list(_load().values())


def get_skill(name: str) -> Skill | None:
    return _load().get(name)


def skills_index(names: list[str] | None = None) -> str:
    """The compact list that goes in the system prompt — names and one-liners only."""
    skills = [s for s in all_skills() if names is None or s.name in names]
    lines = []
    for skill in skills:
        extra = f" (ملفات إضافية: {', '.join(skill.files)})" if skill.files else ""
        lines.append(f"- {skill.name}: {skill.description}{extra}")
    return "\n".join(lines)
