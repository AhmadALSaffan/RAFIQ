"""Skill tools — the provider-agnostic way a model reads Rafiq's bundled skills.

Any model that can call a function can use these, so the same guidance reaches GPT,
DeepSeek, a local Ollama model or Claude without depending on a vendor feature.
"""

from typing import Any

from rafiq_agent.skills.registry import all_skills, get_skill
from rafiq_agent.tools.base import Tool, ToolResult


class SkillListTool(Tool):
    name = "skill_list"
    category = "read_only"
    description = (
        "اعرض كل المهارات (skills) المتاحة مع وصف كل وحدة وملفاتها الإضافية. "
        "استخدمها لما تحتاج تعرف شو المتوفر قبل ما تقرأ مهارة."
    )
    parameters = {"type": "object", "properties": {}}

    async def run(self, args: dict[str, Any]) -> ToolResult:
        skills = all_skills()
        if not skills:
            return ToolResult(ok=True, output="ما في مهارات مثبّتة.")
        lines = []
        for skill in skills:
            files = f" | ملفات: {', '.join(skill.files)}" if skill.files else ""
            lines.append(f"{skill.name} — {skill.description}{files}")
        return ToolResult(ok=True, output="\n".join(lines))


class SkillReadTool(Tool):
    name = "skill_read"
    category = "read_only"
    description = (
        "اقرأ محتوى مهارة كامل (SKILL.md) أو أحد ملفاتها الإضافية. "
        "اقرأ المهارات المتعلقة بالشغلة قبل ما تبدأ، وارجعلها وقت المراجعة."
    )
    parameters = {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "اسم المهارة زي ما طلع من skill_list"},
            "file": {
                "type": "string",
                "description": "ملف إضافي داخل المهارة (اختياري) — مثلاً RECIPES.md",
            },
        },
        "required": ["name"],
    }

    async def run(self, args: dict[str, Any]) -> ToolResult:
        name = str(args.get("name") or "").strip()
        skill = get_skill(name)
        if not skill:
            available = ", ".join(s.name for s in all_skills())
            return ToolResult(ok=False, output=f"ما في مهارة اسمها «{name}». المتاح: {available}")
        try:
            return ToolResult(ok=True, output=skill.read(args.get("file") or None))
        except FileNotFoundError as exc:
            return ToolResult(ok=False, output=f"ما في ملف «{exc}» جوّا المهارة {name}.")


def skill_tools() -> list[Tool]:
    return [SkillListTool(), SkillReadTool()]
