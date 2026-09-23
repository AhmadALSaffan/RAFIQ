"""Search inside chats: Arabic the way people write it, snippets in their own words."""

import httpx
import pytest
from httpx import ASGITransport
from sqlalchemy import delete

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.core import search
from rafiq_agent.main import app
from rafiq_agent.storage.db import SessionLocal, init_db
from rafiq_agent.storage.models import Chat, ChatMessage

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}


@pytest.fixture()
async def client():
    await init_db()
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture()
async def chats():
    """Chats made for one test, removed after it — the database is shared by the suite."""
    made: list[str] = []

    async def make(title: str, *messages: tuple[str, str], mode: str = "chat", workspace: str | None = None) -> str:
        async with SessionLocal() as session:
            chat = Chat(title=title, mode=mode, workspace_id=workspace)
            session.add(chat)
            await session.flush()
            for role, content in messages:
                session.add(ChatMessage(chat_id=chat.id, role=role, content=content))
            await session.commit()
            made.append(chat.id)
            return chat.id

    yield make
    async with SessionLocal() as session:
        await session.execute(delete(ChatMessage).where(ChatMessage.chat_id.in_(made)))
        await session.execute(delete(Chat).where(Chat.id.in_(made)))
        await session.commit()


async def _find(client, q: str, **params) -> list[dict]:
    r = await client.get("/chats/search", params={"q": q, **params}, headers=AUTH)
    assert r.status_code == 200, r.text
    return r.json()


# ── Folding ───────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("written", "searched"),
    [
        ("قرأتُ الكِتابَ كلّه", "كتاب"),  # harakat and shadda
        ("الكتاب", "كتاب"),  # the article
        ("بالكتاب", "الكتاب"),  # article after ب, searched with its own article
        ("وكتاب جديد", "كتاب"),  # a leading و
        ("كتابها على الطاولة", "كتاب"),  # an ending: prefix match
        ("أحمد وإسراء وآمنة", "احمد اسراء امنه"),  # hamza forms, ة
        ("مستشفى", "مستشفي"),  # ى
        ("جميـــل", "جميل"),  # tatweel
        ("٢٠٢٦", "2026"),  # Arabic-Indic digits
        ("Résumé draft", "resume"),  # Latin accents and case
        ("والدي", "والد"),  # «وال» here isn't an article: the word must still be found
        ("شو رأيك بكتاب جديد", "كتاب"),  # ب in front, no article
        ("كم بيكلّف السفر لإسطنبول", "اسطنبول"),  # ل in front, and a hamza
        ("وبكتاب", "كتاب"),  # و and ب
    ],
)
def test_words_are_found_however_they_were_written(written, searched):
    indexed = set(search._WORD.findall(search.index_text(written)))
    for forms in search.terms(searched):
        assert any(word.startswith(f) for word in indexed for f in forms), (written, searched, forms)


def test_a_search_word_is_never_cut_so_it_doesnt_find_the_wrong_words():
    # The index stores «كتاب» also as «تاب»; the search for «كتاب» must still not look for «تاب».
    assert search.terms("كتاب") == [["كتاب"]]
    indexed = set(search._WORD.findall(search.index_text("تابع الشغل")))
    assert not any(word.startswith("كتاب") for word in indexed)


def test_a_search_is_only_words_so_it_cant_break_the_index_syntax():
    expr = search.match_expression(search.terms('كتاب" OR * NEAR( hello'))
    assert expr.count('"') % 2 == 0 and "NEAR(" not in expr
    assert search.terms("  ؟!  ") == []


def test_the_snippet_is_the_original_text_with_the_words_marked():
    original = (
        "في البداية كان عندي سؤال طويل عن إعدادات التطبيق وكيف بتشتغل، وبعدين قرأتُ الكِتابَ "
        "كاملاً وأعطيتُه لأخوي لأنه بيحب يقرأ بالمساء، وبعدها حكينا عن الكتب التانية كمان."
    )
    text, marks = search.snippet(original, [f for g in search.terms("كتاب") for f in g])
    assert "الكِتابَ" in text  # harakat kept: it's the user's own writing
    assert [text[a:b] for a, b in marks][0] == "كِتاب"
    assert text.startswith("…")  # cut from the middle, and says so


def test_a_snippet_is_one_line():
    text, marks = search.snippet("سطر أول\n\nوفيه   كلمة   مهمة\nوسطر أخير", ["مهمه"])
    assert "\n" not in text and "  " not in text
    assert [text[a:b] for a, b in marks] == ["مهمة"]


# ── Through the API ───────────────────────────────────────────────────────────


async def test_a_word_inside_a_message_finds_its_chat(client, chats):
    found = await chats("خطة الأسبوع", ("user", "بدي أرتّب ملفات المشروع"), ("assistant", "رتّبت المِلفّات بمجلدات حسب النوع."))
    await chats("شي تاني", ("user", "مرحبا"))

    results = await _find(client, "الملفات")
    ids = [r["chat_id"] for r in results]
    assert found in ids
    hit = next(r for r in results if r["chat_id"] == found)
    assert hit["matches"] == 2 and hit["title_match"] is False
    snip = hit["snippet"]
    assert snip["text"] and [snip["text"][a:b] for a, b in snip["marks"]]


async def test_every_word_has_to_be_there(client, chats):
    both = await chats("أ", ("user", "بدي تقرير عن المبيعات الشهرية"))
    one = await chats("ب", ("user", "بدي تقرير عن الطقس"))
    ids = [r["chat_id"] for r in await _find(client, "تقرير مبيعات")]
    assert both in ids and one not in ids


async def test_titles_match_too_and_come_first(client, chats):
    by_title = await chats("ميزانية السفر", ("user", "مرحبا"))
    by_body = await chats("شي تاني", ("user", "خلينا نحكي عن ميزانية البيت"))
    results = await _find(client, "ميزانية")
    ids = [r["chat_id"] for r in results]
    assert ids.index(by_title) < ids.index(by_body)
    assert results[ids.index(by_title)]["title_match"] is True


async def test_new_and_deleted_messages_are_noticed_on_the_next_search(client, chats):
    chat_id = await chats("متابعة", ("user", "أول رسالة"))
    assert not await _find(client, "زرافة")

    async with SessionLocal() as session:
        session.add(ChatMessage(chat_id=chat_id, role="assistant", content="شفت زرافة بالحديقة"))
        await session.commit()
    assert [r["chat_id"] for r in await _find(client, "زرافة")] == [chat_id]

    async with SessionLocal() as session:
        await session.execute(delete(ChatMessage).where(ChatMessage.chat_id == chat_id))
        await session.commit()
    assert chat_id not in [r["chat_id"] for r in await _find(client, "زرافة")]


async def test_design_sessions_and_other_workspaces_stay_out(client, chats):
    design = await chats("تصميم", ("user", "صفحة هبوط للقهوة"), mode="design")
    other = await chats("مساحة تانية", ("user", "صفحة هبوط للقهوة"), workspace="ws-other")
    mine = await chats("مساحتي", ("user", "صفحة هبوط للقهوة"), workspace="ws-mine")

    everywhere = [r["chat_id"] for r in await _find(client, "قهوة")]
    assert design not in everywhere and {other, mine} <= set(everywhere)

    scoped = [r["chat_id"] for r in await _find(client, "قهوة", workspace_id="ws-mine")]
    assert scoped == [mine]


async def test_an_empty_or_one_letter_search_returns_nothing(client):
    assert await _find(client, "") == []
    assert await _find(client, "ب") == []


async def test_search_needs_the_token(client):
    assert (await client.get("/chats/search", params={"q": "x"})).status_code in (401, 403)
