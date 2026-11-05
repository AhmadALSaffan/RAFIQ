"""Scanned PDFs in the knowledge folder (core/ocr.py + core/knowledge.py)."""

from pathlib import Path

from PIL import Image, ImageDraw

from rafiq_agent.core import knowledge, ocr


def scanned_pdf(path: Path, pages: int = 3) -> Path:
    """A PDF made only of pictures: no text layer at all, like a scan."""
    images = []
    for n in range(pages):
        image = Image.new("RGB", (600, 800), "white")
        ImageDraw.Draw(image).rectangle((50, 50 + n * 40, 550, 90 + n * 40), fill="black")
        images.append(image)
    images[0].save(path, "PDF", save_all=True, append_images=images[1:])
    return path


def test_pages_render_as_pictures(tmp_path):
    pdf = scanned_pdf(tmp_path / "scan.pdf")
    assert ocr.page_count(pdf) == 3
    shots = ocr.page_images(pdf, 2, 5)
    assert len(shots) == 2 and all(s.startswith("data:image/png;base64,") for s in shots)


def test_reply_is_cut_back_into_pages():
    reply = "=== PAGE 3 ===\nعقد إيجار\n=== PAGE 4 ===\n\n=== PAGE 2 ===\nلا"
    assert ocr.split_pages(reply, 3, 2) == [(3, "عقد إيجار"), (4, "لا")]
    # Numbered from 1 within the batch.
    assert ocr.split_pages("=== PAGE 1 ===\nأ\n=== PAGE 2 ===\nب", 5, 2) == [(5, "أ"), (6, "ب")]
    # No markers: kept as the first page rather than lost.
    assert ocr.split_pages("نص بلا علامات", 7, 2) == [(7, "نص بلا علامات")]
    assert ocr.split_pages("   ", 1, 1) == []


async def test_scanned_pdf_becomes_searchable_with_its_page(tmp_path, monkeypatch):
    knowledge.clear()
    folder = tmp_path / "docs"
    folder.mkdir()
    scanned_pdf(folder / "عقد.pdf", pages=2)
    knowledge.scan([str(folder)])
    assert "عقد.pdf" in knowledge.status()["unread"]

    calls = []

    async def fake_vision(images, labels=None, prompt="", max_tokens=0):
        calls.append(labels)
        return "\n".join(f"{label}\nبند الإيجار الشهري رقم {i}" for i, label in enumerate(labels or []))

    monkeypatch.setattr("rafiq_agent.core.vision.describe_images", fake_vision)
    assert await knowledge.read_scans() == 1
    found = knowledge.search(["الإيجار"])
    assert found and {p.page for p in found} <= {1, 2}
    assert knowledge.status()["scanned"] == 1 and "عقد.pdf" not in knowledge.status()["unread"]

    # Unchanged: never paid for twice.
    assert await knowledge.read_scans() == 0
    assert len(calls) == 1


async def test_no_vision_model_reads_nothing(tmp_path, monkeypatch):
    knowledge.clear()
    folder = tmp_path / "docs"
    folder.mkdir()
    scanned_pdf(folder / "scan.pdf", pages=1)
    knowledge.scan([str(folder)])

    async def none(*_a, **_k):
        raise LookupError("no vision model")

    monkeypatch.setattr("rafiq_agent.core.vision.describe_images", none)
    assert await knowledge.read_scans() == 0
    # It stays waiting for when a model is chosen.
    assert knowledge.scans_waiting()
