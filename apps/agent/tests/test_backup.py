"""Backing up and restoring: one file out, the same Rafiq back in — and never a secret."""

import json
import zipfile

import httpx
import pytest
from httpx import ASGITransport
from sqlalchemy import delete, select

from rafiq_agent.config import AUTH_TOKEN, DATA_DIR
from rafiq_agent.core import backup
from rafiq_agent.main import app
from rafiq_agent.storage.db import SessionLocal, init_db
from rafiq_agent.storage.models import Chat, ChatMessage, LlmModel
from rafiq_agent.storage.secrets import delete_api_key, store_api_key

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}
SECRET = "sk-rafiq-test-never-in-a-backup-7731"


@pytest.fixture()
async def client():
    await init_db()
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture()
def no_recover(monkeypatch):
    """The suite shares one task scheduler, and other tests leave tasks in it. So here it
    reports itself idle, and the restore's re-queueing of the backup's waiting tasks is
    recorded rather than run against other tests' leftovers."""
    from rafiq_agent.core.manager import manager

    calls: list[bool] = []

    async def recorded() -> None:
        calls.append(True)

    monkeypatch.setattr(manager, "recover", recorded)
    monkeypatch.setattr(manager, "busy", lambda: False)
    return calls


async def _chat(title: str) -> str:
    async with SessionLocal() as session:
        chat = Chat(title=title)
        session.add(chat)
        await session.flush()
        session.add(ChatMessage(chat_id=chat.id, role="user", content=f"{title} — مرحبا"))
        await session.commit()
        return chat.id


async def _title(chat_id: str) -> str | None:
    async with SessionLocal() as session:
        chat = await session.get(Chat, chat_id)
        return chat.title if chat else None


def _skill(name: str) -> None:
    folder = DATA_DIR / "skills" / name
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "SKILL.md").write_text(f"---\nname: {name}\ndescription: test\n---\nbody", encoding="utf-8")


# ── The file itself ───────────────────────────────────────────────────────────


async def test_a_backup_holds_the_database_the_skills_and_the_attachments(client, tmp_path):
    chat_id = await _chat("نسخة")
    _skill("backup-test-skill")
    (DATA_DIR / "attachments").mkdir(exist_ok=True)
    (DATA_DIR / "attachments" / "backup-test.txt").write_text("مرفق", encoding="utf-8")

    manifest = backup.write_backup(tmp_path / "b.zip", "9.9.9")
    with zipfile.ZipFile(tmp_path / "b.zip") as zf:
        names = set(zf.namelist())
        assert {"manifest.json", "rafiq.db"} <= names
        assert "skills/backup-test-skill/SKILL.md" in names
        assert "attachments/backup-test.txt" in names
        # Nothing from the data folder that is a secret or rebuilt on its own.
        assert not any(n.startswith(("browser-profile/", "copilot/", "logs/", "worktrees/")) for n in names)
        assert "agent.json" not in names
        assert json.loads(zf.read("manifest.json"))["app"] == "rafiq"

    assert manifest["version"] == "9.9.9" and manifest["format"] == backup.FORMAT
    assert manifest["counts"]["chats"] >= 1 and manifest["counts"]["skills"] >= 1
    assert await _title(chat_id) == "نسخة"


async def test_a_backup_never_carries_a_secret(client, tmp_path):
    ref = store_api_key(SECRET)
    async with SessionLocal() as session:
        model = LlmModel(name="secret-test", provider="openai", model_id="gpt-x", api_key_ref=ref)
        session.add(model)
        await session.commit()
        model_id = model.id
    try:
        backup.write_backup(tmp_path / "b.zip", "0")
        with zipfile.ZipFile(tmp_path / "b.zip") as zf:
            for name in zf.namelist():
                assert SECRET.encode() not in zf.read(name), name
            # The reference travels (so the same computer finds its key again); the key doesn't.
            assert ref.encode() in zf.read("rafiq.db")
    finally:
        delete_api_key(ref)
        async with SessionLocal() as session:
            await session.execute(delete(LlmModel).where(LlmModel.id == model_id))
            await session.commit()


# ── Coming back ───────────────────────────────────────────────────────────────


async def test_restoring_brings_everything_back_and_keeps_a_copy_of_what_it_replaced(client, tmp_path):
    kept = await _chat("قبل")
    _skill("restore-test-skill")
    backup.write_backup(tmp_path / "b.zip", "0")

    # Life goes on after the backup: a chat is renamed, one is added, a skill disappears.
    async with SessionLocal() as session:
        (await session.get(Chat, kept)).title = "بعد"
        await session.commit()
    added = await _chat("جديدة")
    import shutil

    shutil.rmtree(DATA_DIR / "skills" / "restore-test-skill")

    from rafiq_agent.storage.db import engine

    await engine.dispose()
    result = backup.restore_backup(tmp_path / "b.zip", "0")
    await init_db()

    assert await _title(kept) == "قبل"
    assert await _title(added) is None  # it didn't exist when the backup was taken
    assert (DATA_DIR / "skills" / "restore-test-skill" / "SKILL.md").is_file()

    # The safety copy is the state that was replaced — the renamed chat and the new one.
    safety = backup.read_manifest(result["safety_copy"])
    assert safety["app"] == "rafiq"
    with zipfile.ZipFile(result["safety_copy"]) as zf:
        zf.extract("rafiq.db", tmp_path / "safety")
    import sqlite3

    con = sqlite3.connect(tmp_path / "safety" / "rafiq.db")
    try:
        titles = {r[0] for r in con.execute("SELECT title FROM chats WHERE id IN (?, ?)", (kept, added))}
    finally:
        con.close()
    assert titles == {"بعد", "جديدة"}


