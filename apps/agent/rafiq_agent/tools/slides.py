"""PowerPoint decks in proper Arabic.

`slides_write` turns an outline into a .pptx: one slide per `##` heading, bullets that sit
on the right and read right to left, an Arabic font, tables that read from the right, and
English kept left to right inside Arabic. Two clean looks (light and dark) with Rafiq's
orange as the one accent. Like the Word tool, the file is put together from its XML parts,
so every direction flag sits exactly where PowerPoint looks for it.
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
from rafiq_agent.tools.office import ARABIC, FONTS, LATIN, _segments, is_rtl, mostly_arabic

Look = Literal["light", "dark"]
EMU = 914400  # per inch
W, H = 12192000, 6858000  # 16:9
LATIN_FONT = "Calibri"
MAX_SLIDES = 60
INLINE = re.compile(r"(\*\*[^*]+\*\*)")

LOOKS: dict[str, dict[str, str]] = {
    "light": {"bg": "FFFFFF", "ink": "141414", "muted": "66665F", "accent": "E68835", "rule": "E6E4DE", "head": "F3F2EE"},
    "dark": {"bg": "141414", "ink": "F2F2EF", "muted": "A3A39B", "accent": "E68835", "rule": "2C2C2B", "head": "232321"},
}


@dataclass
class Slide:
    title: str
    bullets: list[tuple[int, str]] = field(default_factory=list)  # (level, text)
    table: list[list[str]] = field(default_factory=list)
    subtitle: str = ""


def _cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def parse_outline(markdown: str) -> tuple[str, str, list[Slide]]:
    """`# Title` and the line under it make the title slide; each `## Heading` a slide with
    its bullets (or plain lines), and a Markdown table if it has one."""
    title, subtitle, slides = "", "", []
    current: Slide | None = None
    lines = markdown.replace("\r\n", "\n").split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if not stripped or stripped.startswith(">"):
            i += 1
            continue
        if m := re.match(r"#\s+(.*)", stripped):
            title = m.group(1).strip()
        elif m := re.match(r"#{2,3}\s+(.*)", stripped):
            current = Slide(m.group(1).strip())
            slides.append(current)
        elif stripped.startswith("|") and i + 1 < len(lines) and re.fullmatch(r"\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?", lines[i + 1].strip()):
            rows = [_cells(stripped)]
            i += 2
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(_cells(lines[i]))
                i += 1
            width = max(len(r) for r in rows)
            if current is None:
                current = Slide("")
                slides.append(current)
            current.table = [r + [""] * (width - len(r)) for r in rows]
            continue
        elif current is None:
            if title and not subtitle:
                subtitle = stripped
        else:
            m = re.match(r"(\s*)(?:[-*+•]|\d+[.)])\s+(.*)", line)
            level = min(len(m.group(1).replace("\t", "  ")) // 2, 2) if m else 0
            current.bullets.append((level, (m.group(2) if m else stripped).strip()))
        i += 1
    return title, subtitle, slides[:MAX_SLIDES]


# ── DrawingML ────────────────────────────────────────────────────────────────────────────


def _runs(text: str, rtl: bool, size: int, color: str, bold: bool = False, font: str = FONTS[0]) -> str:
    out = []
    for token in INLINE.split(text):
        if not token:
            continue
        b = bold
        if token.startswith("**") and token.endswith("**"):
            token, b = token[2:-2], True
        for piece, piece_rtl in _segments(token, rtl):
            attrs = f'lang="{"ar-SA" if piece_rtl else "en-US"}" sz="{size}" b="{1 if b else 0}" dirty="0"'
            out.append(
                f'<a:r><a:rPr {attrs}><a:solidFill><a:srgbClr val="{color}"/></a:solidFill>'
                f'<a:latin typeface="{LATIN_FONT}"/><a:cs typeface="{escape(font)}"/></a:rPr><a:t>{escape(piece)}</a:t></a:r>'
            )
    return "".join(out)


def _para(text: str, size: int, color: str, *, bold: bool = False, bullet: str | None = None, level: int = 0, accent: str = "E68835", font: str = FONTS[0], space_after: int = 600, rtl: bool | None = None) -> str:
    direction = is_rtl(text) if rtl is None and (ARABIC.search(text) or LATIN.search(text)) else bool(rtl)
    algn = "r" if direction else "l"
    if bullet:
        mar = 342900 + level * 342900
        bu = f'<a:buClr><a:srgbClr val="{accent}"/></a:buClr><a:buSzPct val="100000"/><a:buFont typeface="Arial"/><a:buChar char="{bullet}"/>'
        ppr = f'<a:pPr marL="{mar}" indent="-285750" algn="{algn}" rtl="{1 if direction else 0}"><a:spcAft><a:spcPts val="{space_after}"/></a:spcAft>{bu}</a:pPr>'
    else:
        ppr = f'<a:pPr algn="{algn}" rtl="{1 if direction else 0}"><a:spcAft><a:spcPts val="{space_after}"/></a:spcAft><a:buNone/></a:pPr>'
    return f"<a:p>{ppr}{_runs(text, direction, size, color, bold, font)}</a:p>"


_shape_id = 0


def _sp(name: str, x: int, y: int, w: int, h: int, body: str = "", fill: str | None = None, anchor: str = "t") -> str:
    global _shape_id
    _shape_id += 1
    fill_xml = f'<a:solidFill><a:srgbClr val="{fill}"/></a:solidFill>' if fill else "<a:noFill/>"
    tx = (
        f'<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="{anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>{body}</p:txBody>'
        if body
        else ""
    )
    text_box = ' txBox="1"' if body else ""
    return (
        f'<p:sp><p:nvSpPr><p:cNvPr id="{_shape_id + 1}" name="{escape(name)}"/><p:cNvSpPr{text_box}/><p:nvPr/></p:nvSpPr>'
        f'<p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>{fill_xml}<a:ln><a:noFill/></a:ln></p:spPr>'
        f"{tx}</p:sp>"
    )


def _table(rows: list[list[str]], x: int, y: int, w: int, look: dict[str, str], rtl: bool, font: str) -> str:
    global _shape_id
    _shape_id += 1
    cols = len(rows[0])
    col_w = w // cols
    row_h = 548640
    grid = "".join(f'<a:gridCol w="{col_w}"/>' for _ in range(cols))
    body = []
    for n, row in enumerate(rows):
        cells = []
        for cell in row:
            header = n == 0
            numeric = bool(re.fullmatch(r"[\d٠-٩.,%$€£+\-\s]+", cell)) and not header
            cell_rtl = rtl if not (ARABIC.search(cell) or LATIN.search(cell)) else is_rtl(cell)
            algn = "ctr" if numeric or header else ("r" if cell_rtl else "l")
            para = f'<a:p><a:pPr algn="{algn}" rtl="{1 if cell_rtl else 0}"/>{_runs(cell, cell_rtl, 2200, look["ink"], header, font)}</a:p>'
            fill = look["head"] if header else look["bg"]
            cells.append(
                f'<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>{para}</a:txBody><a:tcPr marL="91440" marR="91440" marT="45720" marB="45720" anchor="ctr">'
                f'<a:lnB w="9525"><a:solidFill><a:srgbClr val="{look["rule"]}"/></a:solidFill></a:lnB><a:solidFill><a:srgbClr val="{fill}"/></a:solidFill></a:tcPr></a:tc>'
            )
        body.append(f'<a:tr h="{row_h}">{"".join(cells)}</a:tr>')
    table_rtl = ' rtl="1"' if rtl else ""
    return (
        f'<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="{_shape_id + 1}" name="Table"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>'
        f'<p:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{col_w * cols}" cy="{row_h * len(rows)}"/></p:xfrm>'
        f'<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"{table_rtl}/>'
        f"<a:tblGrid>{grid}</a:tblGrid>{''.join(body)}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>"
    )


NS = (
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
)


def _slide_xml(shapes: str, bg: str) -> str:
    return (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld {NS}><p:cSld>'
        f'<p:bg><p:bgPr><a:solidFill><a:srgbClr val="{bg}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>'
        '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
        '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
        f"{shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"
    )


def build_pptx(markdown: str, title: str | None = None, look: Look = "light", font: str = FONTS[0]) -> bytes:
    global _shape_id
    deck_title, subtitle, slides = parse_outline(markdown)
    deck_title = title or deck_title
    rtl = mostly_arabic(deck_title + markdown)
    c = LOOKS[look]
    margin = int(0.7 * EMU)
    inner = W - 2 * margin
    bar = int(0.12 * EMU)
    bar_x = W - margin + int(0.18 * EMU) if rtl else margin - int(0.3 * EMU)
    xml_slides: list[str] = []

    # The title slide: the deck's name large, a line of accent, the subtitle under it.
    _shape_id = 0
    shapes = _sp("Accent", margin if not rtl else W - margin - int(1.6 * EMU), int(3.05 * EMU), int(1.6 * EMU), int(0.08 * EMU), fill=c["accent"])
    shapes += _sp("Title", margin, int(1.4 * EMU), inner, int(1.5 * EMU), _para(deck_title or " ", 6600, c["ink"], bold=True, font=font, rtl=rtl), anchor="b")
    if subtitle:
        shapes += _sp("Subtitle", margin, int(3.35 * EMU), inner, int(1.2 * EMU), _para(subtitle, 3000, c["muted"], font=font, rtl=rtl))
    xml_slides.append(_slide_xml(shapes, c["bg"]))

    for n, slide in enumerate(slides, start=2):
        _shape_id = 0
        shapes = _sp("Accent", bar_x, int(0.62 * EMU), bar, int(0.62 * EMU), fill=c["accent"])
        shapes += _sp("Title", margin, int(0.5 * EMU), inner, int(0.9 * EMU), _para(slide.title or " ", 4400, c["ink"], bold=True, font=font, rtl=rtl if not slide.title else None), anchor="ctr")
        top = int(1.75 * EMU)
        if slide.bullets:
            paras = "".join(
                _para(text, 3000 if lvl == 0 else 2400, c["ink"] if lvl == 0 else c["muted"], bullet="•" if lvl == 0 else "–", level=lvl, accent=c["accent"], font=font, space_after=900)
                for lvl, text in slide.bullets
            )
            height = int((H - top - 0.9 * EMU) * (0.5 if slide.table else 1))
            shapes += _sp("Body", margin, top, inner, height, paras)
            top += height + int(0.2 * EMU)
        if slide.table:
            table_rtl = mostly_arabic(" ".join(" ".join(r) for r in slide.table))
            shapes += _table(slide.table, margin, top, inner, c, table_rtl, font)
        number = f"{n}"
        num_x = margin if rtl else W - margin - int(0.6 * EMU)
        shapes += _sp("Number", num_x, H - int(0.6 * EMU), int(0.6 * EMU), int(0.3 * EMU), f'<a:p><a:pPr algn="{"l" if rtl else "r"}"/>{_runs(number, False, 1200, c["muted"])}</a:p>')
        xml_slides.append(_slide_xml(shapes, c["bg"]))

    return _package(xml_slides, deck_title, font)


THEME = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Rafiq">'
    '<a:themeElements><a:clrScheme name="Rafiq"><a:dk1><a:srgbClr val="141414"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="232321"/></a:dk2>'
    '<a:lt2><a:srgbClr val="F3F2EE"/></a:lt2><a:accent1><a:srgbClr val="E68835"/></a:accent1><a:accent2><a:srgbClr val="256B43"/></a:accent2><a:accent3><a:srgbClr val="3D6FD6"/></a:accent3>'
    '<a:accent4><a:srgbClr val="C2412D"/></a:accent4><a:accent5><a:srgbClr val="66665F"/></a:accent5><a:accent6><a:srgbClr val="A95A17"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink>'
    '<a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Rafiq"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface="Sakkal Majalla"/></a:majorFont>'
    '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface="Sakkal Majalla"/></a:minorFont></a:fontScheme><a:fmtScheme name="Rafiq"><a:fillStyleLst>'
    '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>'
    '<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'
    '<a:ln w="28575"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle>'
    '<a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
    '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>'
)

CLR_MAP = 'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"'
EMPTY_TREE = (
    '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>'
    '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>'
)
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def _rels(items: list[tuple[str, str, str]]) -> str:
    body = "".join(f'<Relationship Id="{i}" Type="{REL}/{kind}" Target="{target}"/>' for i, kind, target in items)
    return f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{body}</Relationships>'


def _package(slides: list[str], title: str, font: str) -> bytes:
    n = len(slides)
    slide_ids = "".join(f'<p:sldId id="{255 + i}" r:id="rId{10 + i}"/>' for i in range(1, n + 1))
    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    ct_slides = "".join(f'<Override PartName="/ppt/slides/slide{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' for i in range(1, n + 1))
    files: dict[str, str] = {
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
            '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
            '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
            '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
            '<Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>'
            '<Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>'
            '<Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>'
            '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
            f"{ct_slides}</Types>"
        ),
        "_rels/.rels": _rels([("rId1", "officeDocument", "ppt/presentation.xml")]).replace(
            "</Relationships>",
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
        ),
        "ppt/presentation.xml": (
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation {NS} saveSubsetFonts="1">'
            '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
            f"<p:sldIdLst>{slide_ids}</p:sldIdLst>"
            f'<p:sldSz cx="{W}" cy="{H}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>'
        ),
        "ppt/_rels/presentation.xml.rels": _rels(
            [("rId1", "slideMaster", "slideMasters/slideMaster1.xml"), ("rId2", "theme", "theme/theme1.xml"), ("rId3", "presProps", "presProps.xml"), ("rId4", "viewProps", "viewProps.xml"), ("rId5", "tableStyles", "tableStyles.xml")]
            + [(f"rId{10 + i}", "slide", f"slides/slide{i}.xml") for i in range(1, n + 1)]
        ),
        "ppt/presProps.xml": f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentationPr {NS}/>',
        "ppt/viewProps.xml": f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:viewPr {NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>',
        "ppt/tableStyles.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>',
        "ppt/theme/theme1.xml": THEME.replace("Sakkal Majalla", escape(font)),
        "ppt/slideMasters/slideMaster1.xml": (
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster {NS}><p:cSld>{EMPTY_TREE}</p:cSld><p:clrMap {CLR_MAP}/>'
            '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>'
        ),
        "ppt/slideMasters/_rels/slideMaster1.xml.rels": _rels([("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"), ("rId2", "theme", "../theme/theme1.xml")]),
        "ppt/slideLayouts/slideLayout1.xml": (
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout {NS} type="blank" preserve="1"><p:cSld name="Blank">{EMPTY_TREE}</p:cSld>'
            "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>"
        ),
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels": _rels([("rId1", "slideMaster", "../slideMasters/slideMaster1.xml")]),
        "docProps/core.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            f"<dc:title>{escape(title)}</dc:title><dc:creator>Rafiq</dc:creator>"
            f'<dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified></cp:coreProperties>'
        ),
    }
    for i, xml in enumerate(slides, start=1):
        files[f"ppt/slides/slide{i}.xml"] = xml
        files[f"ppt/slides/_rels/slide{i}.xml.rels"] = _rels([("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml")])
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, text in files.items():
            zf.writestr(name, text)
    return buffer.getvalue()


class SlidesWriteTool(Tool):
    name = "slides_write"
    category = "write"
    description = (
        "Build a PowerPoint deck (.pptx) from an outline, relative to the task's working directory. "
        "`# Title` and the line under it make the title slide; each `## Heading` is a slide, with "
        "its bullets (- item, nest with two spaces) and optionally one Markdown table. **bold** "
        "works. Arabic is laid out right to left with an Arabic font (bullets and tables too); "
        "English stays left to right. Keep slides short: 3–6 bullets each. Don't write the .pptx by hand."
    )
    parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Where to save it, ending in .pptx"},
            "outline": {"type": "string", "description": "The deck as Markdown: # title, ## per slide, - bullets"},
            "title": {"type": "string", "description": "The deck's title (optional; else the # line)"},
            "look": {"type": "string", "enum": ["light", "dark"], "description": "light (default) or dark"},
            "font": {"type": "string", "enum": list(FONTS), "description": f"The Arabic font (default {FONTS[0]})"},
        },
        "required": ["path", "outline"],
    }

    def __init__(self, working_dir: Path) -> None:
        self.working_dir = working_dir

    def _target(self, args: dict[str, Any]) -> Path:
        path = str(args.get("path", "")).strip()
        if not path.lower().endswith(".pptx"):
            path += ".pptx"
        return _resolve(self.working_dir, path)

    async def preview(self, args: dict[str, Any]) -> str | None:
        try:
            target = self._target(args)
        except PathEscapeError:
            return None
        title, _sub, slides = parse_outline(str(args.get("outline", "")))
        lines = [f"{'overwrite' if target.exists() else 'new'}: {target.name}", f"{len(slides) + 1} slides — {args.get('title') or title}"]
        lines += [f"  {i}. {s.title}" for i, s in enumerate(slides, start=2)][:20]
        return "\n".join(lines)

    async def run(self, args: dict[str, Any]) -> ToolResult:
        outline = str(args.get("outline", ""))
        if not outline.strip():
            return ToolResult(ok=False, output="outline is empty")
        font = str(args.get("font") or FONTS[0])
        if font not in FONTS:
            font = FONTS[0]
        look = "dark" if args.get("look") == "dark" else "light"
        try:
            target = self._target(args)
        except PathEscapeError as e:
            return ToolResult(ok=False, output=str(e))
        data = build_pptx(outline, args.get("title") or None, look, font)  # type: ignore[arg-type]
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            target.write_bytes(data)
        except PermissionError:
            return ToolResult(ok=False, output=f"{target.name} is open in another program (PowerPoint?) — close it and try again")
        return ToolResult(ok=True, output=f"wrote {target.name} ({len(data)} bytes, {len(parse_outline(outline)[2]) + 1} slides)")
