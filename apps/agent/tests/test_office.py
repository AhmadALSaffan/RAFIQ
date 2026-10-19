"""Word documents in proper Arabic: right-to-left paragraphs, tables and lists, an Arabic
font, and English kept left to right inside them."""

import io
import zipfile

import pytest

from rafiq_agent.core.agent_runtime import permission_key
from rafiq_agent.tools.office import WordWriteTool, _segments, build_docx, parse

REPORT = """# تقرير الربع الثالث

هذا تقرير **مختصر** باستخدام Python 3.12 وأداة [Power BI](https://example.com).

- زادت المبيعات 18%.
  - في الرياض.

| الشهر | المبيعات |
|---|---|
| يوليو | 120,000 |

1. توظيف مدير.

2. فتح فرع.

> ملاحظة أولية.

## English

This line is English with الربع الثالث inside.
"""


def parts(data: bytes) -> dict[str, str]:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        return {name: zf.read(name).decode("utf-8") for name in zf.namelist()}


def test_the_markdown_becomes_the_right_blocks():
    kinds = [b.kind for b in parse(REPORT)]
    assert kinds == ["heading", "para", "bullet", "bullet", "table", "number", "number", "quote", "heading", "para"]
    blocks = parse(REPORT)
    assert blocks[3].level == 1  # the nested bullet
    assert blocks[5].list_id == blocks[6].list_id  # a blank line doesn't restart the numbering
    assert blocks[4].rows == [["الشهر", "المبيعات"], ["يوليو", "120,000"]]


def test_a_new_numbered_list_starts_again_at_one():
    blocks = parse("1. a\n2. b\n\nا paragraph\n\n1. c")
    numbered = [b for b in blocks if b.kind == "number"]
    assert numbered[0].list_id != numbered[2].list_id


def test_arabic_runs_right_to_left_and_english_inside_it_does_not():
    assert _segments("استخدم Python 3.12 هنا", True) == [("استخدم ", True), ("Python 3.12", False), (" هنا", True)]
    assert _segments("with الربع الثالث, inside", False) == [("with ", False), ("الربع الثالث", True), (", inside", False)]


def test_the_document_is_laid_out_for_an_arabic_reader():
    files = parts(build_docx(REPORT))
    assert {"[Content_Types].xml", "word/document.xml", "word/styles.xml", "word/numbering.xml"} <= set(files)
    doc = files["word/document.xml"]
    assert "<w:bidiVisual/>" in doc  # the table reads from the right
    assert doc.count("<w:bidi/>") >= 6  # Arabic paragraphs, and the page itself
    assert "<w:rtl/>" in doc
    assert 'w:cs="Sakkal Majalla"' in files["word/styles.xml"]
    assert 'w:bidi="ar-SA"' in files["word/styles.xml"]
    assert "https://example.com" in files["word/_rels/document.xml.rels"]
    # The English paragraph is not flipped.
    english = doc.split("This line is English")[0].rsplit("<w:p>", 1)[1]
    assert "<w:bidi/>" not in english


def test_an_english_document_stays_left_to_right():
    doc = parts(build_docx("# Report\n\nAll in English.\n\n| a | b |\n|---|---|\n| 1 | 2 |"))["word/document.xml"]
    assert "<w:bidi/>" not in doc and "<w:bidiVisual/>" not in doc


def test_markup_is_escaped():
    doc = parts(build_docx('a <b> & "c"'))["word/document.xml"]
    assert "&lt;b&gt; &amp;" in doc


async def test_the_tool_writes_inside_the_folder_only(tmp_path):
    tool = WordWriteTool(tmp_path)
    ok = await tool.run({"path": "reports/q3", "content": REPORT, "font": "Arial"})
    assert ok.ok, ok.output
    written = tmp_path / "reports" / "q3.docx"
    assert written.is_file()
    assert 'w:cs="Arial"' in parts(written.read_bytes())["word/styles.xml"]
    escaped = await tool.run({"path": "../outside.docx", "content": "x"})
    assert not escaped.ok
    assert not (await tool.run({"path": "x.docx", "content": "  "})).ok
    preview = await tool.preview({"path": "reports/q3.docx", "content": REPORT})
    assert preview and "overwrite" in preview and "تقرير الربع الثالث" in preview


@pytest.mark.parametrize("name", ["word_write", "filesystem_write"])
def test_writing_a_document_asks_like_writing_a_file(name):
    assert permission_key(name) == "filesystem_write"
