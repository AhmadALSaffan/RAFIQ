"""Text between Rafiq (Markdown everywhere) and the trackers that use something else:
Atlassian Document Format (Jira Cloud), Jira wiki markup (Jira Server / Data Center),
and HTML (Azure DevOps, Plane, Asana's html_notes). The aim is faithful enough for
issues and comments — paragraphs, headings, lists, code, links, emphasis, mentions,
images — not a full renderer."""

import html
import re
from typing import Any

# ── ADF → Markdown ─────────────────────────────────────────────────────────────────────


def _marks(text: str, marks: list[dict[str, Any]] | None) -> str:
    for mark in marks or []:
        kind = mark.get("type")
        if kind == "strong":
            text = f"**{text}**"
        elif kind == "em":
            text = f"*{text}*"
        elif kind == "code":
            text = f"`{text}`"
        elif kind == "strike":
            text = f"~~{text}~~"
        elif kind == "link":
            text = f"[{text}]({(mark.get('attrs') or {}).get('href', '')})"
    return text


def _inline(nodes: list[dict[str, Any]] | None) -> str:
    out = []
    for node in nodes or []:
        kind = node.get("type")
        attrs = node.get("attrs") or {}
        if kind == "text":
            out.append(_marks(node.get("text", ""), node.get("marks")))
        elif kind == "hardBreak":
            out.append("\n")
        elif kind == "mention":
            out.append(attrs.get("text") or f"@{attrs.get('id', '')}")
        elif kind == "emoji":
            out.append(attrs.get("text") or attrs.get("shortName", ""))
        elif kind == "inlineCard":
            out.append(attrs.get("url", ""))
        elif kind == "status":
            out.append(f"[{attrs.get('text', '')}]")
        elif kind == "date":
            out.append(str(attrs.get("timestamp", "")))
        else:
            out.append(_inline(node.get("content")))
    return "".join(out)


def _block(node: dict[str, Any], depth: int = 0) -> str:
    kind = node.get("type")
    attrs = node.get("attrs") or {}
    content = node.get("content") or []
    if kind == "paragraph":
        return _inline(content)
    if kind == "heading":
        return "#" * int(attrs.get("level", 1)) + " " + _inline(content)
    if kind == "codeBlock":
        return f"```{attrs.get('language') or ''}\n{_inline(content)}\n```"
    if kind == "blockquote":
        return "\n".join("> " + line for line in _blocks(content).splitlines())
    if kind == "rule":
        return "---"
    if kind in ("bulletList", "orderedList"):
        lines = []
        for i, item in enumerate(content, start=1):
            bullet = f"{i}." if kind == "orderedList" else "-"
            body = _blocks(item.get("content") or [], depth + 1).splitlines() or [""]
            lines.append("  " * depth + f"{bullet} {body[0]}")
            lines.extend("  " * depth + "  " + rest for rest in body[1:])
        return "\n".join(lines)
    if kind == "taskList":
        return "\n".join(
            f"- [{'x' if (i.get('attrs') or {}).get('state') == 'DONE' else ' '}] {_inline(i.get('content'))}"
            for i in content
        )
    if kind in ("mediaSingle", "mediaGroup"):
        names = [((m.get("attrs") or {}).get("alt") or (m.get("attrs") or {}).get("id") or "") for m in content]
        return " ".join(f"![{n}]" for n in names)
    if kind == "panel":
        return "> " + _blocks(content).replace("\n", "\n> ")
    if kind == "table":
        rows = []
        for r, row in enumerate(content):
            cells = [_blocks(c.get("content") or []).replace("\n", " ") for c in row.get("content") or []]
            rows.append("| " + " | ".join(cells) + " |")
            if r == 0:
                rows.append("|" + "---|" * len(cells))
        return "\n".join(rows)
    return _blocks(content, depth) if content else _inline([node])


def _blocks(nodes: list[dict[str, Any]], depth: int = 0) -> str:
    return "\n\n".join(b for b in (_block(n, depth) for n in nodes) if b is not None)


def adf_to_markdown(doc: Any) -> str:
    if isinstance(doc, str):
        return doc
    if not isinstance(doc, dict):
        return ""
    return _blocks(doc.get("content") or []).strip()


# ── Markdown → ADF ─────────────────────────────────────────────────────────────────────

_INLINE = re.compile(r"(\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(?<![*\w])\*([^*\n]+)\*(?!\*)|~~(.+?)~~)")


