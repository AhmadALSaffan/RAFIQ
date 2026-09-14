from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

import httpx

from rafiq_agent.i18n import tr


class IntegrationError(Exception):
    """Anything the user should see about a connector: bad token, missing project, API change."""


@dataclass
class Issue:
    key: str  # what the user sees: PROJ-12, ENG-45, owner/repo#7
    id: str  # what the API needs (often equals key)
    title: str
    url: str
    status: str
    project: str | None = None
    updated_at: str | None = None
    description: str | None = None
    # Everything else the tracker knows, so the inbox can show a full picture.
    status_category: str | None = None  # todo | in_progress | done
    priority: str | None = None
    issue_type: str | None = None
    assignee: str | None = None
    reporter: str | None = None
    labels: list[str] = field(default_factory=list)
    created_at: str | None = None
    due_date: str | None = None
    parent: str | None = None
    milestone: str | None = None
    estimate: str | None = None
    comment_count: int | None = None
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class StatusOption:
    """A state the issue can be moved to right now, as the tracker reports it."""

    id: str
    name: str
    category: str | None = None  # todo | in_progress | done


@dataclass
class IssueComment:
    author: str
    body: str
    created_at: str | None = None


@dataclass
class Account:
    label: str  # e.g. "Ahmad (ahmad@example.com)"
    meta: dict[str, Any] = field(default_factory=dict)


@dataclass
class FieldSpec:
    key: str
    label: str
    kind: str = "text"  # text | password | url
    placeholder: str = ""
    required: bool = True
    help: str = ""


@dataclass
class ProviderSpec:
    id: str
    name: str
    icon: str  # simple-icons slug, or "" to fall back to a monogram
    color: str
    docs_url: str
    fields: list[FieldSpec]
    blurb: str


class Integration(ABC):
    """One connected account of an issue tracker."""

    spec: ProviderSpec

    def __init__(self, config: dict[str, Any], secret: str | None) -> None:
        self.config = config
        self.secret = secret or ""

    # -- transport ------------------------------------------------------------------

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=20, headers=self.headers(), follow_redirects=True)

    @abstractmethod
    def headers(self) -> dict[str, str]: ...

    @staticmethod
    def check(response: httpx.Response) -> httpx.Response:
        if response.status_code in (401, 403):
            raise IntegrationError(tr("المفتاح أو الصلاحيات غير صحيحة."))
        if response.status_code == 404:
            raise IntegrationError(tr("ما لقيت العنصر المطلوب (تأكد من الرابط أو المعرّف)."))
        if response.status_code >= 400:
            raise IntegrationError(tr("المزوّد رجّع خطأ {0}: {1}", response.status_code, response.text[:200]))
        return response

    # -- capabilities ---------------------------------------------------------------

    @abstractmethod
    async def verify(self) -> Account: ...

    @abstractmethod
    async def list_issues(
        self, query: str | None = None, limit: int = 30, include_done: bool = False
    ) -> list[Issue]: ...

    @abstractmethod
    async def get_issue(self, key: str) -> Issue: ...

    @abstractmethod
    async def list_comments(self, key: str, limit: int = 50) -> list[IssueComment]: ...

    @abstractmethod
    async def add_comment(self, key: str, body: str) -> None: ...

    async def list_statuses(self, key: str) -> list[StatusOption]:
        """States this issue can move to. Empty means the tracker doesn't offer a choice."""
        return []

    async def set_status(self, key: str, status_id: str) -> str:
        """Moves the issue to `status_id` and returns the resulting status name."""
        raise IntegrationError(tr("تغيير الحالة مو مدعوم على هالمزوّد."))

    @abstractmethod
    async def complete(self, key: str) -> str:
        """Moves the issue to its done/closed state and returns the resulting status name."""
