"""Office documents written the way an Arabic reader expects them.

`word_write` turns Markdown into a .docx: Arabic paragraphs run right to left with an
Arabic font, tables read from the right, list bullets sit on the right, and English
stays left to right inside them. The file is put together from its XML parts directly —
no library is needed, and every direction flag is set exactly where Word looks for it.
"""

import io
import re
import zipfile
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal
from xml.sax.saxutils import escape

from rafiq_agent.tools.base import Tool, ToolResult
from rafiq_agent.tools.filesystem import PathEscapeError, _resolve

Direction = Literal["auto", "rtl", "ltr"]

ARABIC_RANGE = "\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF"
ARABIC = re.compile(f"[{ARABIC_RANGE}]")
LATIN = re.compile(r"[A-Za-z]")
# A stretch of Latin words (with what usually sits between them) inside Arabic text: it gets
# its own left-to-right run, so "Python 3.12" doesn't come out as "3.12 Python".
LATIN_SPAN = re.compile(r"[A-Za-z][\w.+#/@:'\-]*(?:[ \t]+[A-Za-z0-9][\w.+#/@:'\-]*)*")
INLINE = re.compile(r"(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|\[[^\]]+\]\([^)\s]+\))")

FONTS = ("Sakkal Majalla", "Simplified Arabic", "Traditional Arabic", "Arial", "Tahoma")
LATIN_FONT = "Calibri"
MAX_CHARS = 400_000


def is_rtl(text: str) -> bool:
    """The first letter decides, as it does for a paragraph in Word."""
    for ch in text:
        if ARABIC.match(ch):
            return True
        if LATIN.match(ch):
            return False
    return False


def mostly_arabic(text: str) -> bool:
    return len(ARABIC.findall(text)) >= len(LATIN.findall(text))


# ── Markdown → blocks ────────────────────────────────────────────────────────────────────


@dataclass
class Block:
    kind: Literal["heading", "para", "bullet", "number", "table", "code", "quote", "rule", "pagebreak"]
    text: str = ""
    level: int = 0  # heading level, or the list item's depth
    rows: list[list[str]] = field(default_factory=list)
    list_id: int = 0  # numbered lists restart at 1 each time one begins


