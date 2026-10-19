"""Posting to the team's chat: Slack, Microsoft Teams and Discord incoming webhooks. The
webhook URL is a secret (anyone holding it can post), so it lives in the keychain; only
the official webhook hosts are accepted, so the URL can't be pointed anywhere else."""

import re
from typing import Any

import httpx

from rafiq_agent.i18n import tr
from rafiq_agent.integrations.base import IntegrationError

HOSTS = {
    "slack": re.compile(r"^https://hooks\.slack\.com/(services|workflows|triggers)/"),
    "discord": re.compile(r"^https://(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)/api/webhooks/\d+/"),
    "teams": re.compile(r"^https://([\w-]+\.)*(webhook\.office\.com|logic\.azure\.com|api\.powerplatform\.com|powerautomate\.com)(:443)?/"),
}
KINDS = tuple(HOSTS)
# Which events a channel can carry.
EVENTS = ("assigned", "mention", "review", "comment", "status", "task_done", "report")


def check_url(kind: str, url: str) -> None:
    pattern = HOSTS.get(kind)
    if not pattern or not pattern.match(url.strip()):
        raise IntegrationError(tr("هاد مو رابط webhook رسمي لـ {0}.", kind))


def _payload(kind: str, title: str, text: str, link: str | None) -> dict[str, Any]:
    if kind == "slack":
        head = f"*<{link}|{title}>*" if link else f"*{title}*"
        return {"text": f"{head}\n{text}".strip()[:3900]}
    if kind == "discord":
        head = f"**[{title}]({link})**" if link else f"**{title}**"
        return {"content": f"{head}\n{text}".strip()[:1990], "allowed_mentions": {"parse": []}}
    body: list[dict[str, Any]] = [{"type": "TextBlock", "text": title, "weight": "Bolder", "wrap": True}]
    if text:
        body.append({"type": "TextBlock", "text": text[:3500], "wrap": True})
    card: dict[str, Any] = {"type": "AdaptiveCard", "$schema": "http://adaptivecards.io/schemas/adaptive-card.json", "version": "1.4", "body": body}
    if link:
        card["actions"] = [{"type": "Action.OpenUrl", "title": tr("افتح"), "url": link}]
    return {"type": "message", "attachments": [{"contentType": "application/vnd.microsoft.card.adaptive", "content": card}]}


async def post(kind: str, url: str, title: str, text: str = "", link: str | None = None,
               transport: httpx.AsyncBaseTransport | None = None) -> None:
    check_url(kind, url)
    async with httpx.AsyncClient(timeout=15, transport=transport) as client:
        resp = await client.post(url, json=_payload(kind, title, text, link))
    if resp.status_code == 429:
        raise IntegrationError(tr("القناة طلبت نستنى شوي (حد الرسائل)."))
    if resp.status_code >= 400:
        raise IntegrationError(tr("القناة رفضت الرسالة ({0}).", resp.status_code))
