"""Per-agent knowledge bases (core/agent_knowledge.py): passages with lines and headings,
refresh, access per agent, retrieval with and without embeddings, citations. No network."""

import asyncio
import contextlib
import hashlib
import math
import os
import time

import httpx
import pytest
from httpx import ASGITransport

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.core import agent_knowledge as kb
from rafiq_agent.core import embeddings
from rafiq_agent.storage.db import SessionLocal, init_db
from rafiq_agent.storage.models import LlmModel
from rafiq_agent.tools.agent_knowledge import KnowledgeBaseSearchTool

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}

GUIDE = """# Rafiq guide

Rafiq is a desktop assistant.

## Installing

Download the setup file and run it.
The installer needs Windows 10 or newer.

## Refund policy

Subscriptions can be refunded within 14 days of the first payment.
After 14 days no refund is given.

```md
# not a heading inside a fence
```
"""


@pytest.fixture(autouse=True)
def words_only(monkeypatch):
    """No embeddings unless a test brings its own."""

    async def none():
        return None

    monkeypatch.setattr(embeddings, "current", none)
    for path in (kb.db_path(),):
        if path.exists():
            path.unlink()
    kb._jobs.clear()


def folder(tmp_path, files: dict[str, str]):
    for rel, text in files.items():
        path = tmp_path / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return tmp_path


def attach(agent: str, root) -> str:
    source = kb.attach(agent, str(root))  # no running loop: indexed below, by hand
    asyncio.run(kb.index(source["id"]))
    return source["id"]


def test_markdown_passages_keep_headings_and_lines():
    pieces = kb.split(GUIDE, markdown=True)
    by_heading = {p.heading: p for p in pieces}
    refund = by_heading["Rafiq guide › Refund policy"]
    lines = GUIDE.splitlines()
    assert lines[refund.line_start - 1] == "## Refund policy"
    assert "14 days" in refund.text
    assert "Installing" in by_heading["Rafiq guide › Installing"].heading
    # A "#" inside a code fence is not a heading.
    assert not any(p.heading and "not a heading" in p.heading for p in pieces)


def test_long_text_is_cut_at_blank_lines_with_exact_lines():
    text = "\n\n".join(f"Paragraph {i} " + "word " * 60 for i in range(12))
    pieces = kb.split(text, markdown=False)
    assert len(pieces) > 1
    lines = text.splitlines()
    for piece in pieces:
        assert len(piece.text) <= kb.MAX_PASSAGE
        assert "\n".join(lines[piece.line_start - 1 : piece.line_end]) == piece.text


def test_index_records_source_path_heading_and_lines(tmp_path):
    root = folder(tmp_path / "docs", {"guide.md": GUIDE, "notes/plain.txt": "Opening hours: 9 to 5.\n", "image.png": "x"})
    attach("agent-a", root)
    found = asyncio.run(kb.retrieve("agent-a", "refund", ["refund", "refunded"]))
    assert found.reason == "found"
    top = found.passages[0]
    assert (top.rel_path, top.heading) == ("guide.md", "Rafiq guide › Refund policy")
    assert top.line_start == GUIDE.splitlines().index("## Refund policy") + 1
    assert kb.CITATION.fullmatch(top.id)
    sources = kb.sources_for("agent-a")
    assert sources[0]["files"] == 2 and sources[0]["status"] == "ready"


def test_citation_ids_are_stable_across_refresh(tmp_path):
    root = folder(tmp_path / "docs", {"guide.md": GUIDE})
    source = attach("agent-a", root)
    before = asyncio.run(kb.retrieve("agent-a", "refund", ["refund"])).passages[0].id
    # Touch the file without changing it: same IDs.
    os.utime(root / "guide.md", (time.time() + 5, time.time() + 5))
    asyncio.run(kb.index(source))
    assert asyncio.run(kb.retrieve("agent-a", "refund", ["refund"])).passages[0].id == before


