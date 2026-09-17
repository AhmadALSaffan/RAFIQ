"""A design keeps every document the model writes, each with a name the preview switches to."""

import httpx
import pytest
from httpx import ASGITransport

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.core.chat_service import _sync_design
from rafiq_agent.core.designs import clean_name, extract_preview, extract_previews, merge_files
from rafiq_agent.main import app
from rafiq_agent.storage.db import SessionLocal, init_db
from rafiq_agent.storage.models import Chat, Design, LlmModel

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}


@pytest.fixture()
async def client():
    await init_db()
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def test_names_come_from_the_fence_the_comment_or_the_title():
    text = (
        "شرح\n```html\n<!-- file: dashboard -->\n<html><title>Dash</title></html>\n```\n"
        "و\n```html landing.html\n<html><title>Landing</title></html>\n```\n"
    )
    files = extract_previews(text, "متجر أحمد")
    assert [f["name"] for f in files] == ["dashboard", "landing"]
    assert "Dash" in files[0]["html"]


def test_a_single_document_is_named_after_the_design():
    files = extract_previews("```html\n<html>a</html>\n```", "متجر أحمد")
    assert [f["name"] for f in files] == ["متجر أحمد"]


def test_two_unnamed_documents_do_not_collide():
    files = extract_previews("```html\n<html>1</html>\n```\n```html\n<html>2</html>\n```", "d")
    assert [f["name"] for f in files] == ["d", "d-2"]


def test_the_later_block_wins_when_a_name_repeats():
    files = extract_previews("```html x\n<html>old</html>\n```\n```html x\n<html>new</html>\n```", "d")
    assert len(files) == 1 and "new" in files[0]["html"]


def test_clean_name_drops_the_extension_and_path_characters():
    assert clean_name("landing.html") == "landing"
    assert clean_name('"home.htm"') == "home"
    assert clean_name("a/b<c>.html") == "abc"
    assert clean_name("لوحة التحكم") == "لوحة التحكم"


def test_merge_keeps_a_documents_place_and_appends_new_ones():
    saved = [{"name": "home", "html": "old-home"}, {"name": "about", "html": "about"}]
    merged = merge_files(saved, [{"name": "home", "html": "new-home"}, {"name": "pricing", "html": "pricing"}])
    assert [f["name"] for f in merged] == ["home", "about", "pricing"]
    assert merged[0]["html"] == "new-home"


def test_extract_preview_still_returns_the_last_block():
    assert extract_preview("```html\n<a>1</a>\n```\n```html\n<b>2</b>\n```") == "<b>2</b>"
    assert extract_preview("no html here") is None


async def test_a_reply_with_two_documents_becomes_two_files_on_disk(client, tmp_path):
    async with SessionLocal() as session:
        model = LlmModel(name="T", provider="custom", model_id="t", base_url="http://127.0.0.1:1")
        session.add(model)
        await session.flush()
        chat = Chat(title="تصميم", model_id=model.id, mode="design")
        session.add(chat)
        await session.flush()
        design = Design(title="متجر", chat_id=chat.id, model_id=model.id, working_dir=str(tmp_path))
        session.add(design)
        await session.commit()
        design_id = design.id

        await _sync_design(
            session,
            chat.id,
            "القرارات\n```html\n<html>home</html>\n```\n```html dashboard\n<html>dash</html>\n```",
        )
        await session.commit()

    async with SessionLocal() as session:
        saved = await session.get(Design, design_id)
        assert [f["name"] for f in saved.files] == ["متجر", "dashboard"]
        assert saved.preview_html == "<html>dash</html>"  # the preview opens on the newest
        assert saved.status == "ready"
        assert (tmp_path / "متجر.html").read_text(encoding="utf-8") == "<html>home</html>"
        assert (tmp_path / "dashboard.html").read_text(encoding="utf-8") == "<html>dash</html>"
        assert saved.spec.startswith("القرارات")

    # A later reply that only touches one document leaves the other alone.
    async with SessionLocal() as session:
        await _sync_design(session, (await session.get(Design, design_id)).chat_id, "```html dashboard\n<html>dash-2</html>\n```")
        await session.commit()
    async with SessionLocal() as session:
        saved = await session.get(Design, design_id)
        assert [(f["name"], f["html"]) for f in saved.files] == [("متجر", "<html>home</html>"), ("dashboard", "<html>dash-2</html>")]

    out = (await client.get(f"/designs/{design_id}", headers=AUTH)).json()
    assert [f["name"] for f in out["files"]] == ["متجر", "dashboard"]
    assert out["files"][1]["path"].endswith("dashboard.html")


