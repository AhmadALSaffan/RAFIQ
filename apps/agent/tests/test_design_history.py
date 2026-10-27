"""Design history: every version of a document is rebuilt from the replies that wrote it,
any two can be compared, and an old one can be made current again."""

from datetime import UTC, datetime, timedelta

import httpx
import pytest
from httpx import ASGITransport
from sqlalchemy import delete

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.core.designs import diff, line_changes
from rafiq_agent.main import app
from rafiq_agent.storage.db import SessionLocal, init_db
from rafiq_agent.storage.models import Chat, ChatMessage, Design

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}

PAGE_V1 = "<html>\n<body>\n<h1>Shop</h1>\n<p>Welcome</p>\n</body>\n</html>"
PAGE_V2 = "<html>\n<body>\n<h1>Shop</h1>\n<p>Welcome back</p>\n<button>Buy</button>\n</body>\n</html>"
CART_V1 = "<!-- file: cart -->\n<html>\n<body>Cart</body>\n</html>"


def _reply(text: str, *blocks: tuple[str, str]) -> str:
    return text + "\n\n" + "\n\n".join(f"```html {name}\n{html}\n```" for name, html in blocks)


@pytest.fixture()
async def client():
    await init_db()
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture()
async def design():
    """A design whose chat wrote the home page twice (plus once word for word), and a cart."""
    start = datetime.now(UTC) - timedelta(hours=1)
    async with SessionLocal() as session:
        chat = Chat(title="متجر", mode="design")
        session.add(chat)
        await session.flush()
        row = Design(title="متجر", chat_id=chat.id, files=[{"name": "home", "html": PAGE_V2}], preview_html=PAGE_V2)
        session.add(row)
        replies = [
            ("user", "صمم الصفحة"),
            ("assistant", _reply("## نسخة أولى\nواجهة بسيطة", ("home", PAGE_V1))),
            ("user", "ضيف زر شراء"),
            ("assistant", _reply("ضفت زر الشراء وغيرت الترحيب", ("home", PAGE_V2), ("cart", CART_V1))),
            ("assistant", _reply("نفس الشي", ("home", PAGE_V2))),  # unchanged: not a version
        ]
        for i, (role, content) in enumerate(replies):
            session.add(ChatMessage(chat_id=chat.id, role=role, content=content, created_at=start + timedelta(minutes=i)))
        await session.commit()
        ids = {"design": row.id, "chat": chat.id}
    yield ids
    async with SessionLocal() as session:
        await session.execute(delete(ChatMessage).where(ChatMessage.chat_id == ids["chat"]))
        await session.execute(delete(Design).where(Design.id == ids["design"]))
        await session.execute(delete(Chat).where(Chat.id == ids["chat"]))
        await session.commit()


def test_changes_are_counted_and_long_unchanged_stretches_folded():
    assert line_changes(PAGE_V1, PAGE_V2) == (2, 1)
    old = "\n".join(f"line {i}" for i in range(30))
    new = old.replace("line 15", "line fifteen")
    runs = diff(old, new)
    kinds = [r["kind"] for r in runs]
    assert kinds == ["skip", "same", "del", "add", "same", "skip"]
    assert runs[0]["count"] == 12 and runs[2]["lines"] == ["line 15"] and runs[3]["lines"] == ["line fifteen"]


async def test_versions_are_listed_newest_first_per_document(client, design):
    r = await client.get(f"/designs/{design['design']}/versions", headers=AUTH)
    assert r.status_code == 200, r.text
    found = [(v["document"], v["number"], v["added"], v["removed"]) for v in r.json()]
    assert found == [("cart", 1, 4, 0), ("home", 2, 2, 1), ("home", 1, 6, 0)]
    assert r.json()[1]["summary"] == "ضفت زر الشراء وغيرت الترحيب"
    assert r.json()[2]["summary"] == "نسخة أولى"
    assert "html" not in r.json()[0]


async def test_two_versions_compare_and_an_old_one_comes_back(client, design):
    versions = (await client.get(f"/designs/{design['design']}/versions", headers=AUTH)).json()
    home_v2, home_v1 = versions[1]["id"], versions[2]["id"]

    r = await client.get(f"/designs/{design['design']}/compare", params={"a": home_v1, "b": home_v2}, headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert (body["added"], body["removed"]) == (2, 1)
    assert {"kind": "add", "lines": ["<p>Welcome back</p>", "<button>Buy</button>"], "start": 4} in body["runs"]

    one = (await client.get(f"/designs/{design['design']}/versions/{home_v1}", headers=AUTH)).json()
    assert one["html"] == PAGE_V1

    restored = (await client.post(f"/designs/{design['design']}/versions/{home_v1}/restore", headers=AUTH)).json()
    assert restored["preview_html"] == PAGE_V1
    assert next(f for f in restored["files"] if f["name"] == "home")["html"] == PAGE_V1
    # Restoring adds nothing to the history and removes nothing from it.
    assert len((await client.get(f"/designs/{design['design']}/versions", headers=AUTH)).json()) == 3


async def test_unknown_versions_and_designs_are_404(client, design):
    assert (await client.get(f"/designs/{design['design']}/versions/nope.0", headers=AUTH)).status_code == 404
    assert (await client.get("/designs/nope/versions", headers=AUTH)).status_code == 404


async def test_a_reply_is_undone_document_by_document(client, design):
    versions = (await client.get(f"/designs/{design['design']}/versions", headers=AUTH)).json()
    second = next(v["message_id"] for v in versions if v["document"] == "cart")
    r = await client.post(f"/designs/{design['design']}/messages/{second}/undo", headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    # home goes back to its first version; the cart was new in that reply, so it stays
    assert body["restored"] == ["home"] and body["skipped"] == ["cart"]
    home = next(f for f in body["design"]["files"] if f["name"] == "home")
    assert home["html"] == PAGE_V1
    # a reply that wrote nothing can't be undone
    first_user = "nope"
    assert (await client.post(f"/designs/{design['design']}/messages/{first_user}/undo", headers=AUTH)).status_code == 404


async def test_variants_are_asked_for_then_one_is_kept(client, design):
    async with SessionLocal() as session:
        row = await session.get(Design, design["design"])
        row.brief = {"kind": "موقع", "art": "poster"}
        await session.commit()
    r = await client.post(f"/designs/{design['design']}/variants", headers=AUTH)
    assert r.status_code == 200
    variants = r.json()["design"]["variants"]
    keys = [v["key"] for v in variants]
    assert len(set(keys)) == 3 and "poster" not in keys
    assert all(v["name"] in r.json()["message"] for v in variants)

    # not written yet: nothing to choose
    assert (await client.post(f"/designs/{design['design']}/variants/{keys[0]}/choose", headers=AUTH)).status_code == 404
    async with SessionLocal() as session:
        row = await session.get(Design, design["design"])
        row.files = [*row.files, *({"name": v["document"], "html": f"<p>{v['key']}</p>"} for v in variants)]
        await session.commit()
    kept = (await client.post(f"/designs/{design['design']}/variants/{keys[1]}/choose", headers=AUTH)).json()
    assert kept["variants"] == []
    assert kept["brief"]["art"] == keys[1]
    assert next(f for f in kept["files"] if f["name"] == "home")["html"] == f"<p>{keys[1]}</p>"


async def test_apps_get_no_variants(client, design):
    async with SessionLocal() as session:
        row = await session.get(Design, design["design"])
        row.brief = {"kind": "لوحة تحكم"}
        await session.commit()
    assert (await client.post(f"/designs/{design['design']}/variants", headers=AUTH)).status_code == 400