def test_refresh_reindexes_changed_files_and_drops_deleted_ones(tmp_path):
    root = folder(tmp_path / "docs", {"guide.md": GUIDE, "old.txt": "The zebra project is archived.\n"})
    source = attach("agent-a", root)
    assert asyncio.run(kb.retrieve("agent-a", "zebra", ["zebra"])).passages
    (root / "old.txt").unlink()
    (root / "guide.md").write_text(GUIDE.replace("14 days", "30 days"), encoding="utf-8")
    os.utime(root / "guide.md", (time.time() + 10, time.time() + 10))
    asyncio.run(kb.index(source))
    assert asyncio.run(kb.retrieve("agent-a", "zebra", ["zebra"])).reason == "no_match"
    refund = asyncio.run(kb.retrieve("agent-a", "refund", ["refund"])).passages[0]
    assert "30 days" in refund.text and "14 days" not in refund.text
    assert kb.sources_for("agent-a")[0]["files"] == 1


def test_an_agent_without_the_folder_gets_nothing(tmp_path):
    attach("agent-a", folder(tmp_path / "a", {"secret.md": "# Vault\n\nThe vault code is 4242.\n"}))
    attach("agent-b", folder(tmp_path / "b", {"public.md": "# Menu\n\nSoup of the day.\n"}))
    assert asyncio.run(kb.retrieve("agent-a", "vault code", ["vault"])).passages
    other = asyncio.run(kb.retrieve("agent-b", "vault code", ["vault", "4242"]))
    assert other.passages == [] and other.reason == "no_match"
    stranger = asyncio.run(kb.retrieve("agent-c", "vault code", ["vault"]))
    assert stranger.reason == "no_access"
    cid = asyncio.run(kb.retrieve("agent-a", "vault", ["vault"])).passages[0].id
    assert kb.citation("agent-a", cid)["line_start"] == 1  # the section, from its heading
    assert kb.citation("agent-b", cid) is None


def test_revoking_takes_effect_on_the_next_search(tmp_path):
    root = folder(tmp_path / "docs", {"guide.md": GUIDE})
    source = attach("agent-a", root)
    kb.attach("agent-b", str(root))  # shared: indexed once
    tool = KnowledgeBaseSearchTool("agent-a")
    first = asyncio.run(tool.run({"query": "refund", "words": ["refund"]}))
    assert "[kb-" in first.output
    assert kb.detach("agent-a", source)
    second = asyncio.run(tool.run({"query": "refund", "words": ["refund"]}))
    assert "[kb-" not in second.output and "no knowledge folders" in second.output
    # The other agent still has it; once nobody does, the index is gone too.
    assert asyncio.run(kb.retrieve("agent-b", "refund", ["refund"])).passages
    kb.detach("agent-b", source)
    with contextlib.closing(kb._connect()) as conn:
        assert conn.execute("SELECT count(*) FROM kb_chunks").fetchone()[0] == 0


class FakeEmbedder(embeddings.Embedder):
    """Arabic and English words for the same thing land on the same axis."""

    AXES = [("refund", "استرداد", "استرجاع"), ("install", "تثبيت", "setup"), ("hours", "ساعات", "دوام")]

    async def embed(self, texts):
        out = []
        for text in texts:
            low = text.lower()
            vector = [float(sum(low.count(w) for w in axis)) for axis in self.AXES] + [0.01]
            norm = math.sqrt(sum(x * x for x in vector))
            out.append([x / norm for x in vector])
        return out


def test_an_arabic_question_finds_an_english_passage_by_meaning(tmp_path, monkeypatch):
    fake = FakeEmbedder("fake:1", "fake", "fake", True, "fake")

    async def current():
        return fake

    monkeypatch.setattr(embeddings, "current", current)
    attach("agent-a", folder(tmp_path / "docs", {"guide.md": GUIDE}))
    assert kb.sources_for("agent-a")[0]["embedded"] > 0
    # No English word in the search: only the meaning connects them.
    found = asyncio.run(kb.retrieve("agent-a", "كم يوم عندي لاسترداد الاشتراك؟", ["استرداد", "الاشتراك"]))
    assert found.passages and found.passages[0].heading.endswith("Refund policy")
    assert found.embedder == "fake"


def test_a_failing_embedder_still_indexes_words(tmp_path, monkeypatch):
    class Broken(embeddings.Embedder):
        async def embed(self, texts):
            raise embeddings.EmbeddingError("provider down")

    async def current():
        return Broken("b:1", "b", "b", False, "broken")

    monkeypatch.setattr(embeddings, "current", current)
    attach("agent-a", folder(tmp_path / "docs", {"guide.md": GUIDE}))
    source = kb.sources_for("agent-a")[0]
    assert source["status"] == "ready" and "embeddings" in source["error"]
    assert asyncio.run(kb.retrieve("agent-a", "refund", ["refund"])).passages


