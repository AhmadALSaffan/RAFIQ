"""Looking at a picture in the folder. The tool hands the image back like a screenshot: a
model that can see gets the picture itself, and one that can't (DeepSeek, many local models)
gets it described in words by the vision model chosen in Settings — the loop does that for
every image a tool returns (core/loop.py, core/vision.py)."""

import base64
import io
from pathlib import Path
from typing import Any

from rafiq_agent.tools.base import Tool, ToolResult
from rafiq_agent.tools.filesystem import PathEscapeError, _resolve

KINDS = {".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".webp": "webp", ".gif": "gif", ".bmp": "bmp"}
MAX_BYTES = 15 * 1024 * 1024
MAX_SIDE = 1600  # larger pictures are scaled down: the model sees as much, for far fewer tokens


def image_data_url(path: Path) -> tuple[str, tuple[int, int]]:
    from PIL import Image

    with Image.open(path) as im:
        im.load()
        size = im.size
        if max(size) > MAX_SIDE or path.suffix.lower() in (".bmp", ".gif"):
            frame = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
            frame.thumbnail((MAX_SIDE, MAX_SIDE))
            buffer = io.BytesIO()
            frame.save(buffer, "PNG")
            return f"data:image/png;base64,{base64.b64encode(buffer.getvalue()).decode()}", size
    raw = path.read_bytes()
    return f"data:image/{KINDS[path.suffix.lower()]};base64,{base64.b64encode(raw).decode()}", size


class ImageViewTool(Tool):
    name = "image_view"
    category = "read_only"
    description = (
        "Look at an image file (.png, .jpg, .webp, .gif, .bmp) relative to the task's working "
        "directory — a screenshot, a photo, a chart, a scanned page. You get the picture itself; "
        "if you can't read images, you get a detailed description of it instead. Use it instead "
        "of trying to open images with code."
    )
    parameters = {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}

    def __init__(self, working_dir: Path) -> None:
        self.working_dir = working_dir

    async def run(self, args: dict[str, Any]) -> ToolResult:
        try:
            target = _resolve(self.working_dir, str(args.get("path", "")))
        except PathEscapeError as e:
            return ToolResult(ok=False, output=str(e))
        if not target.is_file():
            return ToolResult(ok=False, output=f"no such file: {args.get('path')}")
        if target.suffix.lower() not in KINDS:
            return ToolResult(ok=False, output=f"not an image this tool reads: {target.suffix or target.name}")
        if target.stat().st_size > MAX_BYTES:
            return ToolResult(ok=False, output=f"{target.name} is too big ({target.stat().st_size // 1024 // 1024} MB, max 15)")
        try:
            url, (w, h) = image_data_url(target)
        except Exception as e:  # noqa: BLE001 - a broken image is reported, not raised
            return ToolResult(ok=False, output=f"couldn't open {target.name}: {e}")
        return ToolResult(ok=True, output=f"{target.name} — {w}×{h}", images=[url])
