"""Reading scanned PDFs: each page becomes a picture, and the vision model writes out its text.

The knowledge folder (core/knowledge.py) counts a PDF made only of scanned pages as unread: it
has no text layer. With "read scanned PDFs" on and a vision model chosen in Settings, those
files are read here after each scan, page by page, and their passages join the rest with their
page numbers, so an answer can say «the contract, p. 3» about a scan too.

It costs what the vision model costs (or nothing with a local one), so it's off until the user
turns it on, reads at most MAX_PAGES pages of a file, and never retries a file that hasn't
changed. Arabic first: the prompt asks for the text exactly as written, right to left.
"""

from __future__ import annotations

import base64
import io
import logging
from pathlib import Path

log = logging.getLogger(__name__)

MAX_PAGES = 60
PAGES_PER_CALL = 2
SCALE = 2.0  # 144 dpi: small Arabic print stays legible
MAX_SIDE = 1800

PROMPT = (
    "You are an OCR engine. Write out all the text on each page image exactly as it is written: "
    "Arabic stays Arabic (right to left, with its diacritics), English stays English, numbers as "
    "printed. Keep paragraphs and table rows on their own lines. No commentary, no translation, "
    "no description of images. Start each page with a line «=== PAGE n ===». If a page has no "
    "text, write the marker and nothing after it."
)


def page_images(path: Path, start: int, count: int) -> list[str]:
    """data: URLs (PNG) of pages start..start+count-1 (1-based)."""
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(str(path))
    try:
        out = []
        for index in range(start - 1, min(start - 1 + count, len(pdf))):
            image = pdf[index].render(scale=SCALE).to_pil()
            image.thumbnail((MAX_SIDE, MAX_SIDE))
            buffer = io.BytesIO()
            image.convert("RGB").save(buffer, "PNG", optimize=True)
            out.append("data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode())
        return out
    finally:
        pdf.close()


def page_count(path: Path) -> int:
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(str(path))
    try:
        return len(pdf)
    finally:
        pdf.close()


def split_pages(text: str, first: int, count: int) -> list[tuple[int, str]]:
    """The model's reply cut back into (page number, text). Without markers, it's all the
    first page's: better one page wrong by a little than text thrown away."""
    import re

    parts = re.split(r"^\s*===\s*PAGE\s*(\d+)\s*===\s*$", text, flags=re.M | re.I)
    if len(parts) < 3:
        return [(first, text.strip())] if text.strip() else []
    out: list[tuple[int, str]] = []
    for i in range(1, len(parts) - 1, 2):
        n = int(parts[i])
        body = parts[i + 1].strip()
        # The model numbers the pages of its own batch (1, 2) or the real ones; both work.
        page = n if first <= n < first + count else first + (n - 1)
        if body:
            out.append((page, body))
    return out


async def read_scanned(path: Path) -> list[tuple[int, str]]:
    """(page, text) for a scanned PDF through the vision model. Raises LookupError without one."""
    from rafiq_agent.core.vision import describe_images

    total = min(page_count(path), MAX_PAGES)
    out: list[tuple[int, str]] = []
    for first in range(1, total + 1, PAGES_PER_CALL):
        count = min(PAGES_PER_CALL, total - first + 1)
        images = page_images(path, first, count)
        labels = [f"=== PAGE {first + i} ===" for i in range(count)]
        reply = await describe_images(images, labels, prompt=PROMPT, max_tokens=4000)
        out += split_pages(reply, first, count)
    return out
