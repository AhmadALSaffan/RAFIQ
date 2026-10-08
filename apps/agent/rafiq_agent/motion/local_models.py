"""Optional local models for motion (phase 10 of docs/MOTION-ENGINE.md): a whisper that
writes captions without the internet, and an Arabic voice that reads voice-overs the same way.

Nothing here is downloaded until the user presses the button for it, and nothing is kept
unless every file's SHA-256 matches the one pinned below. Both run as separate programs
(whisper.cpp's CLI, Piper) in their own folder under the app's data — never inside Rafiq.

What each pack is, and its licences, is in PACKS; the settings page shows that before the
download starts."""

import asyncio
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from typing import Any

import httpx

from rafiq_agent.config import DATA_DIR

ROOT = Path(DATA_DIR) / "tools" / "local"

_HF_WHISPER = "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1"
_HF_VOICES = "https://huggingface.co/rhasspy/piper-voices/resolve/c10ece1aade47bb51c153c893d14e5bf8e5b7117"

PACKS: dict[str, dict[str, Any]] = {
    "whisper": {
        "files": [
            {
                "name": "whisper-bin-x64.zip",
                "url": "https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip",
                "sha256": "f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c",
                "size": 8573270,
                # only the CLI and what it loads; the archive also carries demos and tests
                "unzip": r"^Release/(whisper-cli\.exe|whisper\.dll|ggml[\w-]*\.dll)$",
            },
            {
                "name": "ggml-small-q8_0.bin",
                "url": f"{_HF_WHISPER}/ggml-small-q8_0.bin",
                "sha256": "49c8fb02b65e6049d5fa6c04f81f53b867b5ec9540406812c643f177317f779f",
                "size": 264464607,
            },
        ],
        "version": "whisper.cpp 1.9.4 · small (q8_0)",
        "licenses": ["whisper.cpp — MIT", "Whisper model weights (OpenAI) — MIT"],
    },
    "voice": {
        "files": [
            {
                "name": "piper_windows_amd64.zip",
                "url": "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip",
                "sha256": "f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea",
                "size": 22477236,
                "unzip": r"^piper/",
            },
            {
                "name": "ar_JO-kareem-medium.onnx",
                "url": f"{_HF_VOICES}/ar/ar_JO/kareem/medium/ar_JO-kareem-medium.onnx",
                "sha256": "9e95cab07b679da603bba17c4dec7ab3111320571964ee95c0379603c086491e",
                "size": 63201294,
            },
            {
                "name": "ar_JO-kareem-medium.onnx.json",
                "url": f"{_HF_VOICES}/ar/ar_JO/kareem/medium/ar_JO-kareem-medium.onnx.json",
                "sha256": "ea6d9b9d9076dbdb6bf5c98c6a141ef154959d2359709b37855727964e7d6c4d",
                "size": 5024,
            },
        ],
        "version": "Piper 2023.11.14-2 · ar_JO kareem (medium)",
        "licenses": [
            "Piper — MIT",
            "eSpeak NG (bundled with Piper, run as a separate program) — GPL-3.0",
            "Voice ar_JO-kareem — MIT (Piper voices); the recordings it was trained on state no licence",
        ],
    },
}

_progress: dict[str, dict[str, Any]] = {name: {"state": "idle"} for name in PACKS}
_locks: dict[str, asyncio.Lock] = {name: asyncio.Lock() for name in PACKS}


class LocalModelError(RuntimeError):
    pass


def _dir(pack: str) -> Path:
    return ROOT / pack


