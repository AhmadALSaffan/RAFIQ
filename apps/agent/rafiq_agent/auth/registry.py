"""Which providers support account sign-in. Adding one = one adapter class + one line here."""

from rafiq_agent.auth.base import AccountAdapter
from rafiq_agent.auth.github_copilot import GitHubCopilotAdapter
from rafiq_agent.auth.openrouter import OpenRouterAdapter

ADAPTERS: dict[str, AccountAdapter] = {
    "github_copilot": GitHubCopilotAdapter(),
    "openrouter": OpenRouterAdapter(),
}


# Experimental adapters are optional: if one fails to import (or its file is removed),
# Rafiq simply runs without it.
try:
    from rafiq_agent.auth.experimental.authai import AuthAIAdapter

    ADAPTERS["authai"] = AuthAIAdapter()
except Exception:  # noqa: BLE001 - an experimental adapter must never take the app down
    pass


def adapter_for(provider: str) -> AccountAdapter | None:
    return ADAPTERS.get(provider)
