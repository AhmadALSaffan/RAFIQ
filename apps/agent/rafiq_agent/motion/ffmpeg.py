"""FFmpeg, only when it's needed (docs/MOTION-ENGINE.md, phase 7): H.265 when the GPU's
WebCodecs encoder doesn't do it, and turning odd input formats (MOV ProRes, MKV, 10-bit
HEVC…) into a working copy the engine can decode.

It is downloaded only when the user presses the button, from an LGPL build (no GPL parts),
and only kept if its SHA-256 matches. The build tested with this version of Rafiq is pinned
by hash; the publisher rotates its builds after about a month, so if the pinned one is gone
the newest build of the same line is used instead — checked against the checksum file the
publisher releases with it — and the result says which one was used.

After installing, each hardware encoder is actually tried (one second of test video), and
the fastest one that works is used."""

import asyncio
import hashlib
import json
import re
import shutil
import subprocess
import zipfile
from pathlib import Path
from typing import Any

import httpx

from rafiq_agent.config import DATA_DIR

ROOT = Path(DATA_DIR) / "tools" / "ffmpeg"
STATE = ROOT / "state.json"

PINNED = {
    "version": "9.0.2 (LGPL, shared)",
    "url": "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-07-13-07/ffmpeg-n9.0.2-22-g46d8f462ee-win64-lgpl-shared-9.0.zip",
    "sha256": "7b3207b46b1472142aaef0f45a1093bfa861aa43dae605567ac6244d8f3296a4",
    "size": 77229626,
}
FALLBACK_RELEASE = "https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest"
FALLBACK_ASSET = re.compile(r"^ffmpeg-n9\.0-latest-win64-lgpl-shared-9\.0\.zip$")

# Tried in this order; the first that encodes a test clip wins.
HEVC_ENCODERS = ["hevc_nvenc", "hevc_amf", "hevc_qsv", "libkvazaar"]
H264_ENCODERS = ["h264_nvenc", "h264_amf", "h264_qsv", "libopenh264"]

_progress: dict[str, Any] = {"state": "idle"}
_lock = asyncio.Lock()


class FfmpegError(RuntimeError):
    pass


def _load_state() -> dict[str, Any]:
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def binary() -> Path | None:
    state = _load_state()
    path = Path(state["path"]) if state.get("path") else None
    return path if path and path.is_file() else None


def status() -> dict[str, Any]:
    state = _load_state()
    return {
        "installed": binary() is not None,
        "version": state.get("version"),
        "source": state.get("source"),
        "encoders": state.get("encoders", {}),
        "hevc": state.get("hevc"),
        "h264": state.get("h264"),
        "download_size": PINNED["size"],
        "progress": dict(_progress),
    }


def _run(args: list[str], timeout: float = 120) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args, capture_output=True, text=True, timeout=timeout, encoding="utf-8", errors="replace",
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


def detect(path: Path) -> dict[str, Any]:
    """Which encoders this build has, and which of them actually work on this machine."""
    listed = _run([str(path), "-hide_banner", "-encoders"]).stdout
    have = {name for name in HEVC_ENCODERS + H264_ENCODERS + ["aac"] if re.search(rf"\s{re.escape(name)}\s", listed)}
    works: dict[str, bool] = {}
    for name in HEVC_ENCODERS + H264_ENCODERS:
        if name not in have:
            works[name] = False
            continue
        try:
            out = _run([str(path), "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30", "-t", "1", "-c:v", name, "-f", "null", "-"], timeout=60)
            works[name] = out.returncode == 0
        except subprocess.TimeoutExpired:
            works[name] = False
    return {
        "encoders": works,
        "aac": "aac" in have,
        "hevc": next((n for n in HEVC_ENCODERS if works.get(n)), None),
        "h264": next((n for n in H264_ENCODERS if works.get(n)), None),
    }


async def _download(client: httpx.AsyncClient, url: str, target: Path) -> str:
    digest = hashlib.sha256()
    async with client.stream("GET", url) as resp:
        if resp.status_code >= 400:
            raise FfmpegError(f"download failed: {resp.status_code}")
        total = int(resp.headers.get("content-length") or 0)
        done = 0
        with target.open("wb") as out:
            async for chunk in resp.aiter_bytes(1 << 20):
                out.write(chunk)
                digest.update(chunk)
                done += len(chunk)
                _progress.update(state="downloading", done=done, total=total)
    return digest.hexdigest()


