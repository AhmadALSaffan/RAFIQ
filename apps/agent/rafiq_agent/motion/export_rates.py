"""Export bit rates — the same rule the engine uses (engine/export.ts: bitrateFor)."""


def bitrate_for(width: int, height: int, fps: float, codec: str, quality: str = "auto") -> int:
    bpp = 0.06 if codec == "h265" else 0.1
    bits = width * height * fps * bpp * (1.6 if quality == "high" else 1)
    return int(round(min(160e6, max(2e6, bits))))
