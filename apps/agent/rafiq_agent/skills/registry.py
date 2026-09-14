"""Agent skills — long-form guidance the model reads on demand.

These are plain folders with a `SKILL.md` (YAML front matter + markdown) and optional
reference files next to it, the same shape Claude Code uses. Rafiq loads them itself and
hands them to the model through ordinary tool calls, so they work with **every** provider
(OpenAI, DeepSeek, Ollama, Anthropic…), not just the ones with a native skill system.

Users can drop their own folders into `<data dir>/skills` and they show up alongside the
bundled ones.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from rafiq_agent.config import DATA_DIR

BUNDLED_DIR = Path(__file__).parent / "bundled"
USER_DIR = DATA_DIR / "skills"
# Skills are long (one is 40KB+). Sending all of that back as a tool result blows up the
# context of smaller models and they answer with nothing at all, so trim hard.
MAX_SKILL_CHARS = 14_000

_FRONT_MATTER = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


@dataclass
class Skill:
    name: str
    description: str
    path: Path
    source: str  # "bundled" | "user"

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


def _parse(skill_dir: Path, source: str) -> Skill | None:
    doc = skill_dir / "SKILL.md"
    if not doc.is_file():
        return None
    head = _FRONT_MATTER.match(doc.read_text(encoding="utf-8"))
    name, description = skill_dir.name, ""
    if head:
        for line in head.group(1).splitlines():
            key, _, value = line.partition(":")
            key, value = key.strip().lower(), value.strip().strip("'\"")
            if key == "name" and value:
                name = value
            elif key == "description" and value:
                description = value
    return Skill(name=name, description=description, path=skill_dir, source=source)


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
