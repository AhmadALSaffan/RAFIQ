"""Local models: the window Ollama is asked for, tools that fit the window, and speed."""

import json

from rafiq_agent.core import fit, local
from rafiq_agent.llm import usage
from rafiq_agent.tools.base import Tool, ToolRegistry


class Fake(Tool):
    category = "read_only"

    def __init__(self, name: str, size: int) -> None:
        self.name = name
        self.description = "x" * size
        self.parameters = {"type": "object", "properties": {}}

    async def run(self, args):  # pragma: no cover - never called
        return ""


def registry_with(**groups: int) -> ToolRegistry:
    registry = ToolRegistry()
    for prefix, count in groups.items():
        for i in range(count):
            registry.register(Fake(f"{prefix}{i}", 2000))
    return registry


def test_heavy_groups_go_first_until_it_fits():
    registry = registry_with(mcp__github__tool=30, browser_=4, filesystem_=5)
    dropped = fit.fit_tools(registry, "instructions", 8192)
    assert dropped[0] == "mcp"
    assert not any(n.startswith("mcp__") for n in registry.names())
    assert any(n.startswith("filesystem_") for n in registry.names())  # the essentials stay


def test_nothing_goes_when_it_fits():
    registry = registry_with(filesystem_=3)
    assert fit.fit_tools(registry, "instructions", 128_000) == []
    assert len(registry.names()) == 3


def test_the_note_names_what_was_left_out():
    note = fit.trimmed_note(["mcp", "browser"], 8192)
    assert "8,192" in note


def test_ollama_window_is_the_models_own_capped_by_memory(monkeypatch):
    calls = []

    class Response:
        def __init__(self, body):
            self.body = body

        def read(self):
            return json.dumps(self.body).encode()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def urlopen(request, timeout=0):
        calls.append(request.full_url)
        return Response({"model_info": {"qwen3.context_length": 262144, "qwen3.embedding_length": 2560}})

    monkeypatch.setattr(local.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(local, "_max_by_model", {})
    monkeypatch.setattr(local, "memory_budget", lambda: 16_384)
    assert local.ollama_window("qwen3:4b", "http://localhost:11434/v1") == 16_384
    assert calls == ["http://127.0.0.1:11434/api/show"]  # IPv4: localhost costs ~2 s on Windows
    local.ollama_window("qwen3:4b", "http://localhost:11434")
    assert len(calls) == 1  # cached

    def down(request, timeout=0):
        raise OSError("refused")

    monkeypatch.setattr(local.urllib.request, "urlopen", down)
    assert local.ollama_window("gone:1b") == local.OLLAMA_FALLBACK


def test_tokens_per_second_over_the_timed_calls():
    with usage.collect() as turn:
        turn.calls.append(usage.Usage(prompt_tokens=1000, completion_tokens=100, seconds=4.0, first_token=2.5))
        turn.calls.append(usage.Usage(prompt_tokens=1200, completion_tokens=60, seconds=2.0))
        turn.calls.append(usage.Usage(prompt_tokens=10, completion_tokens=1, seconds=0.0))  # a tool call: not timed
    assert turn.tokens_per_second() == round(160 / 6.0, 1)
    assert turn.total().first_token == 2.5


async def test_reading_ahead_sends_the_chat_without_the_new_message(monkeypatch):
    from rafiq_agent.core import warm
    from rafiq_agent.llm.base import LlmProvider
    from rafiq_agent.storage.db import SessionLocal, init_db
    from rafiq_agent.storage.models import LlmModel

    await init_db()
    async with SessionLocal() as session:
        local_model = LlmModel(name="local", provider="ollama", model_id="qwen3:4b-instruct")
        cloud = LlmModel(name="cloud", provider="custom", model_id="x", base_url="http://127.0.0.1:1")
        session.add_all([local_model, cloud])
        await session.commit()
        local_id, cloud_id = local_model.id, cloud.id

    sent = []

    async def fake_warm(self, messages, tools):
        sent.append((messages, tools))

    monkeypatch.setattr(LlmProvider, "warm", fake_warm)
    monkeypatch.setattr(local, "ollama_max", lambda *a, **k: 32_768)

    async def running(base_url=None):
        return "running"

    from rafiq_agent.core import local_model

    monkeypatch.setattr(local_model, "ensure_running", running)
    monkeypatch.setattr(warm, "_recent", {})
    assert await warm.warm(cloud_id) is False  # a cloud model is never read ahead
    assert await warm.warm(local_id) is True
    messages, tools = sent[0]
    assert messages[0]["role"] == "system" and all(m["role"] != "user" for m in messages)
    assert not any(t["function"]["name"].startswith("mcp__") for t in tools)
    assert await warm.warm(local_id) is False  # read a moment ago: not again


async def test_ollama_is_started_when_a_message_needs_it(monkeypatch):
    from rafiq_agent.core import local_model

    up = {"now": False}
    started = []

    async def tags():
        return ["qwen3:4b-instruct"] if up["now"] else None

    async def start():
        started.append(True)
        up["now"] = True
        return True

    monkeypatch.setattr(local_model, "_tags", tags)
    monkeypatch.setattr(local_model, "start", start)
    monkeypatch.setattr(local_model, "_binary", lambda: "ollama.exe")
    monkeypatch.setattr(local_model, "_running_until", 0.0)
    assert await local_model.ensure_running("http://127.0.0.1:11434") == "started"
    assert await local_model.ensure_running("http://127.0.0.1:11434") == "running"
    assert started == [True]
    # A server on another computer is never started from here.
    assert await local_model.ensure_running("http://192.168.1.20:11434") == "running"


async def test_not_installed_says_so(monkeypatch):
    from rafiq_agent.core import local_model

    async def tags():
        return None

    monkeypatch.setattr(local_model, "_tags", tags)
    monkeypatch.setattr(local_model, "_binary", lambda: None)
    monkeypatch.setattr(local_model, "_running_until", 0.0)
    assert await local_model.ensure_running(None) == "missing"
