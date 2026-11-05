"""The free local model (core/local_model.py), against a fake Ollama."""

import json

import httpx
import pytest

from rafiq_agent.core import local_model


def fake_ollama(tags: list[str] | None, pull_lines: list[dict] | None = None):
    """An httpx transport answering like Ollama (None tags = not running)."""

    def handle(request: httpx.Request) -> httpx.Response:
        if tags is None:
            raise httpx.ConnectError("refused", request=request)
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": t} for t in tags]})
        if request.url.path == "/api/pull":
            body = "\n".join(json.dumps(line) for line in (pull_lines or [])) + "\n"
            return httpx.Response(200, content=body.encode())
        return httpx.Response(404)

    return httpx.MockTransport(handle)


@pytest.fixture()
def ollama(monkeypatch):
    def use(tags, pull_lines=None):
        transport = fake_ollama(tags, pull_lines)
        real = httpx.AsyncClient

        def client(*args, **kwargs):
            kwargs["transport"] = transport
            return real(*args, **kwargs)

        monkeypatch.setattr(local_model.httpx, "AsyncClient", client)

    local_model.state.update(install=None, pull=None)
    return use


async def test_status_when_ollama_is_missing(ollama, monkeypatch):
    ollama(None)
    monkeypatch.setattr(local_model, "_binary", lambda: None)
    info = await local_model.status()
    assert info["running"] is False and info["installed"] is False
    assert {m["tag"] for m in info["recommended"]} == local_model.ALLOWED_TAGS
    assert info["suggested"] in local_model.ALLOWED_TAGS


async def test_status_lists_what_ollama_has(ollama):
    ollama(["qwen3:4b"])
    info = await local_model.status()
    assert info["running"] and info["models"] == ["qwen3:4b"]


async def test_only_offered_models_can_be_pulled():
    with pytest.raises(ValueError):
        await local_model.pull("someone/anything:latest")


async def test_pull_downloads_then_adds_the_model(ollama, monkeypatch):
    from sqlalchemy import select

    from rafiq_agent.llm import discovery
    from rafiq_agent.storage.db import SessionLocal, init_db
    from rafiq_agent.storage.models import LlmModel

    await init_db()
    ollama(
        ["qwen3:4b"],
        [{"status": "pulling manifest"}, {"status": "downloading", "total": 100, "completed": 40}, {"status": "success"}],
    )

    async def verified(*_args, **_kwargs):
        return discovery.VerifyResult(ok=True, latency_ms=5, supports_tools=True, error=None)

    monkeypatch.setattr(discovery, "verify_model", verified)
    await local_model.pull("qwen3:4b")
    job = local_model.state["pull"]
    assert job["status"] == "done", job
    async with SessionLocal() as session:
        rows = (await session.execute(select(LlmModel).where(LlmModel.provider == "ollama", LlmModel.model_id == "qwen3:4b"))).scalars().all()
    assert len(rows) == 1 and rows[0].id == job["model_id"] and rows[0].verify_ok
    # A second pull of the same model doesn't add it twice.
    await local_model.pull("qwen3:4b")
    async with SessionLocal() as session:
        rows = (await session.execute(select(LlmModel).where(LlmModel.model_id == "qwen3:4b"))).scalars().all()
    assert len(rows) == 1


async def test_a_failing_pull_is_reported_not_raised(ollama):
    ollama(["qwen3:4b"], [{"error": "no space left on device"}])
    await local_model.pull("qwen3:4b")
    assert local_model.state["pull"]["status"] == "error"
    assert "space" in local_model.state["pull"]["error"]
