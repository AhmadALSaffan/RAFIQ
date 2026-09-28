"""The prompt library: text you keep retyping, with {{variables}} for the parts that change."""

import httpx
import pytest
from httpx import ASGITransport

from rafiq_agent.api.automation import prompt_variables
from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.main import app
from rafiq_agent.storage.db import init_db

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}


@pytest.fixture()
async def client():
    await init_db()
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture()
async def made(client):
    ids: list[str] = []
    yield ids
    for prompt_id in ids:
        await client.delete(f"/prompts/{prompt_id}", headers=AUTH)


async def _create(client, made, title: str, body: str) -> dict:
    r = await client.post("/prompts", json={"title": title, "body": body}, headers=AUTH)
    assert r.status_code == 201, r.text
    made.append(r.json()["id"])
    return r.json()


def test_variables_are_found_once_in_order_arabic_included():
    body = "راجع {{الملف}} وقارنه مع {{ نسخة قديمة }}، وبعدين رجّع {{الملف}} لـ {{client_name}}."
    assert prompt_variables(body) == ["الملف", "نسخة قديمة", "client_name"]
    assert prompt_variables("ما في متغيرات هون، ولا {واحد} ولا {{}} ولا {{   }}") == []


async def test_a_prompt_is_saved_listed_edited_and_deleted(client, made):
    created = await _create(client, made, "مراجعة كود", "راجع {{الملف}} وقلّي شو ممكن يتحسّن")
    assert created["variables"] == ["الملف"] and created["uses"] == 0

    listed = (await client.get("/prompts", headers=AUTH)).json()
    assert created["id"] in [p["id"] for p in listed]

    edited = await client.patch(
        f"/prompts/{created['id']}", json={"body": "راجع {{الملف}} بلغة {{اللغة}}"}, headers=AUTH
    )
    assert edited.status_code == 200
    assert edited.json()["variables"] == ["الملف", "اللغة"] and edited.json()["title"] == "مراجعة كود"

    assert (await client.delete(f"/prompts/{created['id']}", headers=AUTH)).status_code == 204
    assert (await client.patch(f"/prompts/{created['id']}", json={"title": "x"}, headers=AUTH)).status_code == 404
    made.remove(created["id"])


async def test_the_most_used_come_first(client, made):
    rare = await _create(client, made, "نادر", "نص نادر")
    often = await _create(client, made, "كتير", "نص بستعمله كتير")
    for _ in range(3):
        r = await client.post(f"/prompts/{often['id']}/use", headers=AUTH)
        assert r.status_code == 200
    assert r.json()["uses"] == 3 and r.json()["last_used_at"]

    ids = [p["id"] for p in (await client.get("/prompts", headers=AUTH)).json()]
    assert ids.index(often["id"]) < ids.index(rare["id"])


async def test_empty_or_oversized_prompts_are_refused(client):
    assert (await client.post("/prompts", json={"title": "", "body": "x"}, headers=AUTH)).status_code == 422
    assert (await client.post("/prompts", json={"title": "x", "body": ""}, headers=AUTH)).status_code == 422
    assert (await client.post("/prompts", json={"title": "x", "body": "a" * 20_001}, headers=AUTH)).status_code == 422
