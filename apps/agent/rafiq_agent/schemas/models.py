from datetime import datetime
from typing import Literal

from pydantic import BaseModel

Provider = Literal[
    "anthropic",
    "openai",
    "gemini",
    "deepseek",
    "groq",
    "mistral",
    "xai",
    "openrouter",
    "ollama",
    "custom",
    "github_copilot",
    # Enterprise clouds
    "azure",
    "bedrock",
    "vertex_ai",
    # Fast inference
    "cerebras",
    "fireworks_ai",
    "together_ai",
    # Qwen, Kimi, GLM
    "dashscope",
    "moonshot",
    "zai",
    # Local
    "lm_studio",
    # Experimental, optional (auth/experimental/authai.py).
    "authai",
]

AuthMethod = Literal["api_key", "oauth"]


class ModelCreate(BaseModel):
    name: str
    provider: Provider
    model_id: str
    base_url: str | None = None
    api_key: str | None = None
    # "oauth" agents sign in with a connected account instead of a key.
    auth_method: AuthMethod = "api_key"
    account_id: str | None = None
    # Non-secret provider settings (Azure api_version, Bedrock region, Vertex project/location).
    options: dict[str, str] = {}


class ModelAuthUpdate(BaseModel):
    """Re-points one agent at a different account — touches that agent only."""

    account_id: str


class ModelFallbackUpdate(BaseModel):
    """The agent to use when this one's provider keeps failing (None = no fallback)."""

    fallback_model_id: str | None = None
    options: dict[str, str] = {}


class ModelOut(BaseModel):
    id: str
    name: str
    provider: Provider
    model_id: str
    base_url: str | None
    has_key: bool
    created_at: datetime
    verify_ok: bool | None = None
    verify_error: str | None = None
    verify_latency_ms: int | None = None
    verified_at: datetime | None = None
    supports_tools: bool | None = None
    auth_method: AuthMethod = "api_key"
    account_id: str | None = None
    # Who the agent signs in as, for display — never the token.
    account_label: str | None = None
    account_status: str | None = None
    fallback_model_id: str | None = None


class DiscoverRequest(BaseModel):
    provider: Provider
    api_key: str | None = None
    base_url: str | None = None
    account_id: str | None = None
    options: dict[str, str] = {}


class DiscoveredModelOut(BaseModel):
    id: str
    display_name: str