def _text_nodes(text: str) -> list[dict[str, Any]]:
    nodes: list[dict[str, Any]] = []
    pos = 0
    for m in _INLINE.finditer(text):
        if m.start() > pos:
            nodes.append({"type": "text", "text": text[pos : m.start()]})
        if m.group(2) is not None:
            nodes.append({"type": "text", "text": m.group(2), "marks": [{"type": "strong"}]})
        elif m.group(3) is not None:
            nodes.append({"type": "text", "text": m.group(3), "marks": [{"type": "code"}]})
        elif m.group(4) is not None:
            nodes.append({"type": "text", "text": m.group(4), "marks": [{"type": "link", "attrs": {"href": m.group(5)}}]})
        elif m.group(6) is not None:
            nodes.append({"type": "text", "text": m.group(6), "marks": [{"type": "em"}]})
        elif m.group(7) is not None:
            nodes.append({"type": "text", "text": m.group(7), "marks": [{"type": "strike"}]})
        pos = m.end()
    if pos < len(text):
        nodes.append({"type": "text", "text": text[pos:]})
    return [n for n in nodes if n.get("text")]


def _paragraph(lines: list[str]) -> dict[str, Any]:
    content: list[dict[str, Any]] = []
    for i, line in enumerate(lines):
        if i:
            content.append({"type": "hardBreak"})
        content.extend(_text_nodes(line))
    return {"type": "paragraph", "content": content}