async def test_an_older_design_still_shows_its_one_document(client):
    async with SessionLocal() as session:
        model = LlmModel(name="T2", provider="custom", model_id="t", base_url="http://127.0.0.1:1")
        session.add(model)
        await session.flush()
        chat = Chat(title="c", model_id=model.id, mode="design")
        session.add(chat)
        await session.flush()
        design = Design(title="قديم", chat_id=chat.id, model_id=model.id, preview_html="<html>old</html>")
        session.add(design)
        await session.commit()
        design_id = design.id

    out = (await client.get(f"/designs/{design_id}", headers=AUTH)).json()
    assert [(f["name"], f["html"]) for f in out["files"]] == [("قديم", "<html>old</html>")]


# ── What the preview can open ─────────────────────────────────────────────────────────


async def _design_with_folder(folder) -> str:
    async with SessionLocal() as session:
        model = LlmModel(name="T3", provider="custom", model_id="t", base_url="http://127.0.0.1:1")
        session.add(model)
        await session.flush()
        chat = Chat(title="c", model_id=model.id, mode="design")
        session.add(chat)
        await session.flush()
        design = Design(title="متجر", chat_id=chat.id, model_id=model.id, working_dir=str(folder))
        session.add(design)
        await session.commit()
        return design.id


async def test_documents_list_the_chat_documents_then_the_folders_html_files(client, tmp_path):
    design_id = await _design_with_folder(tmp_path)
    async with SessionLocal() as session:
        await _sync_design(session, (await session.get(Design, design_id)).chat_id, "```html\n<html>home</html>\n```")
        await session.commit()
    # Something the model wrote with the filesystem tool instead of the conversation.
    (tmp_path / "pricing.html").write_text("<html>pricing</html>", encoding="utf-8")
    (tmp_path / "notes.txt").write_text("not html", encoding="utf-8")

    documents = (await client.get(f"/designs/{design_id}/documents", headers=AUTH)).json()
    assert [(d["name"], d["source"]) for d in documents] == [("متجر", "chat"), ("pricing", "folder")]
    assert documents[1]["size"] == len("<html>pricing</html>")

    read = await client.get(f"/designs/{design_id}/documents/read", params={"path": documents[1]["path"]}, headers=AUTH)
    assert read.status_code == 200 and read.json()["html"] == "<html>pricing</html>"


async def test_reading_outside_the_design_folder_is_refused(client, tmp_path):
    design_id = await _design_with_folder(tmp_path / "inside")
    (tmp_path / "inside").mkdir()
    (tmp_path / "secret.html").write_text("<html>secret</html>", encoding="utf-8")
    (tmp_path / "inside" / "notes.md").write_text("# notes", encoding="utf-8")

    for path in (str(tmp_path / "secret.html"), str(tmp_path / "inside" / "notes.md")):
        answer = await client.get(f"/designs/{design_id}/documents/read", params={"path": path}, headers=AUTH)
        assert answer.status_code == 400


async def test_a_document_saved_from_the_chat_is_not_listed_twice(client, tmp_path):
    design_id = await _design_with_folder(tmp_path)
    async with SessionLocal() as session:
        await _sync_design(session, (await session.get(Design, design_id)).chat_id, "```html\n<html>home</html>\n```")
        await session.commit()
    assert (tmp_path / "متجر.html").is_file()  # the chat document was written to the folder
    documents = (await client.get(f"/designs/{design_id}/documents", headers=AUTH)).json()
    assert [d["source"] for d in documents] == ["chat"]
