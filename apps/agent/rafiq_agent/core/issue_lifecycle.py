"""A task that works on a tracker issue moves the issue along with it, as the account's
settings say (core/issues.py · Lifecycle):

    start  → the issue goes to In Progress; the approved plan can be posted as a comment
    finish → the work goes on a branch named after the issue (a commit on top of the user's
             HEAD, never touching their checkout); it can be pushed and a pull request
             opened — both ask first ("git_publish") unless always allowed; a summary
             comment, the time spent, and the move to review or done follow.

Nothing here stops a task: a tracker or git failure is reported in the task's transcript
and the rest carries on."""

import re
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from rafiq_agent.core import gitops
from rafiq_agent.core import issues as svc
from rafiq_agent.core.manager import manager
from rafiq_agent.i18n import tr
from rafiq_agent.integrations.base import IntegrationError
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import Task

Permit = Callable[[str, str, dict[str, Any], str | None], Awaitable[bool]]


def _slug(text: str, limit: int = 40) -> str:
    ascii_only = re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower()
    return ascii_only[:limit].strip("-")


def branch_name(key: str, title: str) -> str:
    """rafiq/PROJ-12-fix-the-login — the key first, so trackers link the branch to the issue."""
    clean_key = re.sub(r"[^A-Za-z0-9]+", "-", key).strip("-")
    tail = _slug(title)
    return f"rafiq/{clean_key}" + (f"-{tail}" if tail else "")


def closing_line(provider: str, key: str, host_provider: str | None, repo: str | None) -> str:
    """What a pull request says so the tracker links (and, when merged, closes) the issue."""
    if provider in ("github", "gitea") and host_provider == provider and repo and key.startswith(f"{repo}#"):
        return f"Closes #{key.split('#', 1)[1]}"
    if provider == "gitlab" and host_provider == "gitlab":
        return f"Closes {key}"
    if provider == "linear":
        return f"Fixes {key}"
    return key  # Jira, YouTrack, Azure and the rest pick the key up from the text


async def _note(task_id: str, text: str, ok: bool = True) -> None:
    await manager.emit_event(task_id, "issue_update", {"text": text, "ok": ok})


async def _load(task_id: str) -> tuple[Task, Any, Any, svc.AccountSettings] | None:
    async with SessionLocal() as session:
        task = await session.get(Task, task_id)
    if not task or not task.issue or not task.issue.get("integration_id"):
        return None
    try:
        row = await svc.account(task.issue["integration_id"])
    except IntegrationError:
        return None
    return task, row, svc.client_for(row), svc.settings_of(row)


async def _save_issue(task_id: str, **values: Any) -> None:
    async with SessionLocal() as session:
        task = await session.get(Task, task_id)
        if task and task.issue:
            task.issue = {**task.issue, **values}
            await session.commit()


async def started(task_id: str) -> None:
    loaded = await _load(task_id)
    if not loaded:
        return
    task, row, client, settings = loaded
    life = settings.lifecycle
    key = task.issue["key"]
    source = {"task_id": task_id}
    if settings.read_only:
        return
    if life.comment_plan and task.plan:
        try:
            await svc.comment(row, client, key, tr("خطة رفيق لـ «{0}»:", task.title) + "\n\n" + task.plan, source)
            await _note(task_id, tr("انكتبت الخطة كتعليق على {0}", key))
        except IntegrationError as exc:
            await _note(task_id, tr("ما قدرت أكتب الخطة على {0}: {1}", key, exc), ok=False)
    if life.on_start == "in_progress":
        try:
            current = await client.get_issue(key)
            if current.status_category not in ("in_progress", "done"):
                option = await client.status_for_category(key, "in_progress")
                if option:
                    status = await svc.set_status(row, client, key, option.id, source)
                    await _note(task_id, tr("{0} صارت «{1}»", key, status))
        except IntegrationError as exc:
            await _note(task_id, tr("ما قدرت أنقل {0} لقيد التنفيذ: {1}", key, exc), ok=False)


