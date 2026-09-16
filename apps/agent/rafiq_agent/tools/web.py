"""Reading the web: `web_fetch` turns a page into readable text, `web_search` asks a search
service the user configured (Brave, Tavily, or their own SearXNG — official APIs only).

Fetching refuses local and private addresses, so a prompt can't point the agent at the
user's router, other local services, or Rafiq's own API.
"""

import asyncio
import contextlib
import io
import ipaddress
import re
import socket
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx

from rafiq_agent.storage.secrets import get_named_secret
from rafiq_agent.tools.base import Tool, ToolResult

MAX_BYTES = 3_000_000
DEFAULT_CHARS = 20_000
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Rafiq/1.0 (+https://github.com/AhmadALSaffan)"
SEARCH_KEY = "web-search:{provider}"


def search_key_name(provider: str) -> str:
    return SEARCH_KEY.format(provider=provider)


class _Text(HTMLParser):
    """HTML → plain text with a little structure: headings, list items, paragraphs, links."""

    SKIP = {"script", "style", "noscript", "svg", "template", "iframe", "head"}
    BLOCK = {"p", "div", "section", "article", "main", "header", "footer", "nav", "br", "tr", "table",
             "ul", "ol", "pre", "blockquote", "form", "aside", "figure", "hr"}

    def __init__(self, base: str) -> None:
        super().__init__(convert_charrefs=True)
        self.base = base
        self.parts: list[str] = []
        self.links: list[tuple[str, str]] = []
        self.title = ""
        self._skip = 0
        self._in_title = False
        self._href: str | None = None
        self._link_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self.SKIP:
            self._skip += 1
        elif tag == "title":
            self._in_title = True
        if self._skip:
            return
        if tag in self.BLOCK:
            self.parts.append("\n")
        elif tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self.parts.append("\n\n" + "#" * int(tag[1]) + " ")
        elif tag == "li":
            self.parts.append("\n- ")
        elif tag == "a":
            href = dict(attrs).get("href")
            if href and not href.startswith(("javascript:", "#", "mailto:")):
                self._href = urljoin(self.base, href)
                self._link_text = []

    def handle_endtag(self, tag: str) -> None:
        if tag in self.SKIP and self._skip:
            self._skip -= 1
        elif tag == "title":
            self._in_title = False
        elif tag == "a" and self._href:
            text = " ".join("".join(self._link_text).split())
            if text and len(self.links) < 60:
                self.links.append((text[:80], self._href))
            self._href = None
        elif tag in {"h1", "h2", "h3", "h4", "h5", "h6", "p"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        if self._skip:
            return
        self.parts.append(data)
        if self._href:
            self._link_text.append(data)

    def text(self) -> str:
        joined = "".join(self.parts)
        joined = re.sub(r"[ \t\r\f\v]+", " ", joined)
        joined = re.sub(r"\n\s*\n\s*(\n\s*)+", "\n\n", joined)
        return "\n".join(line.strip() for line in joined.splitlines()).strip()


async def _public_only(url: str) -> str | None:
    """Why this URL can't be fetched, or None when it's a public http(s) address."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return "بس روابط http و https."
    host = parsed.hostname
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, parsed.port or 443, type=socket.SOCK_STREAM)
    except OSError:
        return f"ما قدرت أوصل للعنوان {host}."
    for info in infos:
        address = ipaddress.ip_address(info[4][0].split("%")[0])
        if address.is_private or address.is_loopback or address.is_link_local or address.is_reserved or address.is_multicast:
            return f"العنوان {host} محلي أو خاص — ما بفتح عناوين الشبكة الداخلية."
    return None


def _pdf_text(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    return "\n\n".join((page.extract_text() or "") for page in reader.pages[:50])


class WebFetchTool(Tool):
    name = "web_fetch"
    category = "exec"
    description = (
        "افتح صفحة ويب (أو ملف PDF/نص على الويب) واقرأ محتواها كنص مرتب مع روابطها. استخدمها لقراءة "
        "التوثيق، المقالات، أو صفحة لقيتها بـ web_search."
    )
    parameters = {
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "رابط http أو https"},
            "max_chars": {"type": "integer", "description": f"أقصى طول للنص (الافتراضي {DEFAULT_CHARS})"},
        },
        "required": ["url"],
    }

    async def run(self, args: dict[str, Any]) -> ToolResult:
        url = str(args.get("url", "")).strip()
        limit = min(max(int(args.get("max_chars") or DEFAULT_CHARS), 1000), 100_000)
        refusal = await _public_only(url)
        if refusal:
            return ToolResult(ok=False, output=refusal)
        try:
            async with httpx.AsyncClient(
                follow_redirects=True, timeout=25, headers={"User-Agent": USER_AGENT}
            ) as client, client.stream("GET", url) as response:
                final = str(response.url)
                if final != url and (refusal := await _public_only(final)):
                    return ToolResult(ok=False, output=refusal)
                chunks, size = [], 0
                async for chunk in response.aiter_bytes():
                    chunks.append(chunk)
                    size += len(chunk)
                    if size > MAX_BYTES:
                        break
                body = b"".join(chunks)[:MAX_BYTES]
                status, kind = response.status_code, response.headers.get("content-type", "")
                encoding = response.encoding or "utf-8"
        except httpx.HTTPError as exc:
            return ToolResult(ok=False, output=f"ما قدرت أفتح الرابط: {exc}")

        head = f"{final} — HTTP {status}"
        if "pdf" in kind or final.lower().endswith(".pdf"):
            try:
                text = await asyncio.to_thread(_pdf_text, body)
            except Exception as exc:  # noqa: BLE001 - a broken PDF is reported, not raised
                return ToolResult(ok=False, output=f"{head}\nما قدرت أقرأ الـ PDF: {exc}")
            return ToolResult(ok=status < 400, output=f"{head}\n\n{text[:limit]}")
        decoded = body.decode(encoding, errors="replace")
        if "html" in kind or decoded.lstrip()[:200].lower().startswith(("<!doctype", "<html")):
            parser = _Text(final)
            with contextlib.suppress(Exception):
                parser.feed(decoded)
            text = parser.text()
            links = "\n".join(f"[{i}] {t} — {u}" for i, (t, u) in enumerate(parser.links, 1))
            clipped = text[:limit] + ("\n… (مقطوع)" if len(text) > limit else "")
            title = " ".join(parser.title.split())
            out = f"{head}\n# {title}\n\n{clipped}" + (f"\n\nروابط:\n{links}" if links else "")
            return ToolResult(ok=status < 400, output=out)
        if kind.startswith(("text/", "application/json", "application/xml")) or not kind:
            return ToolResult(ok=status < 400, output=f"{head}\n\n{decoded[:limit]}")
        return ToolResult(ok=False, output=f"{head}\nنوع المحتوى {kind} ({len(body)} بايت) — مو نص بقدر اقراه.")


class WebSearchTool(Tool):
    name = "web_search"
    category = "exec"
    description = (
        "دوّر على الويب وارجع بنتائج (عنوان، رابط، مقتطف). بعدها افتح الأنسب بـ web_fetch لتقرأه كامل."
    )
    parameters = {
        "type": "object",
        "properties": {
            "query": {"type": "string"},
            "count": {"type": "integer", "description": "عدد النتائج (1-10، الافتراضي 5)"},
        },
        "required": ["query"],
    }

    def __init__(self, provider: str, searxng_url: str | None = None) -> None:
        self.provider = provider
        self.searxng_url = (searxng_url or "").rstrip("/")

    async def run(self, args: dict[str, Any]) -> ToolResult:
        query = str(args.get("query", "")).strip()
        count = min(max(int(args.get("count") or 5), 1), 10)
        if not query:
            return ToolResult(ok=False, output="اكتب شو بدك تدوّر.")
        try:
            results = await self._search(query, count)
        except httpx.HTTPStatusError as exc:
            return ToolResult(ok=False, output=f"خدمة البحث رفضت الطلب (HTTP {exc.response.status_code}).")
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            return ToolResult(ok=False, output=f"ما قدرت أبحث: {exc}")
        if not results:
            return ToolResult(ok=True, output="ما في نتائج.")
        lines = [f"{i}. {r['title']}\n   {r['url']}\n   {r['snippet']}" for i, r in enumerate(results, 1)]
        return ToolResult(ok=True, output="\n".join(lines))

    async def _search(self, query: str, count: int) -> list[dict[str, str]]:
        async with httpx.AsyncClient(timeout=20, headers={"User-Agent": USER_AGENT}) as client:
            if self.provider == "brave":
                key = get_named_secret(search_key_name("brave")) or ""
                response = await client.get(
                    "https://api.search.brave.com/res/v1/web/search",
                    params={"q": query, "count": count},
                    headers={"X-Subscription-Token": key, "Accept": "application/json"},
                )
                response.raise_for_status()
                items = response.json().get("web", {}).get("results", [])
                return [{"title": i.get("title", ""), "url": i.get("url", ""), "snippet": _plain(i.get("description", ""))} for i in items][:count]
            if self.provider == "tavily":
                key = get_named_secret(search_key_name("tavily")) or ""
                response = await client.post(
                    "https://api.tavily.com/search",
                    json={"query": query, "max_results": count, "api_key": key},
                    headers={"Authorization": f"Bearer {key}"},
                )
                response.raise_for_status()
                items = response.json().get("results", [])
                return [{"title": i.get("title", ""), "url": i.get("url", ""), "snippet": _plain(i.get("content", ""))[:400]} for i in items][:count]
            if self.provider == "searxng" and self.searxng_url:
                response = await client.get(f"{self.searxng_url}/search", params={"q": query, "format": "json"})
                response.raise_for_status()
                items = response.json().get("results", [])
                return [{"title": i.get("title", ""), "url": i.get("url", ""), "snippet": _plain(i.get("content", ""))[:400]} for i in items][:count]
        raise ValueError("خدمة البحث مو مضبوطة من الإعدادات.")


def _plain(html: str) -> str:
    return " ".join(re.sub(r"<[^>]+>", "", html or "").split())


def search_tool(settings: Any) -> WebSearchTool | None:
    """The search tool, if the user set a service up (and gave it a key where one's needed)."""
    provider = settings.web_search_provider
    if provider in ("brave", "tavily") and get_named_secret(search_key_name(provider)):
        return WebSearchTool(provider)
    if provider == "searxng" and settings.searxng_url:
        return WebSearchTool(provider, settings.searxng_url)
    return None
