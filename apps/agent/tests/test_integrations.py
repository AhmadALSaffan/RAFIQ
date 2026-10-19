"""The tracker connectors, against recorded-shape responses (httpx.MockTransport), and the
pieces around them: text conversion, the watcher's diff, channels, the task lifecycle's
naming, undo, and publishing a task's work on a branch."""

import json
import subprocess
from pathlib import Path
from typing import Any

import httpx
import pytest

from rafiq_agent.core import issue_lifecycle, issue_watch
from rafiq_agent.integrations import channels, markup
from rafiq_agent.integrations.base import (
    Integration,
    IntegrationError,
    Issue,
    IssueChanges,
    IssueDraft,
    ReadOnly,
)
from rafiq_agent.integrations.providers import REGISTRY, build
from rafiq_agent.integrations.providers.github import GitHubIntegration, html_url
from rafiq_agent.integrations.providers.gitlab import GitLabIntegration
from rafiq_agent.integrations.providers.jira import JiraIntegration


class Recorder:
    """A fake API: routes (method, path suffix) to JSON, and keeps every request."""

    def __init__(self, routes: dict[tuple[str, str], Any]) -> None:
        self.routes = routes
        self.calls: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        path = request.url.raw_path.decode().split("?")[0]  # as sent: %2F stays encoded
        for (method, suffix), body in self.routes.items():
            if request.method == method and path.endswith(suffix):
                if callable(body):
                    body = body(request)
                if isinstance(body, httpx.Response):
                    return body
                return httpx.Response(200, json=body)
        return httpx.Response(404, json={"error": f"no route for {request.method} {path}"})

    def body(self, index: int = -1) -> Any:
        return json.loads(self.calls[index].content or b"null")


@pytest.fixture()
def fake(monkeypatch):
    def install(cls: type[Integration], routes: dict[tuple[str, str], Any]) -> Recorder:
        recorder = Recorder(routes)
        monkeypatch.setattr(cls, "transport", httpx.MockTransport(recorder))
        return recorder

    return install


# ── Registry ─────────────────────────────────────────────────────────────────────────────


def test_every_provider_declares_itself():
    assert {"jira", "linear", "github", "gitlab", "azure", "trello", "asana", "clickup", "youtrack", "bitbucket", "gitea", "plane"} <= set(REGISTRY)
    for pid, cls in REGISTRY.items():
        spec = cls.spec
        assert spec.id == pid and spec.name and spec.fields
        assert spec.secret in {f.key for f in spec.fields}, pid
        assert cls.capabilities, pid
        build(pid, {}, "secret").headers()  # constructs without network


# ── Jira ─────────────────────────────────────────────────────────────────────────────────

