"""Embeddings for the agents' knowledge bases (core/agent_knowledge.py).

Off by default: the knowledge bases then search by words only, and no file text leaves the
computer while indexing. Two ways to turn them on, chosen in Settings and shown in every
agent's Knowledge section:

- "ollama": a multilingual model on this computer (bge-m3 by default). Nothing leaves it.
- "agent": one of the user's agents lends its provider and credentials (OpenAI, Gemini,
  Mistral, Cohere…), with that provider's embedding model. The text of every indexed file,
  and every question searched, is sent to that provider.

Vectors from different models can't be compared, so each one is stored with the `key` of the
model that made it; changing the model re-embeds on the next refresh.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from rafiq_agent.core.local import OLLAMA_DEFAULT, is_local

BATCH = 32
# A provider's embedding model when the user didn't name one. All of them handle Arabic and
# English in one space, so an Arabic question finds an English passage.
DEFAULT_MODELS = {
    "openai": "text-embedding-3-small",
    "azure": "text-embedding-3-small",
    "gemini": "text-embedding-004",
    "mistral": "mistral-embed",
    "cohere": "embed-multilingual-v3.0",
    "voyage": "voyage-multilingual-2",
    "ollama": "bge-m3",
    "lm_studio": "text-embedding-bge-m3",
}
OLLAMA_MODEL = "bge-m3"


class EmbeddingError(Exception):
    pass


@dataclass
class Embedder:
    key: str  # the vector space: "ollama:bge-m3", "openai:text-embedding-3-small"…
    provider: str
    model: str
    local: bool
    label: str
    kwargs: dict[str, Any] = field(default_factory=dict)

    async def embed(self, texts: list[str]) -> list[list[float]]:
        import litellm

        from rafiq_agent.llm.base import litellm_model_string

        # Ollama embeds through /api/embed (litellm's "ollama/"), not the chat route.
        name = f"ollama/{self.model}" if self.provider == "ollama" else litellm_model_string(self.provider, self.model)
        out: list[list[float]] = []
        for start in range(0, len(texts), BATCH):
            batch = [t[:8000] or " " for t in texts[start : start + BATCH]]
            try:
                response = await litellm.aembedding(model=name, input=batch, **self.kwargs)
            except Exception as exc:  # noqa: BLE001 - shown to the user as the index's error
                raise EmbeddingError(f"{self.label}: {str(exc)[:300]}") from exc
            rows = sorted(
                (row if isinstance(row, dict) else row.__dict__ for row in response.data),
                key=lambda row: row.get("index", 0),
            )
            out += [normalize(list(row["embedding"])) for row in rows]
        if len(out) != len(texts):
            raise EmbeddingError(f"{self.label}: {len(out)} vectors for {len(texts)} passages")
        return out


def normalize(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(x * x for x in vector)) or 1.0
    return [x / norm for x in vector]


def describe(settings: Any, agent: Any | None) -> dict[str, Any]:
    """What the Knowledge section says about embeddings: where file text goes while indexing."""
    mode = getattr(settings, "rag_embedding", "off") or "off"
    if mode == "ollama":
        model = settings.rag_embedding_model or OLLAMA_MODEL
        return {"mode": mode, "provider": "ollama", "model": model, "local": True, "agent_name": None}
    if mode == "agent" and agent is not None:
        model = settings.rag_embedding_model or DEFAULT_MODELS.get(agent.provider) or ""
        return {
            "mode": mode,
            "provider": agent.provider,
            "model": model,
            "local": is_local(agent.provider),
            "agent_name": agent.name,
        }
    return {"mode": "off", "provider": None, "model": None, "local": True, "agent_name": None}


async def current() -> Embedder | None:
    """The embedder the settings ask for, or None (words only)."""
    from rafiq_agent.core.agent_runtime import load_settings

    settings = await load_settings()
    mode = settings.rag_embedding
    if mode == "ollama":
        model = settings.rag_embedding_model or OLLAMA_MODEL
        return Embedder(f"ollama:{model}", "ollama", model, True, f"Ollama ({model})", {"api_base": OLLAMA_DEFAULT})
    if mode != "agent" or not settings.rag_embedding_agent_id:
        return None
    from rafiq_agent.auth.resolve import credentials_for
    from rafiq_agent.llm.presets import call_kwargs
    from rafiq_agent.storage.db import SessionLocal
    from rafiq_agent.storage.models import LlmModel

    async with SessionLocal() as session:
        agent = await session.get(LlmModel, settings.rag_embedding_agent_id)
        if agent is None:
            raise EmbeddingError("the agent chosen for embeddings was deleted")
        if agent.provider == "github_copilot":
            raise EmbeddingError("GitHub Copilot has no embeddings; choose another agent or Ollama")
        model = settings.rag_embedding_model or DEFAULT_MODELS.get(agent.provider)
        if not model:
            raise EmbeddingError(f"name an embedding model for {agent.provider}")
        creds = credentials_for(agent)
        kwargs = {k: v for k, v in call_kwargs(agent.provider, creds.api_key, creds.base_url, agent.options).items() if v is not None}
        return Embedder(f"{agent.provider}:{model}", agent.provider, model, is_local(agent.provider), f"{agent.name} ({model})", kwargs)