async def _fallback(client: httpx.AsyncClient) -> tuple[str, str, str]:
    """(url, expected sha256, version) of the newest build in the same line."""
    release = (await client.get(FALLBACK_RELEASE, headers={"Accept": "application/vnd.github+json"})).json()
    asset = next((a for a in release.get("assets", []) if FALLBACK_ASSET.match(a["name"])), None)
    sums = next((a for a in release.get("assets", []) if a["name"] == "checksums.sha256"), None)
    if not asset or not sums:
        raise FfmpegError("no LGPL build found to download")
    text = (await client.get(sums["browser_download_url"])).text
    match = re.search(rf"([0-9a-f]{{64}})\s+\*?{re.escape(asset['name'])}", text)
    if not match:
        raise FfmpegError("the publisher's checksum for that build is missing")
    return asset["browser_download_url"], match.group(1), f"9.0 latest ({release.get('tag_name')})"


async def install() -> dict[str, Any]:
    """Downloads, verifies, unpacks and tests FFmpeg. Call only on the user's say-so."""
    async with _lock:
        ROOT.mkdir(parents=True, exist_ok=True)
        archive = ROOT / "download.zip"
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=20.0), follow_redirects=True) as client:
                url, expected, version, source = PINNED["url"], PINNED["sha256"], PINNED["version"], "pinned"
                head = await client.head(url)
                if head.status_code >= 400:
                    url, expected, version = await _fallback(client)
                    source = "publisher checksum"
                got = await _download(client, url, archive)
            if got != expected:
                raise FfmpegError(f"checksum mismatch (got {got[:12]}…, expected {expected[:12]}…) — not installed")
            _progress.update(state="unpacking")
            target = ROOT / "build"
            shutil.rmtree(target, ignore_errors=True)
            with zipfile.ZipFile(archive) as z:
                z.extractall(target)
            exe = next(target.rglob("bin/ffmpeg.exe"), None)
            if not exe:
                raise FfmpegError("ffmpeg.exe isn't in the archive")
            _progress.update(state="testing")
            found = await asyncio.to_thread(detect, exe)
            state = {"path": str(exe), "version": version, "source": source, "sha256": got, **found}
            STATE.write_text(json.dumps(state, indent=1), encoding="utf-8")
            _progress.update(state="done")
            return status()
        except Exception as exc:
            _progress.update(state="failed", error=str(exc))
            raise
        finally:
            archive.unlink(missing_ok=True)


def remove() -> None:
    shutil.rmtree(ROOT, ignore_errors=True)
    _progress.clear()
    _progress["state"] = "idle"


def transcode(src: Path, dst: Path, codec: str, bitrate: int, audio: bool) -> str:
    """Re-encodes an export's video to H.264/H.265 with the best working encoder; the audio is
    copied. Returns the encoder used."""
    exe = binary()
    if not exe:
        raise FfmpegError("FFmpeg isn't installed")
    state = _load_state()
    encoder = state.get("hevc") if codec == "h265" else state.get("h264")
    if not encoder:
        raise FfmpegError(f"no working {codec.upper()} encoder on this machine")
    args = [str(exe), "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), "-map", "0:v:0", "-c:v", encoder, "-b:v", str(bitrate), "-maxrate", str(int(bitrate * 1.5)), "-bufsize", str(bitrate * 2)]
    if codec == "h265":
        args += ["-tag:v", "hvc1"]
    args += ["-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"]
    if audio:
        args += ["-map", "0:a:0?", "-c:a", "copy"]
    args += ["-movflags", "+faststart", str(dst)]
    out = _run(args, timeout=24 * 3600)
    if out.returncode != 0:
        raise FfmpegError(out.stderr.strip()[-500:] or "ffmpeg failed")
    return encoder


def working_copy(src: Path, dst: Path) -> str:
    """A video the engine can decode (H.264 + AAC, 8-bit) from one it can't."""
    exe = binary()
    if not exe:
        raise FfmpegError("FFmpeg isn't installed")
    encoder = _load_state().get("h264") or "libopenh264"
    out = _run([str(exe), "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), "-c:v", encoder, "-b:v", "20M", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(dst)], timeout=24 * 3600)
    if out.returncode != 0:
        raise FfmpegError(out.stderr.strip()[-500:] or "ffmpeg failed")
    return encoder