def _cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def parse(markdown: str) -> list[Block]:
    blocks: list[Block] = []
    lines = markdown.replace("\r\n", "\n").split("\n")
    i = 0
    lists = 0
    previous_numbered = False
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        numbered = False
        if not stripped:
            # A blank line between items doesn't end a numbered list (a "loose" list).
            i += 1
            continue
        if stripped.startswith("```"):
            body: list[str] = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                body.append(lines[i])
                i += 1
            blocks.append(Block("code", "\n".join(body)))
            previous_numbered = False
            i += 1
            continue
        if stripped in ("\\newpage", "<pagebreak>", "<!-- pagebreak -->"):
            blocks.append(Block("pagebreak"))
        elif re.fullmatch(r"(-{3,}|\*{3,}|_{3,})", stripped):
            blocks.append(Block("rule"))
        elif m := re.match(r"(#{1,6})\s+(.*)", stripped):
            blocks.append(Block("heading", m.group(2).strip().rstrip("#").strip(), level=len(m.group(1))))
        elif stripped.startswith("|") and i + 1 < len(lines) and re.fullmatch(r"\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?", lines[i + 1].strip()):
            rows = [_cells(stripped)]
            i += 2
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(_cells(lines[i]))
                i += 1
            width = max(len(r) for r in rows)
            blocks.append(Block("table", rows=[r + [""] * (width - len(r)) for r in rows]))
            previous_numbered = False
            continue
        elif m := re.match(r"(\s*)[-*+•]\s+(.*)", line):
            blocks.append(Block("bullet", m.group(2), level=min(len(m.group(1).replace("\t", "  ")) // 2, 4)))
        elif m := re.match(r"(\s*)\d+[.)]\s+(.*)", line):
            if not previous_numbered:
                lists += 1
            numbered = True
            blocks.append(Block("number", m.group(2), level=min(len(m.group(1).replace("\t", "  ")) // 2, 4), list_id=lists))
        elif stripped.startswith(">"):
            blocks.append(Block("quote", stripped.lstrip(">").strip()))
        else:
            # A paragraph runs until a blank line or the start of another block.
            text = [stripped]
            while i + 1 < len(lines):
                nxt = lines[i + 1].strip()
                if not nxt or re.match(r"(#{1,6}\s|[-*+•]\s|\d+[.)]\s|>|\||```|-{3,}$)", nxt):
                    break
                text.append(nxt)
                i += 1
            blocks.append(Block("para", " ".join(text)))
        previous_numbered = numbered or (previous_numbered and blocks[-1].kind == "bullet")
        i += 1
    return blocks


# ── Blocks → WordprocessingML ────────────────────────────────────────────────────────────


@dataclass
class Doc:
    rtl: bool
    font: str
    links: list[str] = field(default_factory=list)
    lists: set[int] = field(default_factory=set)

    def link(self, url: str) -> str:
        self.links.append(url)
        return f"rLink{len(self.links)}"


def _t(text: str) -> str:
    return f'<w:t xml:space="preserve">{escape(text)}</w:t>'


def _segments(text: str, rtl: bool) -> list[tuple[str, bool]]:
    """Splits text into (piece, right-to-left?) runs: Latin stretches inside Arabic, and
    Arabic stretches inside English, each get the direction of their own script."""
    if rtl:
        out: list[tuple[str, bool]] = []
        last = 0
        for m in LATIN_SPAN.finditer(text):
            if m.start() > last:
                out.append((text[last : m.start()], True))
            out.append((m.group(0), False))
            last = m.end()
        if last < len(text):
            out.append((text[last:], True))
        return [s for s in out if s[0]]
    # Arabic words and the spaces between them; punctuation stays with the English around it.
    pieces = re.split(f"([{ARABIC_RANGE}]+(?:\\s+[{ARABIC_RANGE}]+)*)", text)
    return [(p, bool(ARABIC.search(p))) for p in pieces if p]


def _run(text: str, rtl: bool, bold: bool = False, italic: bool = False, code: bool = False, link: bool = False) -> str:
    props = []
    if code:
        props.append('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>')
    if bold:
        props.append("<w:b/><w:bCs/>")
    if italic:
        props.append("<w:i/><w:iCs/>")
    if link:
        props.append('<w:rStyle w:val="Hyperlink"/>')
    if rtl:
        props.append("<w:rtl/>")
    rpr = f"<w:rPr>{''.join(props)}</w:rPr>" if props else ""
    return f"<w:r>{rpr}{_t(text)}</w:r>"


def runs(doc: Doc, text: str, rtl: bool, bold: bool = False) -> str:
    out: list[str] = []
    for token in INLINE.split(text):
        if not token:
            continue
        style = {"bold": bold, "italic": False, "code": False}
        url = None
        if (token.startswith("**") and token.endswith("**")) or (token.startswith("__") and token.endswith("__")):
            token, style["bold"] = token[2:-2], True
        elif token.startswith("`") and token.endswith("`"):
            token, style["code"] = token[1:-1], True
        elif (m := re.fullmatch(r"\[([^\]]+)\]\(([^)\s]+)\)", token)) is not None:
            token, url = m.group(1), m.group(2)
        elif len(token) > 2 and token[0] in "*_" and token[-1] == token[0]:
            token, style["italic"] = token[1:-1], True
        pieces = [(token, False)] if style["code"] else _segments(token, rtl)
        body = "".join(_run(p, r, style["bold"], style["italic"], style["code"], link=url is not None) for p, r in pieces)
        out.append(f'<w:hyperlink r:id="{doc.link(url)}">{body}</w:hyperlink>' if url else body)
    return "".join(out)


def _para(doc: Doc, text: str, style: str | None = None, extra: str = "", rtl: bool | None = None, bold: bool = False) -> str:
    direction = doc.rtl if rtl is None else rtl
    if text and rtl is None:
        direction = is_rtl(text) if (ARABIC.search(text) or LATIN.search(text)) else doc.rtl
    ppr = (f'<w:pStyle w:val="{style}"/>' if style else "") + extra + ("<w:bidi/>" if direction else "")
    return f"<w:p><w:pPr>{ppr}</w:pPr>{runs(doc, text, direction, bold)}</w:p>"


def _table(doc: Doc, rows: list[list[str]]) -> str:
    rtl = doc.rtl if not any(c for r in rows for c in r) else mostly_arabic(" ".join(c for r in rows for c in r))
    borders = "".join(f'<w:{side} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>' for side in ("top", "left", "bottom", "right", "insideH", "insideV"))
    tblpr = f'<w:tblPr><w:tblStyle w:val="Table"/><w:tblW w:w="5000" w:type="pct"/>{"<w:bidiVisual/>" if rtl else ""}<w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="autofit"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:start w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:end w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>'
    out = [f"<w:tbl>{tblpr}<w:tblGrid>{''.join('<w:gridCol/>' for _ in rows[0])}</w:tblGrid>"]
    for n, row in enumerate(rows):
        header = n == 0
        trpr = "<w:trPr><w:tblHeader/></w:trPr>" if header else ""
        cells = []
        for cell in row:
            shade = '<w:shd w:val="clear" w:color="auto" w:fill="EDEFF2"/>' if header else ""
            numeric = bool(re.fullmatch(r"[\d٠-٩.,%$€£+\-\s]+", cell)) and not header
            cell_rtl = rtl if not (ARABIC.search(cell) or LATIN.search(cell)) else is_rtl(cell)
            jc = '<w:jc w:val="center"/>' if numeric or header else ""
            para = f"<w:p><w:pPr><w:spacing w:before=\"0\" w:after=\"0\"/>{'<w:bidi/>' if cell_rtl else ''}{jc}</w:pPr>{runs(doc, cell, cell_rtl, bold=header)}</w:p>"
            cells.append(f'<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>{shade}</w:tcPr>{para}</w:tc>')
        out.append(f"<w:tr>{trpr}{''.join(cells)}</w:tr>")
    out.append("</w:tbl><w:p/>")
    return "".join(out)


def body_xml(doc: Doc, blocks: list[Block], title: str | None) -> str:
    out: list[str] = []
    if title:
        out.append(_para(doc, title, "Title"))
    for b in blocks:
        if b.kind == "heading":
            out.append(_para(doc, b.text, f"Heading{min(b.level, 3)}"))
        elif b.kind == "para":
            out.append(_para(doc, b.text))
        elif b.kind == "bullet":
            out.append(_para(doc, b.text, "ListParagraph", f'<w:numPr><w:ilvl w:val="{b.level}"/><w:numId w:val="1"/></w:numPr>'))
        elif b.kind == "number":
            doc.lists.add(b.list_id)
            out.append(_para(doc, b.text, "ListParagraph", f'<w:numPr><w:ilvl w:val="{b.level}"/><w:numId w:val="{b.list_id + 1}"/></w:numPr>'))
        elif b.kind == "quote":
            # The bar goes on the side the line starts from: the right, for Arabic.
            side = "right" if (is_rtl(b.text) if (ARABIC.search(b.text) or LATIN.search(b.text)) else doc.rtl) else "left"
            out.append(_para(doc, b.text, "Quote", f'<w:pBdr><w:{side} w:val="single" w:sz="18" w:space="8" w:color="9AA5B8"/></w:pBdr>'))
        elif b.kind == "code":
            for line in b.text.split("\n") or [""]:
                out.append(f'<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr>{_run(line, False, code=True)}</w:p>')
        elif b.kind == "table":
            out.append(_table(doc, b.rows))
        elif b.kind == "rule":
            out.append('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/></w:pBdr></w:pPr></w:p>')
        elif b.kind == "pagebreak":
            out.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
    sect = f'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1304" w:bottom="1440" w:left="1304" w:header="709" w:footer="709" w:gutter="0"/>{"<w:bidi/>" if doc.rtl else ""}</w:sectPr>'
    return "".join(out) + sect


NS = (
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
)


def styles_xml(font: str) -> str:
    def rpr(size: int, bold: bool = False, color: str | None = None) -> str:
        b = "<w:b/><w:bCs/>" if bold else ""
        c = f'<w:color w:val="{color}"/>' if color else ""
        # Arabic letters look smaller than Latin ones at the same size: the Arabic side
        # gets a few more half-points.
        return f"<w:rPr>{b}{c}<w:sz w:val=\"{size}\"/><w:szCs w:val=\"{size + 8}\"/></w:rPr>"

    def heading(n: int, size: int) -> str:
        return (
            f'<w:style w:type="paragraph" w:styleId="Heading{n}"><w:name w:val="heading {n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>'
            f'<w:pPr><w:keepNext/><w:spacing w:before="{360 - n * 60}" w:after="120"/><w:outlineLvl w:val="{n - 1}"/></w:pPr>{rpr(size, True, "1F3864")}</w:style>'
        )

    lang = '<w:lang w:val="en-US" w:bidi="ar-SA"/>'
    return (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles {NS}>'
        f'<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="{LATIN_FONT}" w:hAnsi="{LATIN_FONT}" w:eastAsia="{LATIN_FONT}" w:cs="{escape(font)}"/>'
        f'<w:sz w:val="24"/><w:szCs w:val="32"/>{lang}</w:rPr></w:rPrDefault>'
        f'<w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
        f'<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="300"/></w:pPr>{rpr(40, True, "1F3864")}</w:style>'
        + heading(1, 32)
        + heading(2, 28)
        + heading(3, 26)
        + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:contextualSpacing/></w:pPr></w:style>'
        + f'<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="567" w:right="567"/></w:pPr>{rpr(24, False, "44546A")}</w:style>'
        + '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:bidi w:val="0"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>'
        + '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>'
        + '<w:style w:type="table" w:default="1" w:styleId="Table"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/></w:tblPr></w:style>'
        + "</w:styles>"
    )


def numbering_xml(lists: set[int]) -> str:
    def levels(fmt: str) -> str:
        out = []
        for lvl in range(5):
            text = ("•", "◦", "▪", "•", "◦")[lvl] if fmt == "bullet" else f"%{lvl + 1}."
            ind = 567 * (lvl + 1)
            out.append(
                f'<w:lvl w:ilvl="{lvl}"><w:start w:val="1"/><w:numFmt w:val="{fmt}"/><w:lvlText w:val="{text}"/><w:lvlJc w:val="left"/>'
                f'<w:pPr><w:ind w:left="{ind}" w:hanging="340"/></w:pPr></w:lvl>'
            )
        return "".join(out)

    nums = ['<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>']
    for n in sorted(lists):
        nums.append(f'<w:num w:numId="{n + 1}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>')
    return (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering {NS}>'
        f'<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>{levels("bullet")}</w:abstractNum>'
        f'<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>{levels("decimal")}</w:abstractNum>'
        + "".join(nums)
        + "</w:numbering>"
    )


def build_docx(markdown: str, title: str | None = None, direction: Direction = "auto", font: str = FONTS[0]) -> bytes:
    rtl = mostly_arabic((title or "") + markdown) if direction == "auto" else direction == "rtl"
    doc = Doc(rtl=rtl, font=font)
    body = body_xml(doc, parse(markdown), title)
    document = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {NS}><w:body>{body}</w:body></w:document>'
    links = "".join(
        f'<Relationship Id="rLink{n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="{escape(url, {chr(34): "&quot;"})}" TargetMode="External"/>'
        for n, url in enumerate(doc.links, 1)
    )
    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    files = {
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
            '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
            '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
            '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'
        ),
        "_rels/.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'
        ),
        "word/_rels/document.xml.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>'
            f'<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>{links}</Relationships>'
        ),
        "word/document.xml": document,
        "word/styles.xml": styles_xml(font),
        "word/numbering.xml": numbering_xml(doc.lists),
        "word/settings.xml": (
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings {NS}><w:defaultTabStop w:val="720"/>'
            '<w:characterSpacingControl w:val="doNotCompress"/><w:themeFontLang w:val="en-US" w:bidi="ar-SA"/></w:settings>'
        ),
        "docProps/core.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            f"<dc:title>{escape(title or '')}</dc:title><dc:creator>Rafiq</dc:creator>"
            f'<dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified></cp:coreProperties>'
        ),
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, text in files.items():
            zf.writestr(name, text)
    return buffer.getvalue()


class WordWriteTool(Tool):
    name = "word_write"
    category = "write"
    description = (
        "Write a Word document (.docx) from Markdown, relative to the task's working directory. "
        "Supports headings (#, ##, ###), paragraphs, **bold**, *italic*, `code`, [links](url), "
        "bullet and numbered lists (nest with two spaces), tables (| a | b | with a |---| line), "
        "> quotes, ``` code blocks, --- for a line and \\newpage for a page break. Arabic is laid "
        "out right to left with an Arabic font (tables and lists too); English stays left to "
        "right. Use it for reports, letters, CVs, research papers and the like — don't write "
        "the .docx by hand."
    )
    parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Where to save it, ending in .docx"},
            "content": {"type": "string", "description": "The document in Markdown"},
            "title": {"type": "string", "description": "A title at the top (optional; leave it out if the Markdown starts with its own # title)"},
            "direction": {"type": "string", "enum": ["auto", "rtl", "ltr"], "description": "auto: from the text (default)"},
            "font": {"type": "string", "enum": list(FONTS), "description": f"The Arabic font (default {FONTS[0]})"},
        },
        "required": ["path", "content"],
    }

    def __init__(self, working_dir: Path) -> None:
        self.working_dir = working_dir

    def _target(self, args: dict[str, Any]) -> Path:
        path = str(args.get("path", "")).strip()
        if not path.lower().endswith(".docx"):
            path += ".docx"
        return _resolve(self.working_dir, path)

    async def preview(self, args: dict[str, Any]) -> str | None:
        try:
            target = self._target(args)
        except PathEscapeError:
            return None
        blocks = parse(str(args.get("content", "")))
        headings = [b.text for b in blocks if b.kind == "heading"][:12]
        tables = sum(b.kind == "table" for b in blocks)
        lines = [f"{'overwrite' if target.exists() else 'new'}: {target.name}", f"{len(blocks)} blocks, {tables} tables"]
        lines += [f"  # {h}" for h in headings]
        return "\n".join(lines)

    async def run(self, args: dict[str, Any]) -> ToolResult:
        content = str(args.get("content", ""))
        if not content.strip():
            return ToolResult(ok=False, output="content is empty")
        if len(content) > MAX_CHARS:
            return ToolResult(ok=False, output=f"content is too long ({len(content)} chars, max {MAX_CHARS})")
        font = str(args.get("font") or FONTS[0])
        if font not in FONTS:
            font = FONTS[0]
        direction = args.get("direction") if args.get("direction") in ("auto", "rtl", "ltr") else "auto"
        try:
            target = self._target(args)
        except PathEscapeError as e:
            return ToolResult(ok=False, output=str(e))
        data = build_docx(content, (args.get("title") or None), direction, font)  # type: ignore[arg-type]
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            target.write_bytes(data)
        except PermissionError:
            return ToolResult(ok=False, output=f"{target.name} is open in another program (Word?) — close it and try again")
        return ToolResult(ok=True, output=f"wrote {target.name} ({len(data)} bytes)")
