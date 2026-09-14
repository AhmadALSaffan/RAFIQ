from datetime import datetime
from typing import Literal

from pydantic import BaseModel

Provider = Literal[
    "anthropic", "openai", "gemini", "deepseek", "groq", "mistral", "xai", "openrouter", "ollama", "custom"
]


class ModelCreate(BaseModel):
    name: str
    provider: Provider
    model_id: str
    base_url: str | None = None
    api_key: str | None = None


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


class DiscoverRequest(BaseModel):
    provider: Provider
    api_key: str | None = None
    base_url: str | None = None


class DiscoveredModelOut(BaseModel):
    id: str
    display_name: str
