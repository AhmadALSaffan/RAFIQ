"""What every issue-tracker connector offers. A connector maps its own API onto these
types and methods, so the work inbox, the agent tools and the task lifecycle stay
provider-agnostic. Optional capabilities raise `Unsupported` until a connector implements
them, and each connector lists what it implements in `capabilities` so the app can offer
only what works.

Only documented, official APIs are used. A rate limit is respected, never worked around:
the connector raises `RateLimited` with the provider's own wait time."""

import contextlib
import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, ClassVar

import httpx

from rafiq_agent.i18n import tr


class IntegrationError(Exception):
    """Anything the user should see about a connector: bad token, missing project, API change."""


class Unsupported(IntegrationError):
    """This tracker has no official way to do that."""


class RateLimited(IntegrationError):
    """The provider asked us to slow down. `retry_after` is its own number, in seconds."""

    def __init__(self, message: str, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class ReadOnly(IntegrationError):
    """The user set this account to read-only."""


# What a connector can do beyond reading and commenting. The UI and the agent tools ask
# for these by name; anything not listed is hidden rather than failing on use.
CAPABILITIES = (
    "search",  # a native query: JQL, GitHub search, Linear text, WIQL…
    "create",
    "update",  # title, description, labels, assignee, priority, due date, estimate
    "subtasks",  # a child issue under a parent
    "link",  # blocks / is blocked by / relates to / duplicates
    "attach",  # upload a file to the issue
    "worklog",  # log time spent
    "dev",  # the pull requests, branches and commits linked to an issue
    "comment_edit",  # edit or delete a comment Rafiq wrote (what undo needs)
    "mentions",  # where someone mentioned you or asked you for something
    "reviews",  # pull/merge requests waiting for your review
    "sprint",  # the current sprint / cycle / iteration
    "projects",
    "users",
    "pull_request",  # open a pull/merge request from a pushed branch
)

LINK_KINDS = ("relates", "blocks", "blocked_by", "duplicates")


@dataclass
class Issue:
    key: str  # what the user sees: PROJ-12, ENG-45, owner/repo#7
    id: str  # what the API needs (often equals key)
    title: str
    url: str
    status: str
    project: str | None = None
    updated_at: str | None = None
    description: str | None = None  # Markdown
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
    attachments: list[dict[str, Any]] = field(default_factory=list)  # {name, url, size, mime}
    subtasks: list[str] = field(default_factory=list)  # keys
    links: list[dict[str, str]] = field(default_factory=list)  # {kind, key, title}
    kind: str = "issue"  # issue | pull_request
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
    body: str  # Markdown
    created_at: str | None = None
    id: str | None = None
    mine: bool = False


@dataclass
class Account:
    label: str  # e.g. "Ahmad (ahmad@example.com)"
    meta: dict[str, Any] = field(default_factory=dict)


@dataclass
class Project:
    id: str
    key: str
    name: str
    url: str | None = None


@dataclass
class IssueType:
    id: str
    name: str
    subtask: bool = False


@dataclass
class Person:
    id: str  # whatever the API wants when assigning
    name: str
    handle: str | None = None  # login / email


@dataclass
class DevLink:
    kind: str  # pull_request | branch | commit | link
    title: str
    url: str
    state: str | None = None  # open | merged | closed | draft
    ref: str | None = None


@dataclass
class Activity:
    """Something that happened that the user may want to hear about."""

    kind: str  # mention | review | assigned | comment | status | update
    key: str
    title: str
    url: str
    at: str | None = None
    actor: str | None = None
    text: str | None = None
    id: str | None = None  # the provider's own id, so it's announced once


@dataclass
class IssueDraft:
    project: str  # a project key, team key, repo, board or list — whatever the tracker calls it
    title: str
    description: str = ""  # Markdown
    issue_type: str | None = None
    labels: list[str] = field(default_factory=list)
    assignee: str | None = None  # a Person.id, or "me"
    priority: str | None = None
    due_date: str | None = None  # YYYY-MM-DD
    parent: str | None = None  # an issue key
    estimate_hours: float | None = None


@dataclass
class IssueChanges:
    """Only the fields that are set change. `assignee=""` unassigns; "me" is the user."""

    title: str | None = None
    description: str | None = None
    labels: list[str] | None = None  # replaces the set
    add_labels: list[str] = field(default_factory=list)
    remove_labels: list[str] = field(default_factory=list)
    assignee: str | None = None
    priority: str | None = None
    due_date: str | None = None
    estimate_hours: float | None = None
    parent: str | None = None

    def empty(self) -> bool:
        # "" counts as a change: it clears the field (unassigns, removes the due date).
        return all(v is None or v == [] for v in self.__dict__.values())


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
    secret: str = "token"  # which field is the credential (kept in the OS keychain)
    # The permissions to grant when making the token, shown next to the form.
    scopes: str = ""
    # Where the user makes a token, when it differs from docs_url.
    token_url: str | None = None
    group: str = "tracker"  # tracker | git


def unsupported(what: str) -> Unsupported:
    """`what` comes translated: unsupported(tr("البحث"))."""
    return Unsupported(tr("هالمنصّة ما بتدعم {0} بشكل رسمي.", what))


class Integration(ABC):
    """One connected account of an issue tracker."""

    spec: ClassVar[ProviderSpec]
    capabilities: ClassVar[frozenset[str]] = frozenset()
    # Tests swap in an httpx.MockTransport; real runs use the network.
    transport: ClassVar[httpx.AsyncBaseTransport | None] = None

    def __init__(self, config: dict[str, Any], secret: str | None) -> None:
        self.config = config
        self.secret = secret or ""
        if self.secret.startswith("{"):
            # An OAuth sign-in (integrations/oauth.py) keeps its tokens as JSON.
            with contextlib.suppress(ValueError):
                self.secret = str(json.loads(self.secret).get("access_token") or "")

    # -- transport ------------------------------------------------------------------

    def client(self, **kwargs: Any) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            timeout=kwargs.pop("timeout", 20),
            headers={**self.headers(), **kwargs.pop("headers", {})},
            follow_redirects=True,
            transport=self.transport,
            **kwargs,
        )

    @abstractmethod
    def headers(self) -> dict[str, str]: ...

    @staticmethod
    def check(response: httpx.Response) -> httpx.Response:
        if response.status_code == 429 or (
            response.status_code == 403 and response.headers.get("x-ratelimit-remaining") == "0"
        ):
            retry = response.headers.get("retry-after")
            try:
                wait = float(retry) if retry else None
            except ValueError:
                wait = None
            raise RateLimited(tr("المنصّة طلبت نستنى شوي قبل الطلب الجاي (حد الطلبات)."), wait)
        if response.status_code in (401, 403):
            raise IntegrationError(tr("المفتاح أو الصلاحيات غير صحيحة."))
        if response.status_code == 404:
            raise IntegrationError(tr("ما لقيت العنصر المطلوب (تأكد من الرابط أو المعرّف)."))
        if response.status_code >= 400:
            raise IntegrationError(tr("المزوّد رجّع خطأ {0}: {1}", response.status_code, response.text[:200]))
        return response

    def supports(self, capability: str) -> bool:
        return capability in self.capabilities

    @property
    def read_only(self) -> bool:
        return bool(self.config.get("read_only"))

    def guard_write(self) -> None:
        """Every write passes through here; a read-only account refuses them all."""
        if self.read_only:
            raise ReadOnly(tr("هالحساب على وضع «قراءة بس» — غيّره من صفحة الربط لتسمح بالتعديل."))

    # -- reading --------------------------------------------------------------------

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

    async def search(self, query: str, limit: int = 50) -> list[Issue]:
        """A query in the tracker's own language (JQL, GitHub search, WIQL, text…)."""
        raise unsupported(tr("البحث"))

    async def list_projects(self) -> list[Project]:
        raise unsupported(tr("قائمة المشاريع"))

    async def list_issue_types(self, project: str) -> list[IssueType]:  # noqa: ARG002
        return []

    async def list_users(self, project: str | None = None, query: str = "") -> list[Person]:  # noqa: ARG002
        raise unsupported(tr("قائمة الأشخاص"))

    async def list_labels(self, project: str | None = None) -> list[str]:  # noqa: ARG002
        return []

    async def list_priorities(self) -> list[str]:
        return []

    async def dev_links(self, key: str) -> list[DevLink]:  # noqa: ARG002
        raise unsupported(tr("ربط الكود بالمهام"))

    async def mentions(self, since: str | None = None) -> list[Activity]:  # noqa: ARG002
        raise unsupported(tr("الإشارات والتنبيهات"))

    async def review_requests(self, limit: int = 30) -> list[Issue]:  # noqa: ARG002
        raise unsupported(tr("طلبات المراجعة"))

    async def sprint(self, project: str | None = None, mine: bool = False) -> tuple[str | None, list[Issue]]:  # noqa: ARG002
        raise unsupported(tr("السبرنت"))

    async def list_statuses(self, key: str) -> list[StatusOption]:  # noqa: ARG002
        """States this issue can move to. Empty means the tracker doesn't offer a choice."""
        return []

    # -- writing (each one calls guard_write first) -----------------------------------

    @abstractmethod
    async def add_comment(self, key: str, body: str) -> str | None:
        """Posts a Markdown comment; returns its id when the tracker gives one (for undo)."""

    async def edit_comment(self, key: str, comment_id: str, body: str) -> None:  # noqa: ARG002
        raise unsupported(tr("تعديل التعليقات"))

    async def delete_comment(self, key: str, comment_id: str) -> None:  # noqa: ARG002
        raise unsupported(tr("حذف التعليقات"))

    async def set_status(self, key: str, status_id: str) -> str:  # noqa: ARG002
        """Moves the issue to `status_id` and returns the resulting status name."""
        raise unsupported(tr("تغيير الحالة"))

    @abstractmethod
    async def complete(self, key: str) -> str:
        """Moves the issue to its done/closed state and returns the resulting status name."""

    async def create_issue(self, draft: IssueDraft) -> Issue:  # noqa: ARG002
        raise unsupported(tr("إنشاء المهام"))

    async def update_issue(self, key: str, changes: IssueChanges) -> Issue:  # noqa: ARG002
        raise unsupported(tr("تعديل المهام"))

    async def link_issues(self, key: str, other: str, kind: str) -> None:  # noqa: ARG002
        raise unsupported(tr("ربط المهام ببعض"))

    async def attach(self, key: str, filename: str, data: bytes, mime: str) -> str | None:  # noqa: ARG002
        raise unsupported(tr("المرفقات"))

    async def log_work(self, key: str, seconds: int, comment: str = "") -> None:  # noqa: ARG002
        raise unsupported(tr("تسجيل الوقت"))

    async def open_pull_request(
        self, repo: str, head: str, base: str, title: str, body: str  # noqa: ARG002
    ) -> DevLink:
        raise unsupported(tr("فتح طلبات الدمج"))

    def repo_for_remote(self, remote_url: str) -> str | None:  # noqa: ARG002
        """When this account hosts the git remote, the repo as this API names it."""
        return None

    async def status_for_category(self, key: str, category: str, prefer: str | None = None) -> StatusOption | None:
        """The move that lands the issue in a category (todo / in_progress / done), preferring
        a status whose name contains `prefer` (e.g. "review")."""
        options = await self.list_statuses(key)
        if prefer:
            p = prefer.lower()
            named = [o for o in options if p in o.name.lower()]
            if named:
                return named[0]
        return next((o for o in options if o.category == category), None)