def _state(pack: str) -> dict[str, Any]:
    try:
        return json.loads((_dir(pack) / "state.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _whisper_paths() -> tuple[Path, Path] | None:
    d = _dir("whisper")
    exe, model = d / "Release" / "whisper-cli.exe", d / "ggml-small-q8_0.bin"
    return (exe, model) if _state("whisper").get("ok") and exe.is_file() and model.is_file() else None


def _voice_paths() -> tuple[Path, Path] | None:
    d = _dir("voice")
    exe, model = d / "piper" / "piper.exe", d / "ar_JO-kareem-medium.onnx"
    return (exe, model) if _state("voice").get("ok") and exe.is_file() and model.is_file() and model.with_suffix(".onnx.json").is_file() else None


def whisper_ready() -> bool:
    return _whisper_paths() is not None


def voice_ready() -> bool:
    return _voice_paths() is not None


def status() -> dict[str, Any]:
    ready = {"whisper": whisper_ready(), "voice": voice_ready()}
    return {
        name: {
            "installed": ready[name],
            "version": pack["version"],
            "licenses": pack["licenses"],
            "download_size": sum(f["size"] for f in pack["files"]),
            "progress": dict(_progress[name]),
        }
        for name, pack in PACKS.items()
    }


async def _fetch(client: httpx.AsyncClient, pack: str, spec: dict[str, Any], target: Path, before: int, total: int) -> None:
    digest = hashlib.sha256()
    async with client.stream("GET", spec["url"]) as resp:
        if resp.status_code >= 400:
            raise LocalModelError(f"{spec['name']}: download failed ({resp.status_code})")
        done = 0
        with target.open("wb") as out:
            async for chunk in resp.aiter_bytes(1 << 20):
                out.write(chunk)
                digest.update(chunk)
                done += len(chunk)
                _progress[pack].update(state="downloading", file=spec["name"], done=before + done, total=total)
    got = digest.hexdigest()
    if got != spec["sha256"]:
        target.unlink(missing_ok=True)
        raise LocalModelError(f"{spec['name']}: checksum mismatch (got {got[:12]}…, expected {spec['sha256'][:12]}…) — not installed")


async def install(pack: str) -> dict[str, Any]:
    """Downloads and checks one pack, then tries it once. Call only on the user's say-so."""
    if pack not in PACKS:
        raise LocalModelError(f"unknown pack: {pack}")
    async with _locks[pack]:
        spec = PACKS[pack]
        final = _dir(pack)
        work = ROOT / f".{pack}-download"
        shutil.rmtree(work, ignore_errors=True)
        work.mkdir(parents=True)
        total = sum(f["size"] for f in spec["files"])
        _progress[pack] = {"state": "downloading", "done": 0, "total": total}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(900.0, connect=20.0), follow_redirects=True) as client:
                before = 0
                for f in spec["files"]:
                    await _fetch(client, pack, f, work / f["name"], before, total)
                    before += f["size"]
            _progress[pack].update(state="unpacking")
            for f in spec["files"]:
                if "unzip" not in f:
                    continue
                keep = re.compile(f["unzip"])
                archive = work / f["name"]
                with zipfile.ZipFile(archive) as z:
                    for member in z.infolist():
                        name = member.filename
                        if member.is_dir() or not keep.match(name) or ".." in Path(name).parts or Path(name).is_absolute():
                            continue
                        z.extract(member, work)
                archive.unlink()
            shutil.rmtree(final, ignore_errors=True)
            work.rename(final)
            _progress[pack].update(state="testing")
            (final / "state.json").write_text(json.dumps({"ok": True, "version": spec["version"]}, indent=1), encoding="utf-8")
            try:
                await (_try_whisper() if pack == "whisper" else _try_voice())
            except Exception:
                shutil.rmtree(final, ignore_errors=True)
                raise
            _progress[pack] = {"state": "done"}
            return status()[pack]
        except Exception as exc:
            _progress[pack] = {"state": "failed", "error": str(exc)}
            raise
        finally:
            shutil.rmtree(work, ignore_errors=True)


def remove(pack: str) -> None:
    if pack in PACKS:
        shutil.rmtree(_dir(pack), ignore_errors=True)
        _progress[pack] = {"state": "idle"}


def _run(args: list[str], *, input_bytes: bytes | None = None, timeout: float = 600, cwd: Path | None = None) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        args, input=input_bytes, capture_output=True, timeout=timeout, cwd=cwd,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


# ── Voice (Piper) ──────────────────────────────────────────────────────────────────────


def _speak_sync(text: str) -> bytes:
    paths = _voice_paths()
    if not paths:
        raise LocalModelError("the local voice isn't installed")
    exe, model = paths
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "voice.wav"
        # Piper reads the text from stdin; it adds the Arabic diacritics itself (libtashkeel)
        done = _run([str(exe), "--model", str(model), "--output_file", str(out)], input_bytes=text.encode("utf-8"), cwd=exe.parent, timeout=600)
        if done.returncode != 0 or not out.is_file() or out.stat().st_size < 100:
            raise LocalModelError((done.stderr.decode("utf-8", "replace").strip()[-400:]) or "Piper didn't write any audio")
        return out.read_bytes()


async def speak(text: str, voice: str | None = None) -> tuple[bytes, str]:
    from rafiq_agent.motion.media import MediaError

    del voice  # one Arabic voice ships for now
    try:
        return await asyncio.to_thread(_speak_sync, text), "audio/wav"
    except LocalModelError as exc:
        raise MediaError(str(exc)) from exc


async def _try_voice() -> None:
    data = await asyncio.to_thread(_speak_sync, "مرحبا")
    if not data.startswith(b"RIFF"):
        raise LocalModelError("the local voice didn't produce a WAV file")


# ── Whisper (whisper.cpp) ──────────────────────────────────────────────────────────────

# whisper-cli reads these directly; anything else goes through FFmpeg first
_DIRECT = {".wav", ".mp3", ".flac", ".ogg"}


def _audio_for_whisper(path: Path, tmp: Path) -> Path:
    if path.suffix.lower() in _DIRECT:
        return path
    from rafiq_agent.motion import ffmpeg

    exe = ffmpeg.binary()
    if not exe:
        raise LocalModelError("the local whisper reads WAV, MP3, FLAC and OGG — for video files install FFmpeg (Settings → Video)")
    wav = tmp / "audio.wav"
    done = _run([str(exe), "-hide_banner", "-loglevel", "error", "-y", "-i", str(path), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)], timeout=3600)
    if done.returncode != 0 or not wav.is_file():
        raise LocalModelError(done.stderr.decode("utf-8", "replace").strip()[-300:] or "couldn't read the audio")
    return wav