def test_citation_paths_stay_inside_the_folder(tmp_path):
    root = folder(tmp_path / "docs", {"guide.md": GUIDE})
    source = attach("agent-a", root)
    with contextlib.closing(kb._connect()) as conn:
        conn.execute("UPDATE kb_chunks SET rel_path = '../outside.md' WHERE source_id = ?", (source,))
        conn.commit()
    cid = asyncio.run(kb.retrieve("agent-a", "refund", ["refund"]))
    assert all(kb.citation("agent-a", p.id) is None for p in cid.passages)
    assert kb.citation("agent-a", "kb-zzzz") is None


def test_the_tool_says_when_there_is_no_evidence(tmp_path):
    attach("agent-a", folder(tmp_path / "docs", {"guide.md": GUIDE}))
    result = asyncio.run(KnowledgeBaseSearchTool("agent-a").run({"query": "giraffes", "words": ["giraffe", "زرافة"]}))
    assert result.ok and "enough evidence" in result.output


def test_describe_cites_by_id_with_file_heading_and_lines(tmp_path):
    attach("agent-a", folder(tmp_path / "docs", {"guide.md": GUIDE}))
    passage = asyncio.run(kb.retrieve("agent-a", "refund", ["refund"])).passages[0]
    first = kb.describe([passage]).splitlines()[0]
    assert first == f"[{passage.id}] docs/guide.md › Rafiq guide › Refund policy, lines {passage.line_start}-{passage.line_end}"


# ── The API ────────────────────────────────────────────────────────────────────────────


@pytest.fixture()
async def client():
    await init_db()
    async with httpx.AsyncClient(transport=ASGITransport(app=__import__("rafiq_agent.main").main.app), base_url="http://test") as c:
        yield c


async def test_api_attach_refresh_detach_and_citation(client, tmp_path):
    async with SessionLocal() as session:
        agent = LlmModel(name="KB agent", provider="openai", model_id="gpt-x")
        session.add(agent)
        await session.commit()
        agent_id = agent.id
    root = folder(tmp_path / "docs", {"guide.md": GUIDE})
    base = f"/settings/knowledge-bases/agents/{agent_id}"
    r = await client.post(f"{base}/sources", json={"path": str(root)}, headers=AUTH)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["embedding"]["mode"] == "off" and body["chat_provider"] == "openai"
    source_id = body["sources"][0]["id"]
    for _ in range(100):
        if kb.sources_for(agent_id)[0]["status"] == "ready":
            break
        await asyncio.sleep(0.05)
    passage = (await kb.retrieve(agent_id, "refund", ["refund"])).passages[0]
    r = await client.get(f"{base}/citations/{passage.id}", headers=AUTH)
    assert r.status_code == 200 and r.json()["rel_path"] == "guide.md"
    assert any("Refund policy" in line for line in r.json()["context"])
    assert (await client.get(f"/settings/knowledge-bases/agents/someone-else/citations/{passage.id}", headers=AUTH)).status_code == 404
    assert (await client.post(f"{base}/sources/{source_id}/refresh", headers=AUTH)).status_code == 202
    r = await client.delete(f"{base}/sources/{source_id}", headers=AUTH)
    assert r.status_code == 200 and r.json()["sources"] == []
    assert (await client.get(f"{base}/citations/{passage.id}", headers=AUTH)).status_code == 404
    assert (await client.post(f"{base}/sources", json={"path": str(tmp_path / 'missing')}, headers=AUTH)).status_code == 400


def test_sha_of_ids_is_hex():
    assert kb.citation_id("s", "a.md", "x", 0).startswith("kb-")
    assert len(hashlib.sha1(b"").hexdigest()) == 40


def test_a_reply_may_cite_only_what_it_retrieved():
    from rafiq_agent.core.chat_service import ChatTurn

    turn = ChatTurn("chat", "question", "agent-a", [])
    assert turn._source_check("no knowledge used") is None
    turn.kb_passages = {"kb-0123456789": {}}
    assert "kb-9999999999" in turn._source_check("It's 14 days [kb-9999999999].")
    assert turn._source_check("It's 14 days [kb-0123456789].") is None
    # Uncited once: asked to cite (or to say there's no evidence); the second time it stands.
    assert turn._source_check("It's 14 days.") is not None
    assert turn._source_check("The knowledge base doesn't say.") is None
