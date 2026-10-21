"""The notes page: Markdown files in the user's notes folder, the model's note tools, and
notes named in a chat message."""

import base64
from pathlib import Path

import httpx
import pytest
from httpx import ASGITransport

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.core import notes
from rafiq_agent.main import app
from rafiq_agent.storage.db import init_db
from rafiq_agent.tools.notes import NoteCreateTool, NoteEditTool, NotesListTool

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}
PNG = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 32).decode()


@pytest.fixture()
async def client():
    await init_db()
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def test_paths_stay_in_the_folder_and_outside_files_are_only_markdown(tmp_path):
    root = tmp_path.resolve()
    assert notes.resolve(root, "work/plan.md") == root / "work" / "plan.md"
    with pytest.raises(notes.NoteError):
        notes.resolve(root, "../escape.md")
    outside = tmp_path.parent / "elsewhere.md"
    assert notes.resolve(root, str(outside)) == outside.resolve()
    with pytest.raises(notes.NoteError):
        notes.resolve(root, str(tmp_path.parent / "secret.txt.exe"))


def test_new_notes_never_overwrite_and_take_their_title(tmp_path):
    root = tmp_path.resolve()
    first = notes.create(root, "", "خطة: المشروع?")
    second = notes.create(root, "", "خطة: المشروع?")
    assert first.name == "خطة المشروع.md" and second.name == "خطة المشروع (2).md"
    assert first.read_text(encoding="utf-8").startswith("# خطة: المشروع?")
    assert notes.title_of("\n\n## أفكار React\nنص", "x") == "أفكار React"
    assert notes.excerpt_of("# خطة\n\n- [ ] ربط **الـ API** مع [الواجهة](x.md)\n", "خطة") == "ربط الـ API مع الواجهة"


def test_search_folds_arabic_spelling(tmp_path):
    root = tmp_path.resolve()
    notes.write(root / "a.md", "# اجتماع\nنحكي مع أسامة عن المدرسة")
    notes.write(root / "b.md", "# Other\nnothing here")
    hits = notes.search(root, "اسامه")
    assert [h.path for h in hits] == ["a.md"] and hits[0].line == 2
    assert [h.path for h in notes.search(root, "اجتماع")] == ["a.md"]


def test_trash_keeps_the_note_and_assets_stay_out_of_the_list(tmp_path):
    root = tmp_path.resolve()
    notes.write(root / "old.md", "# old")
    link = notes.save_image(root, "old.md", "shot one.png", PNG)
    assert link == "assets/shot-one.png" and (root / link).is_file()
    assert notes.image_file(root, "old.md", link) == (root / link).resolve()
    notes.trash(root, "old.md")
    names = [e.path for e in notes.tree(root)]
    assert names == [] and any((root / ".trash").iterdir())


def test_a_mentioned_note_rides_with_the_message(tmp_path):
    root = tmp_path.resolve()
    notes.write(root / "ideas" / "my app.md", "# تطبيقي\nفكرة أولى")
    text = notes.with_mentions("لخّص @note:ideas/my_app، لو سمحت", root)
    assert "فكرة أولى" in text and "`ideas/my app.md`" in text
    assert notes.with_mentions("بدون ملاحظات", root) == "بدون ملاحظات"


async def test_the_model_writes_new_notes_and_edits_with_a_diff(tmp_path):
    root = tmp_path.resolve()
    created = await NoteCreateTool(root).run({"title": "قائمة", "content": "# قائمة\n- حليب\n", "folder": "بيت"})
    assert created.ok and (root / "بيت" / "قائمة.md").is_file()
    listed = await NotesListTool(root).run({"query": "حليب"})
    assert "بيت/قائمة.md" in listed.output

    edit = NoteEditTool(root)
    args = {"path": "بيت/قائمة.md", "find": "- حليب", "replace": "- حليب\n- خبز"}
    preview = await edit.preview(args)
    assert preview and "+- خبز" in preview
    assert (await edit.run(args)).ok
    assert "- خبز" in (root / "بيت" / "قائمة.md").read_text(encoding="utf-8")
    missing = await edit.run({"path": "بيت/قائمة.md", "find": "قهوة", "replace": "شاي"})
    assert not missing.ok


async def test_notes_api_round_trip(client, monkeypatch, tmp_path):
    monkeypatch.setattr(notes, "default_root", lambda: tmp_path / "notes")
    made = await client.post("/notes/new", json={"title": "ملاحظة تجربة"}, headers=AUTH)
    assert made.status_code == 200, made.text
    path = made.json()["path"]

    opened = (await client.get("/notes/file", params={"path": path}, headers=AUTH)).json()
    saved = await client.put(
        "/notes/file", json={"path": path, "content": "# تجربة\nReact مع Tauri", "base_mtime": opened["mtime"]}, headers=AUTH
    )
    assert saved.status_code == 200
    stale = await client.put("/notes/file", json={"path": path, "content": "x", "base_mtime": 1.0}, headers=AUTH)
    assert stale.status_code == 409

    await client.post("/notes/pin", json={"path": path, "pinned": True}, headers=AUTH)
    moved = await client.post("/notes/move", json={"src": path, "dst": "شغل/تجربة"}, headers=AUTH)
    assert moved.json()["path"] == "شغل/تجربة.md"
    tree = (await client.get("/notes/tree", headers=AUTH)).json()
    assert tree["pinned"][0] == "شغل/تجربة.md"
    assert {i["path"] for i in tree["items"]} == {"شغل", "شغل/تجربة.md"}

    image = await client.post("/notes/image", json={"note": "شغل/تجربة.md", "name": "a.png", "data_url": PNG}, headers=AUTH)
    src = image.json()["src"]
    raw = await client.get("/notes/image", params={"note": "شغل/تجربة.md", "src": src, "token": AUTH_TOKEN})
    assert raw.status_code == 200 and raw.content.startswith(b"\x89PNG")
    assert (await client.get("/notes/image", params={"note": "شغل/تجربة.md", "src": src, "token": "no"})).status_code == 401

    word = tmp_path / "out" / "تجربة.docx"
    exported = await client.post("/notes/export", json={"path": "شغل/تجربة.md", "dest": str(word)}, headers=AUTH)
    assert exported.status_code == 200 and word.read_bytes()[:2] == b"PK"
    await client.post("/notes/pin", json={"path": "شغل/تجربة.md", "pinned": False}, headers=AUTH)
    assert Path(tree["root"]).name == "notes"
