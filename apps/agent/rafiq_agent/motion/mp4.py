"""Reads an MP4 back after it's written, so "ready" means the file really is what was
asked for: its duration, the video track's codec, size, frame count and rate, and whether
there's audio. Only the box headers are read (no decoding), so it's fast on any size."""

import struct
from pathlib import Path
from typing import Any, BinaryIO

CONTAINERS = {b"moov", b"trak", b"mdia", b"minf", b"stbl", b"edts", b"dinf", b"udta"}


def _boxes(f: BinaryIO, start: int, end: int):
    pos = start
    while pos + 8 <= end:
        f.seek(pos)
        head = f.read(8)
        if len(head) < 8:
            return
        size, kind = struct.unpack(">I4s", head)
        header = 8
        if size == 1:
            size = struct.unpack(">Q", f.read(8))[0]
            header = 16
        elif size == 0:
            size = end - pos
        if size < header:
            return
        yield kind, pos + header, pos + size
        pos += size


def _read(f: BinaryIO, at: int, n: int) -> bytes:
    f.seek(at)
    return f.read(n)


def _full(f: BinaryIO, at: int) -> tuple[int, int]:
    data = _read(f, at, 4)
    return data[0], int.from_bytes(data[1:4], "big")


def _track(f: BinaryIO, start: int, end: int) -> dict[str, Any]:
    info: dict[str, Any] = {}

    def walk(s: int, e: int) -> None:
        for kind, body, stop in _boxes(f, s, e):
            if kind in CONTAINERS:
                walk(body, stop)
            elif kind == b"tkhd":
                version, _ = _full(f, body)
                off = body + 4 + (32 if version == 1 else 20) + 52
                w, h = struct.unpack(">II", _read(f, off, 8))
                info["width"], info["height"] = w >> 16, h >> 16
            elif kind == b"mdhd":
                version, _ = _full(f, body)
                if version == 1:
                    timescale, duration = struct.unpack(">IQ", _read(f, body + 4 + 16, 12))
                else:
                    timescale, duration = struct.unpack(">II", _read(f, body + 4 + 8, 8))
                info["timescale"], info["duration_units"] = timescale, duration
            elif kind == b"hdlr":
                info["handler"] = _read(f, body + 8, 4).decode("latin-1")
            elif kind == b"stsd":
                entry = body + 8
                size, fourcc = struct.unpack(">I4s", _read(f, entry, 8))
                info["codec"] = fourcc.decode("latin-1")
                if fourcc in (b"mp4a", b"Opus", b"opus"):
                    channels, _bits = struct.unpack(">HH", _read(f, entry + 8 + 16, 4))
                    rate = struct.unpack(">I", _read(f, entry + 8 + 24, 4))[0] >> 16
                    info["channels"], info["sample_rate"] = channels, rate
            elif kind == b"stsz":
                sample_size, count = struct.unpack(">II", _read(f, body + 4, 8))
                info["samples"] = count
            elif kind == b"stts":
                (count,) = struct.unpack(">I", _read(f, body + 4, 4))
                entries = []
                data = _read(f, body + 8, 8 * min(count, 10000))
                for i in range(min(count, 10000)):
                    entries.append(struct.unpack(">II", data[i * 8 : i * 8 + 8]))
                info["stts"] = entries

    walk(start, end)
    return info


def probe(path: str | Path) -> dict[str, Any]:
    """What's in the file. Raises ValueError if it isn't an MP4 we can read."""
    p = Path(path)
    size = p.stat().st_size
    out: dict[str, Any] = {"size": size, "video": None, "audio": None, "duration": 0.0}
    with p.open("rb") as f:
        top = list(_boxes(f, 0, size))
        kinds = [k for k, _, _ in top]
        if b"ftyp" not in kinds or b"moov" not in kinds:
            raise ValueError("not a complete MP4 (no ftyp/moov)")
        brand = _read(f, next(b for k, b, _ in top if k == b"ftyp"), 4).decode("latin-1")
        out["brand"] = brand
        moov = next((b, e) for k, b, e in top if k == b"moov")
        for kind, body, stop in _boxes(f, *moov):
            if kind == b"mvhd":
                version, _ = _full(f, body)
                if version == 1:
                    timescale, duration = struct.unpack(">IQ", _read(f, body + 4 + 16, 12))
                else:
                    timescale, duration = struct.unpack(">II", _read(f, body + 4 + 8, 8))
                out["duration"] = duration / timescale if timescale else 0.0
            elif kind == b"trak":
                t = _track(f, body, stop)
                seconds = t.get("duration_units", 0) / t["timescale"] if t.get("timescale") else 0.0
                if t.get("handler") == "vide":
                    frames = t.get("samples", 0)
                    fps = frames / seconds if seconds else 0.0
                    out["video"] = {
                        "codec": t.get("codec"),
                        "width": t.get("width"),
                        "height": t.get("height"),
                        "frames": frames,
                        "fps": round(fps, 3),
                        "duration": round(seconds, 4),
                    }
                elif t.get("handler") == "soun":
                    out["audio"] = {
                        "codec": t.get("codec"),
                        "channels": t.get("channels"),
                        "sample_rate": t.get("sample_rate"),
                        "duration": round(seconds, 4),
                    }
    return out


def verify(path: str | Path, expect: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """The probe plus what doesn't match `expect` (width, height, fps, duration, audio)."""
    report = probe(path)
    problems: list[str] = []
    video = report.get("video")
    if not video:
        return report, ["no video track"]
    if expect.get("width") and video["width"] != expect["width"]:
        problems.append(f"width {video['width']} ≠ {expect['width']}")
    if expect.get("height") and video["height"] != expect["height"]:
        problems.append(f"height {video['height']} ≠ {expect['height']}")
    if expect.get("fps") and abs(video["fps"] - expect["fps"]) > 0.5:
        problems.append(f"fps {video['fps']} ≠ {expect['fps']}")
    if expect.get("duration"):
        want = expect["duration"]
        # one frame of slack either way
        slack = 1.5 / (expect.get("fps") or 30)
        if abs(video["duration"] - want) > slack:
            problems.append(f"duration {video['duration']}s ≠ {want}s")
        if expect.get("fps"):
            frames = round(want * expect["fps"])
            if abs(video["frames"] - frames) > 1:
                problems.append(f"{video['frames']} frames ≠ {frames}")
    if expect.get("audio") and not report.get("audio"):
        problems.append("no audio track")
    return report, problems
