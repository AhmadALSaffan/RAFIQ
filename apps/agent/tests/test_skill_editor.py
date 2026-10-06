"""Writing a skill inside the app: the check catches what would break it, the files stay inside
the skill folder, bundled skills are copied before they're edited, and a saved skill is one
the model can read straight away."""

import shutil

import pytest
from httpx import ASGITransport, AsyncClient

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.main import app
from rafiq_agent.skills import editor
from rafiq_agent.skills.registry import USER_DIR, get_skill, reload_skills
from rafiq_agent.tools.skills import SkillReadTool

GOOD = """---
name: release-notes
description: Write release notes from the commits since the last tag, grouped by what users notice.
commands:
  - name: notes
    description: Draft the notes
    prompt: Write the release notes for the current branch.
---

# Release notes

Group changes by what a user would notice. One line each.
"""


@pytest.fixture(autouse=True)
def _clean_user_skills():
    shutil.rmtree(USER_DIR, ignore_errors=True)
    reload_skills()
    yield
    shutil.rmtree(USER_DIR, ignore_errors=True)
    reload_skills()


@pytest.fixture()
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", headers={"Authorization": f"Bearer {AUTH_TOKEN}"}) as c:
        yield c


def test_a_good_skill_passes_and_its_parts_are_read():
    check = editor.check_skill(GOOD)
    assert check.ok
    assert check.name == "release-notes"
    assert check.commands == [("notes", "Draft the notes")]


@pytest.mark.parametrize(
    "text",
    [
        "# no header at all\n",
        "---\ndescription: a description long enough to be useful here\n---\n\nbody\n",
        "---\nname: x\n---\n\nbody\n",
        "---\nname: x\ndescription: a description long enough to be useful here\n---\n\n",
        "---\nname: x\ndescription: a description long enough to be useful here\ncommands:\n  - name: go\n---\n\nbody\n",
    ],
    ids=["no-header", "no-name", "no-description", "empty-body", "command-without-prompt"],
)
def test_what_would_break_a_skill_is_an_error(text):
    check = editor.check_skill(text)
    assert not check.ok
    assert check.errors[0].message


def test_advice_is_a_warning_not_an_error():
    check = editor.check_skill("---\nname: My Skill\ndescription: short\n---\n\nbody\n")
    assert check.ok
    assert len(check.warnings) == 2  # not a slug, description too short


async def test_a_new_skill_is_saved_and_the_model_can_read_it():
    skill = editor.create_skill(GOOD)
    assert skill.source == "user"
    assert (USER_DIR / "release-notes" / "SKILL.md").is_file()
    result = await SkillReadTool().run({"name": "release-notes"})
    assert result.ok and "Group changes" in result.output


def test_a_broken_skill_is_not_saved():
    with pytest.raises(editor.SkillEditError):
        editor.create_skill("---\nname: broken\n---\n\nbody\n")
    assert not (USER_DIR / "broken").exists()


def test_files_stay_inside_the_skill_folder():
    editor.create_skill(GOOD)
    for path in ("../escape.md", "commands/../../escape.md", "notes.txt", "/etc/passwd.md", "sub/dir/x.md"):
        with pytest.raises(editor.SkillEditError):
            editor.write_file("release-notes", path, "x")


def test_reference_files_and_commands_are_written_and_listed():
    editor.create_skill(GOOD)
    editor.write_file("release-notes", "STYLE.md", "# Style\nShort lines.")
    editor.write_file("release-notes", "commands/changelog.md", "# Update the changelog\nAdd today's entries.")
    skill = get_skill("release-notes")
    assert [f["path"] for f in editor.list_files(skill)] == ["SKILL.md", "STYLE.md", "commands/changelog.md"]
    assert {c.name for c in skill.commands} == {"notes", "changelog"}
    assert "STYLE.md" in skill.files


def test_saving_skill_md_with_an_error_is_refused():
    editor.create_skill(GOOD)
    with pytest.raises(editor.SkillEditError):
        editor.write_file("release-notes", "SKILL.md", "no header")
    assert get_skill("release-notes").read().startswith("---")


def test_renaming_in_the_header_keeps_the_same_folder():
    editor.create_skill(GOOD)
    renamed = editor.write_file("release-notes", "SKILL.md", GOOD.replace("name: release-notes", "name: notes-writer"))
    assert renamed.name == "notes-writer"
    assert get_skill("notes-writer").path.name == "release-notes"


def test_a_bundled_skill_is_copied_before_it_is_edited():
    with pytest.raises(editor.SkillEditError):
        editor.write_file("impeccable", "SKILL.md", GOOD)
    mine = editor.copy_skill("impeccable")
    assert mine.source == "user"
    assert get_skill("impeccable").source == "user"  # the user's version takes over
    assert "INIT.md" in mine.files


def test_skill_md_cannot_be_deleted_on_its_own():
    editor.create_skill(GOOD)
    with pytest.raises(editor.SkillEditError):
        editor.delete_file("release-notes", "SKILL.md")


async def test_the_api_checks_creates_edits_and_reads(client):
    check = (await client.post("/skills/check", json={"content": "no header"})).json()
    assert check["ok"] is False and check["errors"][0]["line"] == 1

    created = await client.post("/skills/create", json={"content": GOOD})
    assert created.status_code == 201 and created.json()["name"] == "release-notes"

    refused = await client.post("/skills/create", json={"content": GOOD})
    assert refused.status_code == 400  # same name twice

    saved = await client.put("/skills/release-notes/file", json={"path": "STYLE.md", "content": "# Style"})
    assert saved.status_code == 200 and "STYLE.md" in saved.json()["files"]

    files = (await client.get("/skills/release-notes/files")).json()
    assert [f["path"] for f in files] == ["SKILL.md", "STYLE.md"]

    whole = (await client.get("/skills/release-notes/file", params={"path": "SKILL.md"})).json()
    assert whole["content"] == GOOD

    escape = await client.put("/skills/release-notes/file", json={"path": "../x.md", "content": "x"})
    assert escape.status_code == 400

    gone = await client.delete("/skills/release-notes/file", params={"path": "STYLE.md"})
    assert gone.status_code == 204
