"""The chat's side panel opens the files the model wrote: text as text, the rest raw."""

import httpx
import pytest
from httpx import ASGITransport
from PIL import Image

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.main import app

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}


@pytest.fixture()
async def client():
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def test_each_kind_of_file_previews_the_right_way(client, tmp_path):
    (tmp_path / "site").mkdir()
    (tmp_path / "site" / "index.html").write_text("<h1>أهلا</h1>", encoding="utf-8")
    (tmp_path / "notes.md").write_text("# ملاحظات", encoding="utf-8")
    (tmp_path / "app.py").write_text("print('hi')\n", encoding="utf-8")
    (tmp_path / "data.bin").write_bytes(b"\x00\x01\x02")
    Image.new("RGB", (4, 4)).save(tmp_path / "shot.png")

    async def kind(path):
        r = await client.get("/files/preview", params={"dir": str(tmp_path), "path": path}, headers=AUTH)
        assert r.status_code == 200, r.text
        return r.json()

    html = await kind("site/index.html")
    assert html["kind"] == "html" and "أهلا" in html["text"]
    assert (await kind("notes.md"))["kind"] == "markdown"
    assert (await kind("app.py"))["text"] == "print('hi')\n"
    assert (await kind("data.bin"))["kind"] == "binary"
    image = await kind("shot.png")
    assert image["kind"] == "image" and "text" not in image


async def test_raw_files_need_the_token_and_stay_inside_the_folder(client, tmp_path):
    (tmp_path / "a.txt").write_text("hello", encoding="utf-8")
    params = {"dir": str(tmp_path), "path": "a.txt"}
    assert (await client.get("/files/raw", params={**params, "token": "nope"})).status_code == 401
    r = await client.get("/files/raw", params={**params, "token": AUTH_TOKEN})
    assert r.status_code == 200 and r.text == "hello"
    outside = await client.get("/files/raw", params={"dir": str(tmp_path), "path": "../secret.txt", "token": AUTH_TOKEN})
    assert outside.status_code == 400
    missing = await client.get("/files/preview", params={"dir": str(tmp_path), "path": "nope.txt"}, headers=AUTH)
    assert missing.status_code == 404