@pytest.mark.parametrize(
    "members",
    [
        {"notes.txt": "hello"},  # not a backup at all
        {"manifest.json": json.dumps({"app": "other", "format": 1}), "rafiq.db": ""},
        {"manifest.json": json.dumps({"app": "rafiq", "format": 99}), "rafiq.db": ""},  # from the future
        {"manifest.json": json.dumps({"app": "rafiq", "format": 1}), "rafiq.db": "", "../evil.txt": "x"},
        {"manifest.json": json.dumps({"app": "rafiq", "format": 1}), "rafiq.db": "", "skills/../../x": "x"},
    ],
)
def test_a_file_that_isnt_a_safe_backup_is_refused(tmp_path, members):
    archive = tmp_path / "bad.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        for name, data in members.items():
            zf.writestr(name, data)
    with pytest.raises(backup.BackupError):
        backup.read_manifest(archive)


def test_a_damaged_database_is_refused_before_anything_changes(tmp_path):
    archive = tmp_path / "broken.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("manifest.json", json.dumps({"app": "rafiq", "format": 1}))
        zf.writestr("rafiq.db", b"this is not sqlite" * 100)
    before = sorted(backup.SAFETY_DIR.glob("*.zip")) if backup.SAFETY_DIR.is_dir() else []
    with pytest.raises(backup.BackupError):
        backup.restore_backup(archive, "0")
    after = sorted(backup.SAFETY_DIR.glob("*.zip")) if backup.SAFETY_DIR.is_dir() else []
    assert after == before  # refused before the safety copy, let alone the swap


def test_not_a_zip_at_all_is_refused(tmp_path):
    (tmp_path / "x.zip").write_bytes(b"nope")
    with pytest.raises(backup.BackupError):
        backup.read_manifest(tmp_path / "x.zip")


# ── Through the API, the way the app does it ──────────────────────────────────


async def test_save_inspect_and_restore_through_the_api(client, tmp_path, no_recover):
    chat_id = await _chat("عبر الواجهة")
    target = tmp_path / "from-the-app"  # no extension: it becomes a .zip

    saved = (await client.post("/backup/save", json={"path": str(target)}, headers=AUTH)).json()
    assert saved["path"].endswith(".zip") and saved["manifest"]["counts"]["chats"] >= 1

    looked = (await client.post("/backup/inspect", json={"path": saved["path"]}, headers=AUTH)).json()
    assert looked["counts"] == saved["manifest"]["counts"]

    async with SessionLocal() as session:
        await session.execute(delete(Chat).where(Chat.id == chat_id))
        await session.commit()
    assert await _title(chat_id) is None

    r = await client.post("/backup/restore-file", json={"path": saved["path"]}, headers=AUTH)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["safety_copy"].endswith(".zip") and "missing_secrets" in out
    assert await _title(chat_id) == "عبر الواجهة"
    assert no_recover == [True]  # waiting tasks from the backup were put back in line


async def test_download_and_upload_for_the_browser_build(client, no_recover):
    chat_id = await _chat("تنزيل")
    r = await client.get("/backup", headers=AUTH)
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    assert "rafiq-backup-" in r.headers["content-disposition"]
    data = r.content

    async with SessionLocal() as session:
        await session.execute(delete(Chat).where(Chat.id == chat_id))
        await session.commit()

    r = await client.post("/backup/restore", files={"file": ("b.zip", data, "application/zip")}, headers=AUTH)
    assert r.status_code == 200, r.text
    assert await _title(chat_id) == "تنزيل"


async def test_on_a_new_computer_the_keys_are_counted_as_missing(client, tmp_path, no_recover):
    ref = store_api_key(SECRET)
    async with SessionLocal() as session:
        model = LlmModel(name="moving", provider="openai", model_id="gpt-x", api_key_ref=ref)
        session.add(model)
        await session.commit()
        model_id = model.id
    try:
        backup.write_backup(tmp_path / "b.zip", "0")
        delete_api_key(ref)  # the new computer's credential store has never seen this key
        r = await client.post("/backup/restore-file", json={"path": str(tmp_path / "b.zip")}, headers=AUTH)
        assert r.status_code == 200, r.text
        assert r.json()["missing_secrets"] >= 1
        async with SessionLocal() as session:  # the model itself came back, keyless
            assert (await session.execute(select(LlmModel).where(LlmModel.id == model_id))).scalar_one()
    finally:
        delete_api_key(ref)
        async with SessionLocal() as session:
            await session.execute(delete(LlmModel).where(LlmModel.id == model_id))
            await session.commit()


async def test_restoring_waits_for_nothing_to_be_running(client, tmp_path):
    from rafiq_agent.core import chat_service

    backup.write_backup(tmp_path / "b.zip", "0")
    chat_service._turns["busy-chat"] = object()  # a reply is being written
    try:
        r = await client.post("/backup/restore-file", json={"path": str(tmp_path / "b.zip")}, headers=AUTH)
        assert r.status_code == 409
    finally:
        chat_service._turns.pop("busy-chat", None)


async def test_a_missing_file_is_a_404_not_a_crash(client, tmp_path):
    r = await client.post("/backup/inspect", json={"path": str(tmp_path / "nowhere.zip")}, headers=AUTH)
    assert r.status_code == 404
