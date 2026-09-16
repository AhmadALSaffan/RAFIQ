"""New providers: what each one is sent, how their models are listed, prompt caching for
Claude, and routing a chat's tasks to their own model."""

import json

import httpx
import pytest

from rafiq_agent.llm import discovery
from rafiq_agent.llm.base import LlmProvider
from rafiq_agent.llm.presets import (
    AZURE_API_VERSION,
    PRESET_BASES,
    ProviderConfigError,
    caches_prompts,
    call_kwargs,
    with_cache_marks,
)


def test_azure_needs_its_endpoint_and_an_api_version():
    kwargs = call_kwargs("azure", "k", "https://me.openai.azure.com", {})
    assert kwargs == {"api_key": "k", "api_base": "https://me.openai.azure.com", "api_version": AZURE_API_VERSION}
    assert call_kwargs("azure", "k", "x", {"api_version": "2025-01-01-preview"})["api_version"] == "2025-01-01-preview"


def test_bedrock_reads_its_keys_from_the_saved_json():
    secret = json.dumps({"access_key_id": "AKIA1", "secret_access_key": "s3", "session_token": "t"})
    kwargs = call_kwargs("bedrock", secret, None, {"region": "eu-west-1"})
    assert kwargs == {
        "aws_access_key_id": "AKIA1",
        "aws_secret_access_key": "s3",
        "aws_region_name": "eu-west-1",
        "aws_session_token": "t",
    }
    with pytest.raises(ProviderConfigError):
        call_kwargs("bedrock", "not json", None, {})


def test_vertex_takes_the_project_from_the_service_account():
    account = json.dumps({"type": "service_account", "project_id": "my-proj"})
    kwargs = call_kwargs("vertex_ai", account, None, {"location": "europe-west4"})
    assert kwargs["vertex_project"] == "my-proj" and kwargs["vertex_location"] == "europe-west4"
    assert json.loads(kwargs["vertex_credentials"])["project_id"] == "my-proj"


def test_openai_compatible_presets_get_their_endpoint():
    assert call_kwargs("cerebras", "k", None, None) == {"api_key": "k", "api_base": PRESET_BASES["cerebras"]}
    assert call_kwargs("dashscope", "k", "https://dashscope.aliyuncs.com/compatible-mode/v1", None)["api_base"].startswith(
        "https://dashscope.aliyuncs.com"
    )  # the China endpoint, when the user picks it
    assert call_kwargs("lm_studio", None, None, None)["api_key"] == "lm-studio"  # it wants *some* key
    assert call_kwargs("ollama", None, None, None)["api_base"] == "http://localhost:11434"


def test_claude_gets_cache_breakpoints_and_others_dont():
    messages = [
        {"role": "system", "content": "you are rafiq"},
        {"role": "user", "content": "first"},
        {"role": "assistant", "content": "hi"},
        {"role": "user", "content": [{"type": "text", "text": "second"}]},
    ]
    marked = with_cache_marks(messages)
    assert marked[0]["content"][-1]["cache_control"] == {"type": "ephemeral"}
    assert marked[3]["content"][-1]["cache_control"] == {"type": "ephemeral"}
    assert marked[1] == messages[1] and marked[2] == messages[2]  # only the two breakpoints
    assert messages[3]["content"][0].get("cache_control") is None  # the caller's list is untouched

    assert caches_prompts(LlmProvider("anthropic", "claude-sonnet-4-5", "k", None).model)
    assert caches_prompts(LlmProvider("bedrock", "us.anthropic.claude-sonnet-4-5-v1:0", "{}", None).model) is True
    assert not caches_prompts(LlmProvider("openai", "gpt-5", "k", None).model)


@pytest.fixture()
def fake_http(monkeypatch):
    """discovery's HTTP calls, answered by a handler the test sets."""
    routes: dict[str, httpx.Response] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        return routes.get(str(request.url), httpx.Response(404))

    real = httpx.AsyncClient

    def client(*args, **kwargs):  # noqa: ANN002, ANN003
        kwargs["transport"] = httpx.MockTransport(handler)
        return real(*args, **kwargs)

    monkeypatch.setattr(discovery.httpx, "AsyncClient", client)
    return routes


async def test_listing_models_from_the_new_endpoints(fake_http):
    fake_http[f"{PRESET_BASES['together_ai']}/models"] = httpx.Response(200, json=[{"id": "meta-llama/Llama-3.3-70B"}])
    fake_http[f"{PRESET_BASES['cerebras']}/models"] = httpx.Response(200, json={"data": [{"id": "llama-4-scout"}]})
    assert [m.id for m in await discovery.discover_models("together_ai", "k", None)] == ["meta-llama/Llama-3.3-70B"]
    assert [m.id for m in await discovery.discover_models("cerebras", "k", None)] == ["llama-4-scout"]
    # No list on the endpoint: the known models are offered instead.
    assert "glm-4.6" in [m.id for m in await discovery.discover_models("zai", "k", None)]
    assert [m.id for m in await discovery.discover_models("vertex_ai", "{}", None)][0].startswith("gemini")
    with pytest.raises(discovery.DiscoveryError):
        await discovery.discover_models("azure", "k", "https://me.openai.azure.com")


async def test_verify_sends_each_provider_its_own_credentials(monkeypatch):
    sent: dict = {}

    async def fake_completion(**kwargs):  # noqa: ANN003
        sent.update(kwargs)
        return None

    monkeypatch.setattr(discovery.litellm, "acompletion", fake_completion)
    secret = json.dumps({"access_key_id": "AKIA1", "secret_access_key": "s3"})
    result = await discovery.verify_model("bedrock", "us.anthropic.claude-sonnet-4-5-v1:0", secret, None, {"region": "us-west-2"})
    assert result.ok and sent["model"] == "bedrock/us.anthropic.claude-sonnet-4-5-v1:0"
    assert sent["aws_access_key_id"] == "AKIA1" and sent["aws_region_name"] == "us-west-2" and "api_key" not in sent

    broken = await discovery.verify_model("vertex_ai", "gemini-2.5-pro", "not json", None)
    assert not broken.ok  # a malformed key is a failed check, not a crash


async def test_a_chats_tasks_go_to_the_task_model():
    from rafiq_agent.core.chat_service import ChatTurn
    from rafiq_agent.schemas.settings import AppSettings
    from rafiq_agent.storage.db import SessionLocal, init_db
    from rafiq_agent.storage.models import LlmModel

    await init_db()
    async with SessionLocal() as session:
        strong = LlmModel(name="strong", provider="anthropic", model_id="claude", verify_ok=True)
        fast = LlmModel(name="fast", provider="cerebras", model_id="llama", verify_ok=True)
        broken = LlmModel(name="broken", provider="groq", model_id="x", verify_ok=False)
        session.add_all([strong, fast, broken])
        await session.commit()
        ids = (strong.id, fast.id, broken.id)

    turn = ChatTurn("chat", "hi", ids[0], [])
    turn.settings = AppSettings(task_model_id=ids[1])
    assert await turn._task_model() == ids[1]
    turn.settings = AppSettings(task_model_id=ids[2])
    assert await turn._task_model() == ids[0]  # a model that doesn't work isn't used
    turn.settings = AppSettings()
    assert await turn._task_model() == ids[0]
