"""Every connector Rafiq ships, by id. Each module maps one tracker's official API onto
the types in integrations/base.py."""

from typing import Any

from rafiq_agent.i18n import tr
from rafiq_agent.integrations.base import Integration, IntegrationError
from rafiq_agent.integrations.providers.asana import AsanaIntegration
from rafiq_agent.integrations.providers.azure import AzureDevOpsIntegration
from rafiq_agent.integrations.providers.bitbucket import BitbucketIntegration
from rafiq_agent.integrations.providers.clickup import ClickUpIntegration
from rafiq_agent.integrations.providers.gitea import GiteaIntegration
from rafiq_agent.integrations.providers.github import GitHubIntegration
from rafiq_agent.integrations.providers.gitlab import GitLabIntegration
from rafiq_agent.integrations.providers.jira import JiraIntegration
from rafiq_agent.integrations.providers.linear import LinearIntegration
from rafiq_agent.integrations.providers.plane import PlaneIntegration
from rafiq_agent.integrations.providers.trello import TrelloIntegration
from rafiq_agent.integrations.providers.youtrack import YouTrackIntegration

REGISTRY: dict[str, type[Integration]] = {
    cls.spec.id: cls
    for cls in (
        JiraIntegration,
        LinearIntegration,
        GitHubIntegration,
        GitLabIntegration,
        AzureDevOpsIntegration,
        TrelloIntegration,
        AsanaIntegration,
        ClickUpIntegration,
        YouTrackIntegration,
        BitbucketIntegration,
        GiteaIntegration,
        PlaneIntegration,
    )
}


def build(provider: str, config: dict[str, Any], secret: str | None) -> Integration:
    cls = REGISTRY.get(provider)
    if not cls:
        raise IntegrationError(tr("مزوّد غير مدعوم: {0}", provider))
    return cls(config, secret)


def secret_field(provider: str) -> str:
    """Which configured field is the credential (stored in the OS keychain, never in the DB)."""
    cls = REGISTRY.get(provider)
    return cls.spec.secret if cls else "token"