_LIST = re.compile(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$")


def markdown_to_adf(text: str) -> dict[str, Any]:
    lines = (text or "").replace("\r\n", "\n").split("\n")
    blocks: list[dict[str, Any]] = []
    para: list[str] = []
    i = 0

    def flush() -> None:
        if para:
            blocks.append(_paragraph(para))
            para.clear()

    while i < len(lines):
        line = lines[i]
        fence = re.match(r"^```(\w*)\s*$", line)
        if fence:
            flush()
            code = []
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                code.append(lines[i])
                i += 1
            node: dict[str, Any] = {"type": "codeBlock", "content": [{"type": "text", "text": "\n".join(code)}] if code else []}
            if fence.group(1):
                node["attrs"] = {"language": fence.group(1)}
            blocks.append(node)
            i += 1
            continue
        heading = re.match(r"^(#{1,6})\s+(.*)$", line)
        if heading:
            flush()
            blocks.append({"type": "heading", "attrs": {"level": len(heading.group(1))}, "content": _text_nodes(heading.group(2))})
            i += 1
            continue
        if re.match(r"^\s*(-{3,}|\*{3,})\s*$", line):
            flush()
            blocks.append({"type": "rule"})
            i += 1
            continue
        if line.startswith(">"):
            flush()
            quoted = []
            while i < len(lines) and lines[i].startswith(">"):
                quoted.append(lines[i][1:].lstrip())
                i += 1
            blocks.append({"type": "blockquote", "content": [_paragraph(quoted)]})
            continue
        item = _LIST.match(line)
        if item:
            flush()
            ordered = item.group(2)[0].isdigit()
            items = []
            while i < len(lines) and (m := _LIST.match(lines[i])) and m.group(2)[0].isdigit() == ordered:
                body = m.group(3)
                task = re.match(r"^\[( |x|X)\]\s+(.*)$", body)
                items.append({"type": "listItem", "content": [_paragraph([task.group(2) if task else body])]})
                i += 1
            blocks.append({"type": "orderedList" if ordered else "bulletList", "content": items})
            continue
        if not line.strip():
            flush()
        else:
            para.append(line)
        i += 1
    flush()
    return {"type": "doc", "version": 1, "content": blocks or [{"type": "paragraph", "content": []}]}


# ── Jira wiki markup (Server / Data Center) ───────────────────────────────────────────


def markdown_to_wiki(text: str) -> str:
    out = []
    in_code = False
    for line in (text or "").replace("\r\n", "\n").split("\n"):
        fence = re.match(r"^```(\w*)\s*$", line)
        if fence:
            out.append("{code}" if in_code else (f"{{code:{fence.group(1)}}}" if fence.group(1) else "{code}"))
            in_code = not in_code
            continue
        if in_code:
            out.append(line)
            continue
        if h := re.match(r"^(#{1,6})\s+(.*)$", line):
            line = f"h{len(h.group(1))}. {h.group(2)}"
        elif li := _LIST.match(line):
            depth = len(li.group(1)) // 2 + 1
            line = ("#" if li.group(2)[0].isdigit() else "*") * depth + " " + li.group(3)
        elif line.startswith(">"):
            line = "bq. " + line[1:].lstrip()
        line = re.sub(r"\*\*(.+?)\*\*", r"*\1*", line)
        line = re.sub(r"`([^`]+)`", r"{{\1}}", line)
        line = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", r"[\1|\2]", line)
        line = re.sub(r"~~(.+?)~~", r"-\1-", line)
        out.append(line)
    return "\n".join(out)


def wiki_to_markdown(text: str | None) -> str:
    if not text:
        return ""
    out = []
    in_code = False
    for line in text.replace("\r\n", "\n").split("\n"):
        if re.match(r"^\{(code|noformat)(:[^}]*)?\}\s*$", line.strip()):
            lang = re.match(r"^\{code:([\w+-]+)", line.strip())
            out.append("```" if in_code else f"```{lang.group(1) if lang else ''}")
            in_code = not in_code
            continue
        if in_code:
            out.append(line)
            continue
        if h := re.match(r"^h([1-6])\.\s+(.*)$", line):
            line = "#" * int(h.group(1)) + " " + h.group(2)
        elif li := re.match(r"^([*#]+)\s+(.*)$", line):
            marks = li.group(1)
            line = "  " * (len(marks) - 1) + ("1." if marks[-1] == "#" else "-") + " " + li.group(2)
        elif line.startswith("bq. "):
            line = "> " + line[4:]
        line = re.sub(r"\{\{(.+?)\}\}", r"`\1`", line)
        line = re.sub(r"\[([^|\]]+)\|([^\]]+)\]", r"[\1](\2)", line)
        line = re.sub(r"\[~([^\]]+)\]", r"@\1", line)
        line = re.sub(r"(?<![*\w])\*([^*\n]+)\*(?!\w)", r"**\1**", line)
        out.append(line)
    return "\n".join(out)


# ── HTML ───────────────────────────────────────────────────────────────────────────────


def html_to_markdown(text: str | None) -> str:
    if not text:
        return ""
    s = text.replace("\r\n", "\n")
    s = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", "", s)
    s = re.sub(r"(?is)<pre[^>]*>(?:<code[^>]*>)?(.*?)(?:</code>)?</pre>", lambda m: f"\n```\n{m.group(1)}\n```\n", s)
    s = re.sub(r"(?is)<h([1-6])[^>]*>(.*?)</h\1>", lambda m: "\n" + "#" * int(m.group(1)) + " " + m.group(2) + "\n", s)
    s = re.sub(r"(?is)<(b|strong)>(.*?)</\1>", r"**\2**", s)
    s = re.sub(r"(?is)<(i|em)>(.*?)</\1>", r"*\2*", s)
    s = re.sub(r"(?is)<code>(.*?)</code>", r"`\1`", s)
    s = re.sub(r'(?is)<a [^>]*href="([^"]+)"[^>]*>(.*?)</a>', r"[\2](\1)", s)
    s = re.sub(r'(?is)<img [^>]*src="([^"]+)"[^>]*>', r"![](\1)", s)
    s = re.sub(r"(?is)<li[^>]*>(.*?)</li>", r"\n- \1", s)
    s = re.sub(r"(?is)<br\s*/?>", "\n", s)
    s = re.sub(r"(?is)</(p|div|ul|ol|blockquote|tr)>", "\n\n", s)
    s = re.sub(r"(?s)<[^>]+>", "", s)
    s = html.unescape(s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def markdown_to_html(text: str) -> str:
    """Enough HTML for a tracker that stores rich text: paragraphs, headings, lists, code,
    emphasis and links."""
    out: list[str] = []
    lines = (text or "").replace("\r\n", "\n").split("\n")
    i = 0
    para: list[str] = []

    def inline(raw: str) -> str:
        s = html.escape(raw)
        s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
        s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
        s = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", r'<a href="\2">\1</a>', s)
        s = re.sub(r"(?<![*\w])\*([^*\n]+)\*(?!\*)", r"<em>\1</em>", s)
        return s

    def flush() -> None:
        if para:
            out.append("<p>" + "<br>".join(inline(p) for p in para) + "</p>")
            para.clear()

    while i < len(lines):
        line = lines[i]
        if line.startswith("```"):
            flush()
            code = []
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                code.append(lines[i])
                i += 1
            out.append("<pre><code>" + html.escape("\n".join(code)) + "</code></pre>")
            i += 1
            continue
        if h := re.match(r"^(#{1,6})\s+(.*)$", line):
            flush()
            out.append(f"<h{len(h.group(1))}>{inline(h.group(2))}</h{len(h.group(1))}>")
        elif _LIST.match(line):
            flush()
            ordered = _LIST.match(line).group(2)[0].isdigit()  # type: ignore[union-attr]
            items = []
            while i < len(lines) and (m := _LIST.match(lines[i])):
                items.append(f"<li>{inline(m.group(3))}</li>")
                i += 1
            tag = "ol" if ordered else "ul"
            out.append(f"<{tag}>{''.join(items)}</{tag}>")
            continue
        elif not line.strip():
            flush()
        else:
            para.append(line)
        i += 1
    flush()
    return "".join(out)