ADF = {"type": "doc", "version": 1, "content": [
    {"type": "paragraph", "content": [{"type": "text", "text": "Line one"}]},
    {"type": "bulletList", "content": [{"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "a", "marks": [{"type": "strong"}]}]}]}]},
]}
JIRA_ISSUE = {
    "key": "APP-7",
    "fields": {
        "summary": "Fix login",
        "status": {"name": "To Do", "statusCategory": {"key": "new"}},
        "project": {"name": "App", "key": "APP"},
        "labels": ["auth"],
        "description": ADF,
        "issuetype": {"name": "Bug"},
        "comment": {"total": 2},
        "subtasks": [{"key": "APP-8"}],
        "issuelinks": [{"type": {"name": "Blocks", "outward": "blocks"}, "outwardIssue": {"key": "APP-9", "fields": {"summary": "x"}}}],
    },
}


def jira(config: dict[str, Any] | None = None) -> JiraIntegration:
    return JiraIntegration(config or {"site_url": "https://team.atlassian.net", "email": "a@b.c", "_account": {"account_id": "acc1"}}, "tok")


async def test_jira_cloud_reads_and_writes(fake):
    rec = fake(JiraIntegration, {
        ("GET", "/rest/api/3/issue/APP-7"): JIRA_ISSUE,
        ("POST", "/rest/api/3/issue/APP-7/comment"): {"id": "c1"},
        ("GET", "/rest/api/3/issue/APP-7/transitions"): {"transitions": [
            {"id": "11", "to": {"name": "In Progress", "statusCategory": {"key": "indeterminate"}}},
            {"id": "31", "to": {"name": "Done", "statusCategory": {"key": "done"}}},
        ]},
        ("POST", "/rest/api/3/issue/APP-7/transitions"): httpx.Response(204),
        ("PUT", "/rest/api/3/issue/APP-7"): httpx.Response(204),
        ("POST", "/rest/api/3/issueLink"): httpx.Response(201),
    })
    client = jira()
    issue = await client.get_issue("APP-7")
    assert issue.title == "Fix login" and issue.status_category == "todo"
    assert issue.description == "Line one\n\n- **a**"
    assert issue.subtasks == ["APP-8"] and issue.links[0]["key"] == "APP-9"
    assert issue.extra["project_key"] == "APP" and issue.comment_count == 2

    assert await client.add_comment("APP-7", "Done **here**") == "c1"
    sent = rec.body()["body"]
    assert sent["type"] == "doc" and sent["content"][0]["content"][1]["marks"] == [{"type": "strong"}]

    option = await client.status_for_category("APP-7", "in_progress")
    assert option and option.id == "11"
    assert await client.set_status("APP-7", "11") == "To Do"  # read back after the move

    await client.update_issue("APP-7", IssueChanges(add_labels=["ui fix"], remove_labels=["auth"], assignee="me"))
    put = next(c for c in rec.calls if c.method == "PUT")
    body = json.loads(put.content)
    assert body["update"]["labels"] == [{"add": "ui-fix"}, {"remove": "auth"}]
    assert body["fields"]["assignee"] == {"accountId": "acc1"}

    await client.link_issues("APP-7", "APP-1", "blocked_by")
    link = rec.body()
    assert link["type"]["name"] == "Blocks" and link["outwardIssue"]["key"] == "APP-1" and link["inwardIssue"]["key"] == "APP-7"


async def test_jira_server_uses_v2_bearer_and_wiki(fake):
    rec = fake(JiraIntegration, {("POST", "/rest/api/2/issue/OPS-1/comment"): {"id": "9"}})
    client = JiraIntegration({"site_url": "https://jira.corp.local"}, "pat")
    assert not client.cloud and client.headers()["Authorization"] == "Bearer pat"
    await client.add_comment("OPS-1", "## Title\n- **bold** `code`")
    assert rec.body()["body"] == "h2. Title\n* *bold* {{code}}"


async def test_jira_create_picks_a_type_and_drops_estimate_when_untracked(fake):
    calls = {"n": 0}

    def create(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        body = json.loads(request.content)
        if "timetracking" in body["fields"]:
            return httpx.Response(400, json={"errors": {"timetracking": "off"}})
        assert body["fields"]["issuetype"] == {"name": "Task"} and body["fields"]["project"] == {"key": "APP"}
        return httpx.Response(201, json={"key": "APP-50"})

    fake(JiraIntegration, {
        ("GET", "/rest/api/3/project/APP"): {"issueTypes": [{"id": "1", "name": "Bug"}, {"id": "2", "name": "Task"}, {"id": "3", "name": "Sub-task", "subtask": True}]},
        ("POST", "/rest/api/3/issue"): create,
        ("GET", "/rest/api/3/issue/APP-50"): {**JIRA_ISSUE, "key": "APP-50"},
    })
    issue = await jira().create_issue(IssueDraft(project="APP", title="New", estimate_hours=3))
    assert issue.key == "APP-50" and calls["n"] == 2


async def test_read_only_account_refuses_writes():
    client = JiraIntegration({"site_url": "https://team.atlassian.net", "email": "a", "read_only": True}, "tok")
    with pytest.raises(ReadOnly):
        await client.add_comment("APP-1", "hi")


async def test_rate_limit_is_reported_with_the_providers_wait(fake):
    from rafiq_agent.integrations.base import RateLimited

    fake(JiraIntegration, {("GET", "/rest/api/3/myself"): httpx.Response(429, headers={"Retry-After": "120"})})
    with pytest.raises(RateLimited) as caught:
        await jira().verify()
    assert caught.value.retry_after == 120


# ── GitHub / GitLab ──────────────────────────────────────────────────────────────────────


async def test_github_search_create_and_sub_issue(fake):
    rec = fake(GitHubIntegration, {
        ("GET", "/search/issues"): {"items": [{"number": 3, "title": "Bug", "html_url": "https://github.com/o/r/issues/3", "state": "open", "url": "https://api.github.com/repos/o/r/issues/3"}]},
        ("POST", "/repos/o/r/issues"): {"number": 12, "id": 999},
        ("POST", "/repos/o/r/issues/3/sub_issues"): {"ok": True},
        ("GET", "/repos/o/r/issues/12"): {"number": 12, "title": "Child", "html_url": "https://github.com/o/r/issues/12", "state": "open"},
    })
    client = GitHubIntegration({"_account": {"login": "me"}}, "tok")
    found = await client.search("label:bug")
    assert found[0].key == "o/r#3"
    assert "is:issue" in rec.calls[0].url.params["q"]
    child = await client.create_issue(IssueDraft(project="o/r", title="Child", parent="o/r#3", assignee="me"))
    assert child.key == "o/r#12"
    create = next(c for c in rec.calls if c.method == "POST" and c.url.path.endswith("/repos/o/r/issues"))
    assert json.loads(create.content)["assignees"] == ["me"]
    sub = next(c for c in rec.calls if c.url.path.endswith("/sub_issues"))
    assert json.loads(sub.content) == {"sub_issue_id": 999}


def test_github_urls_and_remotes():
    assert html_url("https://api.github.com/repos/o/r/pulls/5", "PullRequest") == "https://github.com/o/r/pull/5"
    client = GitHubIntegration({}, "t")
    assert client.repo_for_remote("git@github.com:o/r.git") == "o/r"
    assert client.repo_for_remote("https://github.com/o/r") == "o/r"
    assert client.repo_for_remote("https://gitlab.com/o/r.git") is None
    gl = GitLabIntegration({"base_url": "https://git.corp.io"}, "t")
    assert gl.repo_for_remote("git@git.corp.io:group/sub/proj.git") == "group/sub/proj"


async def test_gitlab_attach_uploads_then_comments(fake):
    rec = fake(GitLabIntegration, {
        ("POST", "/projects/g%2Fp/uploads"): {"markdown": "![shot](/uploads/x/shot.png)", "full_path": "/g/p/uploads/x/shot.png"},
        ("POST", "/projects/g%2Fp/issues/4/notes"): {"id": 77},
    })
    url = await GitLabIntegration({}, "t").attach("g/p#4", "shot.png", b"png", "image/png")
    assert url == "https://gitlab.com/g/p/uploads/x/shot.png"
    assert rec.body()["body"] == "![shot](/uploads/x/shot.png)"
    assert "multipart/form-data" in rec.calls[0].headers["content-type"]


async def test_azure_creates_with_json_patch(fake):
    from rafiq_agent.integrations.providers.azure import AzureDevOpsIntegration

    rec = fake(AzureDevOpsIntegration, {
        ("POST", "/Web/_apis/wit/workitems/$Task"): {"id": 41, "fields": {"System.Title": "T", "System.State": "New", "System.TeamProject": "Web"}},
    })
    issue = await AzureDevOpsIntegration({"organization": "org"}, "pat").create_issue(IssueDraft(project="Web", title="T", issue_type="Task", labels=["a", "b"]))
    assert issue.key == "41" and issue.status_category == "todo"
    call = rec.calls[-1]
    assert call.headers["content-type"] == "application/json-patch+json"
    ops = json.loads(call.content)
    assert {"op": "add", "path": "/fields/System.Tags", "value": "a; b"} in ops


async def test_trello_completes_by_moving_to_a_done_list(fake):
    from rafiq_agent.integrations.providers.trello import TrelloIntegration

    card = {"id": "c1", "shortLink": "abc", "name": "Card", "idList": "l1", "idBoard": "b1", "url": "u"}
    rec = fake(TrelloIntegration, {
        ("GET", "/cards/abc"): card,
        ("GET", "/members/me/boards"): [{"id": "b1", "name": "Board"}],
        ("GET", "/boards/b1/lists"): [{"id": "l1", "name": "To Do"}, {"id": "l2", "name": "Doing"}, {"id": "l3", "name": "Done"}],
        ("PUT", "/cards/abc"): card,
    })
    client = TrelloIntegration({"api_key": "k"}, "tok")
    assert 'oauth_token="tok"' in client.headers()["Authorization"]
    assert await client.complete("abc") == "Done"
    assert rec.calls[-1].url.params["idList"] == "l3"


# ── Text ─────────────────────────────────────────────────────────────────────────────────


def test_markdown_and_adf_round_trip():
    text = "# Title\n\nSome **bold** and `code` and [link](https://x.y)\n\n- one\n- two\n\n```py\nprint(1)\n```"
    back = markup.adf_to_markdown(markup.markdown_to_adf(text))
    assert "# Title" in back and "**bold**" in back and "`code`" in back and "[link](https://x.y)" in back
    assert "- one" in back and "```py\nprint(1)\n```" in back


def test_wiki_and_html():
    assert markup.wiki_to_markdown("h1. T\n* a\n{{x}} [L|http://u]") == "# T\n- a\n`x` [L](http://u)"
    html = markup.markdown_to_html("## H\n\n- a\n\n**b**")
    assert html == "<h2>H</h2><ul><li>a</li></ul><p><strong>b</strong></p>"
    assert markup.html_to_markdown("<p>Hi <b>there</b></p><ul><li>x</li></ul>") == "Hi **there**\n\n- x"


# ── Watcher, channels, lifecycle ──────────────────────────────────────────────────────────


def _issue(key: str, status: str = "To Do", comments: int = 0) -> Issue:
    return Issue(key=key, id=key, title=f"T {key}", url=f"https://x/{key}", status=status, comment_count=comments)


def test_watch_diff_finds_new_moved_and_commented():
    before = {"A-1": {"status": "To Do", "comments": 1}, "A-2": {"status": "To Do", "comments": 0}}
    now = [_issue("A-1", "In Progress", 1), _issue("A-2", "To Do", 3), _issue("A-3")]
    kinds = sorted((a.kind, a.key) for a in issue_watch.diff(before, now, first=False))
    assert kinds == [("assigned", "A-3"), ("comment", "A-2"), ("status", "A-1")]
    assert issue_watch.diff({}, now, first=True) == []  # the first look only learns


def test_channels_accept_only_official_webhooks():
    channels.check_url("slack", "https://hooks.slack.com/services/T/B/x")
    channels.check_url("discord", "https://discord.com/api/webhooks/123/abc")
    channels.check_url("teams", "https://prod-11.westus.logic.azure.com:443/workflows/x")
    for kind, url in (("slack", "https://evil.com/hooks.slack.com/x"), ("discord", "http://discord.com/api/webhooks/1/a"), ("teams", "https://example.com/")):
        with pytest.raises(IntegrationError):
            channels.check_url(kind, url)
    assert channels._payload("discord", "T", "b", "https://l")["allowed_mentions"] == {"parse": []}
    assert channels._payload("teams", "T", "", None)["attachments"][0]["content"]["type"] == "AdaptiveCard"


def test_branch_names_and_closing_lines():
    assert issue_lifecycle.branch_name("APP-12", "Fix the login page!") == "rafiq/APP-12-fix-the-login-page"
    assert issue_lifecycle.branch_name("o/r#7", "إصلاح") == "rafiq/o-r-7"
    assert issue_lifecycle.closing_line("github", "o/r#7", "github", "o/r") == "Closes #7"
    assert issue_lifecycle.closing_line("linear", "ENG-3", "github", "o/r") == "Fixes ENG-3"
    assert issue_lifecycle.closing_line("jira", "APP-1", "github", "o/r") == "APP-1"


def _git(cwd: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


async def test_publishing_puts_only_the_tasks_work_on_a_branch(tmp_path):
    from rafiq_agent.core import gitops

    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    _git(repo, "config", "user.email", "u@x.y")
    _git(repo, "config", "user.name", "U")
    (repo / "a.txt").write_text("one\n")
    _git(repo, "add", ".")
    _git(repo, "commit", "-qm", "init")
    (repo / "mine.txt").write_text("the user's uncommitted work\n")  # must not travel
    base = await gitops.snapshot(repo, "base")
    (repo / "a.txt").write_text("one\ntwo\n")  # the task's change
    result = await gitops.snapshot(repo, "result")

    commit = await gitops.commit_onto_branch(repo, base, result, "rafiq/APP-1-x", "APP-1: x")
    files = _git(repo, "show", "--name-only", "--format=", commit).split()
    assert files == ["a.txt"]
    assert _git(repo, "show", "rafiq/APP-1-x:a.txt") == "one\ntwo"
    assert _git(repo, "rev-parse", "--abbrev-ref", "HEAD") == "main"  # the checkout didn't move
    assert (repo / "mine.txt").exists() and _git(repo, "diff", "--cached", "--name-only") == ""


# ── Undo and the action log ────────────────────────────────────────────────────────────


class FakeTracker(Integration):
    from rafiq_agent.integrations.base import ProviderSpec, StatusOption

    spec = ProviderSpec(id="fake", name="Fake", icon="", color="#000", docs_url="", fields=[], blurb="")
    capabilities = frozenset({"comment_edit", "update"})
    deleted: list[str] = []
    statuses = {"K-1": "To Do"}

    def headers(self) -> dict[str, str]:
        return {}

    async def verify(self):  # pragma: no cover
        raise NotImplementedError

    async def list_issues(self, query=None, limit=30, include_done=False):
        return []

    async def get_issue(self, key: str) -> Issue:
        return _issue(key, self.statuses.get(key, "To Do"))

    async def list_comments(self, key, limit=50):
        return []

    async def add_comment(self, key, body):
        return "cm1"

    async def delete_comment(self, key, comment_id):
        FakeTracker.deleted.append(comment_id)

    async def list_statuses(self, key):
        return [self.StatusOption(id="1", name="To Do", category="todo"), self.StatusOption(id="2", name="Doing", category="in_progress")]

    async def set_status(self, key, status_id):
        FakeTracker.statuses[key] = {"1": "To Do", "2": "Doing"}[status_id]
        return FakeTracker.statuses[key]

    async def complete(self, key):
        return "Done"


async def test_actions_are_recorded_and_undone(monkeypatch):
    from rafiq_agent.core import issues as svc
    from rafiq_agent.storage.db import SessionLocal, init_db
    from rafiq_agent.storage.models import IntegrationAccount

    await init_db()
    async with SessionLocal() as session:
        row = IntegrationAccount(provider="fake", name="Fake", config={})
        session.add(row)
        await session.commit()
        await session.refresh(row)
    monkeypatch.setattr(svc, "client_for", lambda r: FakeTracker({}, ""))
    client = FakeTracker({}, "")

    await svc.comment(row, client, "K-1", "hello", {"chat_id": "c"})
    await svc.set_status(row, client, "K-1", "2", {"chat_id": "c"})
    from rafiq_agent.api.integrations import actions

    log = await actions(integration_id=row.id)
    assert [a.action for a in log] == ["status", "comment"] and all(a.can_undo for a in log)
    assert await svc.undo(log[0].id)  # status back to To Do
    assert FakeTracker.statuses["K-1"] == "To Do"
    await svc.undo(log[1].id)
    assert FakeTracker.deleted == ["cm1"]
    with pytest.raises(IntegrationError):
        await svc.undo(log[1].id)  # only once


# ── Permissions ────────────────────────────────────────────────────────────────────────


async def test_creating_tasks_asks_until_always_allowed():
    from rafiq_agent.core.agent_runtime import allow_always, load_settings, permission_key, policy_decision
    from rafiq_agent.storage.db import init_db

    await init_db()
    assert permission_key("create_tasks") == "task_create"
    assert permission_key("issue_create") == "issue_write"
    assert permission_key("task_publish") == "git_publish"
    settings = await load_settings()
    assert policy_decision("create_tasks", "write", settings.permissions) == "ask"
    live = dict(settings.permissions)
    assert await allow_always("create_tasks", live) == "task_create"
    assert live["task_create"] == "auto"
    assert policy_decision("create_tasks", "write", (await load_settings()).permissions) == "allow"
    assert await allow_always("mcp__server__tool") is None  # MCP keeps its own settings

    # Put the default back for the rest of the suite.
    from rafiq_agent.core.agent_runtime import SETTINGS_KEY
    from rafiq_agent.storage.db import SessionLocal
    from rafiq_agent.storage.models import SettingsRow

    async with SessionLocal() as session:
        stored = await session.get(SettingsRow, SETTINGS_KEY)
        stored.value = {**stored.value, "permissions": {**stored.value["permissions"], "task_create": "ask"}}
        await session.commit()


async def test_device_sign_in_flow():
    from rafiq_agent.integrations import oauth

    answers = iter([
        {"error": "authorization_pending"},
        {"access_token": "gho_x", "refresh_token": "r1", "expires_in": 7200},
    ])

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/device/code"):
            assert b"client_id=cid" in request.content
            return httpx.Response(200, json={"device_code": "d", "user_code": "ABCD-1234", "verification_uri": "https://github.com/login/device", "interval": 5, "expires_in": 900})
        return httpx.Response(200, json=next(answers))

    transport = httpx.MockTransport(handler)
    started = await oauth.start("github", "cid", transport=transport)
    assert started["user_code"] == "ABCD-1234"
    assert (await oauth.poll(started["flow_id"], transport=transport))[0] == "pending"
    status, secret = await oauth.poll(started["flow_id"], transport=transport)
    assert status == "done" and oauth.access_token(secret) == "gho_x"
    assert GitHubIntegration({}, secret).headers()["Authorization"] == "Bearer gho_x"
    assert (await oauth.poll(started["flow_id"], transport=transport))[0] == "expired"  # used once