def _words_from(result: dict[str, Any]) -> list[dict[str, Any]]:
    """whisper-cli with --max-len 1 --split-on-word gives one segment per word."""
    words = []
    for seg in result.get("transcription") or []:
        text = str(seg.get("text", "")).strip()
        offsets = seg.get("offsets") or {}
        if text:
            words.append({"w": text, "t0": round(offsets.get("from", 0) / 1000, 3), "t1": round(offsets.get("to", 0) / 1000, 3)})
    return words


def _transcribe_sync(path: Path, language: str | None) -> dict[str, Any]:
    paths = _whisper_paths()
    if not paths:
        raise LocalModelError("the local whisper isn't installed")
    exe, model = paths
    path = path.resolve()  # the program runs in its own folder
    with tempfile.TemporaryDirectory() as tmp:
        audio = _audio_for_whisper(path, Path(tmp))
        base = Path(tmp) / "out"
        args = [str(exe), "-m", str(model), "-f", str(audio), "-l", language or "auto", "-ml", "1", "-sow", "-oj", "-of", str(base), "-np"]
        done = _run(args, cwd=exe.parent, timeout=6 * 3600)
        out = base.with_suffix(".json")
        if done.returncode != 0 or not out.is_file():
            raise LocalModelError(done.stderr.decode("utf-8", "replace").strip()[-400:] or "whisper didn't finish")
        result = json.loads(out.read_text(encoding="utf-8", errors="replace"))
    words = _words_from(result)
    detected = (result.get("result") or {}).get("language")
    return {"text": " ".join(w["w"] for w in words), "words": words, "language": detected or language}


async def transcribe(path: Path, language: str | None = None) -> dict[str, Any]:
    from rafiq_agent.motion.media import MediaError

    try:
        return await asyncio.to_thread(_transcribe_sync, path, language)
    except LocalModelError as exc:
        raise MediaError(str(exc)) from exc


async def _try_whisper() -> None:
    # one second of silence: proves the program and the model load on this machine
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "silence.wav"
        rate, samples = 16000, 16000
        header = b"RIFF" + (36 + samples * 2).to_bytes(4, "little") + b"WAVEfmt " + (16).to_bytes(4, "little")
        header += (1).to_bytes(2, "little") + (1).to_bytes(2, "little") + rate.to_bytes(4, "little") + (rate * 2).to_bytes(4, "little")
        header += (2).to_bytes(2, "little") + (16).to_bytes(2, "little") + b"data" + (samples * 2).to_bytes(4, "little")
        wav.write_bytes(header + bytes(samples * 2))
        await asyncio.to_thread(_transcribe_sync, wav, "ar")
