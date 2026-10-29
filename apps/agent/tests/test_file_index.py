"""Search inside the user's files: what's in them is found by any of the words the model
gives, folded like chat search, with names, kinds and dates; only changed files are read
again, and files that are gone drop out."""

import os
import zipfile
from pathlib import Path

import pytest

from rafiq_agent.core import file_index
from rafiq_agent.tools.file_search import FindFilesTool


@pytest.fixture()
def docs(tmp_path: Path) -> Path:
    file_index.clear()
    folder = tmp_path / "Documents"
    (folder / "bills").mkdir(parents=True)
    (folder / "bills" / "march.txt").write_text("فاتورة الكهرباء لشهر آذار: المبلغ 120", encoding="utf-8")
    (folder / "notes.md").write_text("Meeting notes about the new office lease and rent.", encoding="utf-8")
    with zipfile.ZipFile(folder / "عقد_الإيجار.docx", "w") as z:
        z.writestr("word/document.xml", "<w:document><w:body><w:p><w:r><w:t>عقد إيجار الشقة</w:t></w:r></w:p></w:body></w:document>")
    (folder / "node_modules").mkdir()
    (folder / "node_modules" / "skip.txt").write_text("فاتورة", encoding="utf-8")
    (folder / "holiday.jpg").write_bytes(b"\xff\xd8")
    yield folder
    file_index.clear()


def test_finds_files_by_what_is_inside_them_in_either_form(docs: Path):
    done = file_index.scan([str(docs)])
    assert done["added"] == 4  # node_modules is skipped
    paths = [h.path for h in file_index.search(["الفاتورة", "invoice"])]
    assert paths == [str(docs / "bills" / "march.txt")]
    hit = file_index.search(["بالفاتورة"])[0]
    assert "آذار" in hit.snippet
    # a Word file, by its text and by its name
    assert file_index.search(["إيجار"], kind="doc")[0].path.endswith("عقد_الإيجار.docx")
    assert any(h.path.endswith("notes.md") for h in file_index.search(["lease", "rent"]))
    assert file_index.search(["holiday"], kind="image")[0].path.endswith("holiday.jpg")


def test_reads_only_what_changed_and_forgets_what_is_gone(docs: Path):
    file_index.scan([str(docs)])
    again = file_index.scan([str(docs)])
    assert again["added"] == again["updated"] == again["removed"] == 0
    note = docs / "notes.md"
    note.write_text("Now about a car insurance renewal.", encoding="utf-8")
    os.utime(note, (note.stat().st_atime, note.stat().st_mtime + 5))
    (docs / "holiday.jpg").unlink()
    done = file_index.scan([str(docs)])
    assert done["updated"] == 1 and done["removed"] == 1
    assert file_index.search(["insurance"])[0].path == str(note)
    assert not file_index.search(["lease"])
    assert file_index.status()["files"] == 3


async def test_the_tool_answers_with_paths_and_says_when_nothing_is_indexed(docs: Path):
    tool = FindFilesTool()
    empty = await tool.run({"words": ["فاتورة"]})
    assert empty.ok and "index" in empty.output
    file_index.scan([str(docs)])
    found = await tool.run({"words": ["فاتورة", "bill"], "kind": "any"})
    assert found.ok and "march.txt" in found.output
    assert not (await tool.run({"words": []})).ok
    assert not (await tool.run({"words": ["x"], "modified_after": "March"})).ok


def test_default_folders_are_the_usual_ones(tmp_path: Path):
    assert file_index.folders([str(tmp_path)]) == [str(tmp_path)]
    assert file_index.folders([str(tmp_path / "nope")]) == []
