"""A chat as one self-contained HTML file: messages, tool cards, task references.

Made for sharing with someone who doesn't have Rafiq: no scripts, no external assets, the
app's own colours in both themes, right-to-left when the content is Arabic. Markdown is
rendered with markdown-it; everything else is escaped.
"""

import html
import json
from datetime import datetime
from typing import Any

from markdown_it import MarkdownIt

_md = MarkdownIt("commonmark", {"html": False, "linkify": False, "typographer": False}).enable("table").enable("strikethrough")

_CSS = """
:root{--bg:#f7f4ee;--surface:#fffdf9;--surface-2:#f1ede6;--ink:#1c1915;--muted:#6e675d;--line:#e5dfd4;--accent:#d97a26;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#100f0d;--surface:#1c1916;--surface-2:#242019;--ink:#f2ede5;--muted:#8f867a;--line:#2b2722;--accent:#e68835;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.7 "IBM Plex Sans Arabic","Segoe UI",system-ui,sans-serif}
.wrap{max-width:820px;margin:0 auto;padding:40px 20px 80px}header{margin-bottom:28px;border-bottom:1px solid var(--line);padding-bottom:16px}
h1{font-size:24px;margin:0 0 6px}.meta{color:var(--muted);font-size:13px}.msg{margin:22px 0}
.user{background:var(--surface-2);border-radius:16px;padding:12px 16px;max-width:85%;margin-inline-start:auto;white-space:pre-wrap}
.who{font-size:12px;color:var(--muted);margin-bottom:6px}.assistant{max-width:100%}
.card{border:1px solid var(--line);border-radius:12px;background:var(--surface);margin:10px 0;overflow:hidden;font-size:14px}
.card .head{display:flex;justify-content:space-between;gap:12px;padding:8px 14px;background:var(--surface-2);font-family:Consolas,ui-monospace,monospace;font-size:12px}
.card .ok{color:#2f9e5b}.card .bad{color:#c0392b}.card pre{margin:0;padding:10px 14px;white-space:pre-wrap;font-size:12.5px;direction:ltr;text-align:left;max-height:320px;overflow:auto}
.perm{border-color:var(--accent)}.task{display:flex;justify-content:space-between;padding:8px 14px;border-top:1px solid var(--line)}
pre code,code{font-family:Consolas,ui-monospace,monospace;font-size:.92em}pre{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 14px;overflow:auto;direction:ltr;text-align:left}
code{background:var(--surface-2);padding:1px 5px;border-radius:5px}table{border-collapse:collapse}td,th{border:1px solid var(--line);padding:6px 10px}
img{max-width:100%;border-radius:10px}footer{margin-top:40px;color:var(--muted);font-size:12px;border-top:1px solid var(--line);padding-top:12px}
"""


def _is_arabic(text: str) -> bool:
    return any("؀" <= ch <= "ۿ" for ch in text[:400])


def _part(part: dict[str, Any]) -> str:
    kind = part.get("kind")
    if kind == "text":
        return _md.render(str(part.get("text", "")))
    if kind == "tool":
        ok = part.get("ok")
        status = "" if ok is None else ('<span class="ok">✓</span>' if ok else '<span class="bad">✗</span>')
        args = json.dumps(part.get("args", {}), ensure_ascii=False)
        output = html.escape(str(part.get("output") or ""))[:4000]
        return (
            f'<div class="card"><div class="head"><span>{html.escape(str(part.get("tool", "")))}</span>{status}</div>'
            f"<pre>{html.escape(args)}</pre>{f'<pre>{output}</pre>' if output else ''}</div>"
        )
    if kind == "permission":
        call = part.get("call") or {}
        resolution = html.escape(str(part.get("resolution", "")))
        return (
            f'<div class="card perm"><div class="head"><span>{html.escape(str(call.get("tool", "")))}</span>'
            f"<span>{resolution}</span></div><pre>{html.escape(json.dumps(call.get('args', {}), ensure_ascii=False))}</pre></div>"
        )
    if kind == "task":
        return f'<div class="card"><div class="task"><span>{html.escape(str(part.get("title", "")))}</span><span class="meta">task</span></div></div>'
    return ""


def render(title: str, messages: list[dict[str, Any]], model_names: dict[str, str] | None = None, exported_at: datetime | None = None) -> str:
    """`messages` are dicts with role, content, parts, created_at, model_id."""
    names = model_names or {}
    sample = " ".join(str(m.get("content") or "") for m in messages[:3]) or title
    direction = "rtl" if _is_arabic(title + sample) else "ltr"
    body = []
    for m in messages:
        when = m.get("created_at")
        stamp = when.strftime("%Y-%m-%d %H:%M") if isinstance(when, datetime) else html.escape(str(when or ""))
        if m.get("role") == "user":
            body.append(f'<div class="msg"><div class="user">{html.escape(str(m.get("content") or ""))}</div><div class="meta" style="text-align:end">{stamp}</div></div>')
            continue
        parts = m.get("parts") or ([{"kind": "text", "text": m.get("content") or ""}] if m.get("content") else [])
        who = html.escape(names.get(str(m.get("model_id") or ""), ""))
        body.append(f'<div class="msg assistant"><div class="who">{who} · {stamp}</div>{"".join(_part(p) for p in parts)}</div>')
    stamp = (exported_at or datetime.now()).strftime("%Y-%m-%d %H:%M")
    return (
        f'<!doctype html><html lang="{"ar" if direction == "rtl" else "en"}" dir="{direction}"><head><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(title)}</title><style>{_CSS}</style></head>'
        f'<body><div class="wrap"><header><h1>{html.escape(title)}</h1><div class="meta">Rafiq · {stamp}</div></header>'
        f'{"".join(body)}<footer>Exported from Rafiq</footer></div></body></html>'
    )