async def _publish(task: Task, row: Any, life: svc.Lifecycle, report: str, permit: Permit) -> dict[str, Any]:
    """Branch, push, pull request — as far as the settings go and the user allows."""
    out: dict[str, Any] = {}
    info = task.git or {}
    if life.publish == "none" or not info.get("repo") or not info.get("base") or not info.get("result"):
        return out
    if info.get("state") in ("empty", "error", "reverted"):
        return out
    repo = Path(info["repo"])
    key, title = task.issue["key"], task.issue.get("title") or task.title
    branch = branch_name(key, title)
    if await gitops.branch_exists(repo, branch):
        branch = f"{branch}-{task.id[:6]}"
    message = f"{key}: {title}\n\n{report.strip()[:3000]}".strip()
    try:
        commit = await gitops.commit_onto_branch(repo, info["base"], info["result"], branch, message)
    except gitops.GitError as exc:
        await _note(task.id, tr("ما قدرت أعمل فرع للشغل: {0}", exc), ok=False)
        return out
    out.update(branch=branch, commit=commit)
    await _note(task.id, tr("الشغل صار على الفرع {0}", branch))
    if life.publish == "commit":
        return out

    remote = await gitops.remote_url(repo)
    if not remote:
        await _note(task.id, tr("المستودع ما إله remote، فما في مكان أدفع عليه الفرع."), ok=False)
        return out
    host_row, host_client, host_repo = None, None, None
    if life.publish == "pull_request":
        for candidate in await svc.accounts():
            client = svc.client_for(candidate)
            if client.supports("pull_request") and (found := client.repo_for_remote(remote)):
                host_row, host_client, host_repo = candidate, client, found
                break
    base_branch = await gitops.default_branch(repo) or "main"
    wants_pr = life.publish == "pull_request" and host_client is not None
    preview = tr("دفع الفرع {0} لـ {1}", branch, remote) + (
        "\n" + tr("وفتح طلب دمج على {0} ← {1}", host_repo, base_branch) if wants_pr else ""
    ) + f"\n\n{message[:1200]}"
    if not await permit("task_publish", "write", {"branch": branch, "remote": remote, "pull_request": wants_pr}, preview):
        await _note(task.id, tr("ما انرفع الفرع (ما وافقت). فيك ترفعه بإيدك: git push -u origin {0}", branch), ok=False)
        return out
    try:
        await gitops.push_branch(repo, branch)
        out["pushed"] = True
        await _note(task.id, tr("انرفع الفرع {0}", branch))
    except gitops.GitError as exc:
        await _note(task.id, tr("ما انرفع الفرع: {0}", str(exc)[:300]), ok=False)
        return out
    if life.publish == "pull_request" and host_client is None:
        await _note(task.id, tr("ما في حساب مربوط بيستضيف هالمستودع ({0}) لأفتح طلب دمج.", remote), ok=False)
        return out
    if wants_pr:
        body = "\n\n".join(
            part for part in (
                report.strip()[:6000],
                closing_line(task.issue.get("provider", ""), key, host_row.provider, host_repo),
                tr("— من مهمة رفيق «{0}»", task.title),
            ) if part
        )
        try:
            pr = await host_client.open_pull_request(host_repo, branch, base_branch, f"{key}: {title}"[:240], body)
            await svc.record(host_row, f"{host_repo}", "pull_request", pr.title, url=pr.url, source={"task_id": task.id})
            out["pr_url"] = pr.url
            await _note(task.id, tr("انفتح طلب الدمج: {0}", pr.url))
        except IntegrationError as exc:
            await _note(task.id, tr("ما انفتح طلب الدمج: {0}", exc), ok=False)
    return out


async def finished(task_id: str, outcome: str, report: str, seconds: float, permit: Permit) -> None:
    """After the task's git work is settled and before its status changes."""
    if outcome != "completed":
        return
    loaded = await _load(task_id)
    if not loaded:
        return
    task, row, client, settings = loaded
    life = settings.lifecycle
    key = task.issue["key"]
    source = {"task_id": task_id}

    published = await _publish(task, row, life, report, permit)
    if published:
        await _save_issue(task_id, **published)
    if settings.read_only:
        return

    if life.comment_summary:
        lines = [tr("✅ رفيق خلّص «{0}»", task.title), "", report.strip()[:8000] or tr("(ما في تقرير)")]
        if published.get("pr_url"):
            lines += ["", tr("طلب الدمج: {0}", published["pr_url"])]
        elif published.get("branch"):
            lines += ["", tr("الفرع: {0}", published["branch"])]
        try:
            await svc.comment(row, client, key, "\n".join(lines), source)
            await _note(task_id, tr("انكتب ملخص الشغل على {0}", key))
        except IntegrationError as exc:
            await _note(task_id, tr("ما قدرت أكتب الملخص على {0}: {1}", key, exc), ok=False)

    if life.log_work and client.supports("worklog") and seconds >= 60:
        try:
            await svc.log_work(row, client, key, int(seconds), tr("مهمة رفيق «{0}»", task.title), source)
            await _note(task_id, tr("انسجّل {0} دقيقة على {1}", round(seconds / 60), key))
        except IntegrationError as exc:
            await _note(task_id, tr("ما قدرت أسجّل الوقت: {0}", exc), ok=False)

    if life.on_finish != "none":
        try:
            if life.on_finish == "done":
                status = await svc.complete(row, client, key, source)
            else:
                option = await client.status_for_category(key, "in_progress", prefer=life.review_status)
                status = None
                if option and life.review_status.lower() in option.name.lower():
                    status = await svc.set_status(row, client, key, option.id, source)
            if status:
                await _note(task_id, tr("{0} صارت «{1}»", key, status))
        except IntegrationError as exc:
            await _note(task_id, tr("ما قدرت أغيّر حالة {0}: {1}", key, exc), ok=False)

