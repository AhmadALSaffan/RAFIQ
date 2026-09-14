"""The skill registry is what makes the guidance work with every provider."""

import pytest

from rafiq_agent.skills.registry import MAX_SKILL_CHARS, all_skills, get_skill, skills_index
from rafiq_agent.tools.skills import SkillListTool, SkillReadTool


def test_bundled_skills_load_with_names_and_descriptions():
    skills = all_skills()
    assert len(skills) >= 10
    assert all(s.name and s.description for s in skills)


def test_impeccable_is_bundled_and_has_its_init_file():
    skill = get_skill("impeccable")
    assert skill is not None
    assert "INIT.md" in skill.files


def test_reading_a_skill_returns_its_markdown_within_the_cap():
    body = get_skill("impeccable").read()
    assert body.startswith("---")
    assert len(body) <= MAX_SKILL_CHARS + 200


def test_a_long_skill_is_trimmed_so_it_cannot_flood_the_context():
    longest = max(all_skills(), key=lambda s: len(s.read()))
    assert len(longest.read()) <= MAX_SKILL_CHARS + 200


def test_reading_outside_the_skill_folder_is_refused():
    with pytest.raises(FileNotFoundError):
        get_skill("impeccable").read("../../../config.py")


def test_index_is_one_line_per_skill():
    index = skills_index()
    assert index.count("\n") + 1 == len(all_skills())


async def test_skill_tools_answer_like_the_model_would_see_them():
    listing = await SkillListTool().run({})
    assert listing.ok and "impeccable" in listing.output

    read = await SkillReadTool().run({"name": "impeccable"})
    assert read.ok and "impeccable" in read.output

    missing = await SkillReadTool().run({"name": "nope"})
    assert not missing.ok and "impeccable" in missing.output  # tells the model what exists
