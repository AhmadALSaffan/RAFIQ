"""Outside services for media, all with the user's own keys (from the agents they set up,
or kept in the keychain): text to speech, speech to text with word timing, stock photos
(credit kept with the file), and image generation.

Every call here sends the user's text or audio to the provider they chose, and only there;
the tools that use these go through the "media" permission first."""

import base64
import contextlib
import io
import mimetypes
import tempfile
import wave
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rafiq_agent.storage.models import LlmModel, MotionAsset, MotionProject
from rafiq_agent.storage.secrets import get_named_secret

TIMEOUT = httpx.Timeout(120.0, connect=15.0)
SECRET_NAMES = {
    "elevenlabs": "media:elevenlabs",
    "azure_speech": "media:azure_speech",
    "azure_speech_region": "media:azure_speech_region",
    "unsplash": "media:unsplash",
    "pexels": "media:pexels",
}


class MediaError(RuntimeError):
    pass


def secret(name: str) -> str | None:
    return get_named_secret(SECRET_NAMES[name])


async def _agent(session: AsyncSession, providers: tuple[str, ...]) -> LlmModel | None:
    rows = (await session.execute(select(LlmModel).where(LlmModel.provider.in_(providers)))).scalars().all()
    return next((m for p in providers for m in rows if m.provider == p), None)


def _openai_connection(agent: LlmModel) -> tuple[str, dict[str, str]]:
    from rafiq_agent.auth.resolve import credentials_for

    creds = credentials_for(agent)
    base = (creds.base_url or "https://api.openai.com/v1").rstrip("/")
    if agent.provider == "groq" and not creds.base_url:
        base = "https://api.groq.com/openai/v1"
    return base, {"Authorization": f"Bearer {creds.api_key}"}


async def store(
    session: AsyncSession,
    project: MotionProject,
    data: bytes,
    name: str,
    mime: str,
    kind: str,
    source: str,
    credit: str | None = None,
    license: str | None = None,
    meta: dict[str, Any] | None = None,
    width: int | None = None,
    height: int | None = None,
    duration: float | None = None,
) -> MotionAsset:
    """Writes a file into the project's assets/ and records it."""
    folder = Path(project.folder) / "assets"
    folder.mkdir(parents=True, exist_ok=True)
    asset = MotionAsset(
        project_id=project.id, kind=kind, name=name[:120], mime=mime, path="", size=len(data), source=source,
        credit=credit, license=license, meta=meta, width=width, height=height, duration=duration,
    )
    session.add(asset)
    await session.flush()
    suffix = Path(name).suffix or mimetypes.guess_extension(mime) or ".bin"
    path = folder / f"{asset.id}{suffix}"
    path.write_bytes(data)
    asset.path = str(path)
    await session.flush()
    return asset


# ── Text to speech ─────────────────────────────────────────────────────────────────────


async def store_voiceover(session: AsyncSession, project: MotionProject, data: bytes, mime: str, text: str) -> MotionAsset:
    """A voice-over as an asset, named for what it really is; a WAV's length is read from its
    header (the engine measures compressed ones when it decodes them)."""
    duration = None
    if mime == "audio/wav":
        with contextlib.suppress(wave.Error, EOFError), wave.open(io.BytesIO(data)) as w:
            duration = round(w.getnframes() / float(w.getframerate()), 3)
    name = "voiceover.wav" if mime == "audio/wav" else "voiceover.mp3"
    return await store(session, project, data, name, mime, "audio", "tts", meta={"text": text}, duration=duration)


async def speak(session: AsyncSession, text: str, provider: str, voice: str | None) -> tuple[bytes, str]:
    """(audio bytes, mime) for `text`. Raises MediaError with a reason the user can act on."""
    text = text.strip()
    if not text:
        raise MediaError("nothing to say")
    if provider in ("none", "", None):
        raise MediaError("no voice provider is set (Settings → Video)")
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        if provider == "openai":
            agent = await _agent(session, ("openai",))
            if not agent:
                raise MediaError("add an OpenAI model first — its key is used for the voice")
            base, headers = _openai_connection(agent)
            resp = await client.post(
                f"{base}/audio/speech",
                headers=headers,
                json={"model": "gpt-4o-mini-tts", "input": text, "voice": voice or "alloy", "response_format": "mp3"},
            )
            if resp.status_code == 404 or resp.status_code == 400:
                resp = await client.post(
                    f"{base}/audio/speech", headers=headers, json={"model": "tts-1", "input": text, "voice": voice or "alloy", "response_format": "mp3"}
                )
            if resp.status_code >= 400:
                raise MediaError(f"OpenAI voice failed: {resp.status_code} {resp.text[:200]}")
            return resp.content, "audio/mpeg"
        if provider == "elevenlabs":
            key = secret("elevenlabs")
            if not key:
                raise MediaError("add an ElevenLabs key in Settings → Video")
            resp = await client.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{voice or 'EXAVITQu4vr4xnSDxMaL'}",
                headers={"xi-api-key": key, "accept": "audio/mpeg"},
                json={"text": text, "model_id": "eleven_multilingual_v2"},
            )
            if resp.status_code >= 400:
                raise MediaError(f"ElevenLabs failed: {resp.status_code} {resp.text[:200]}")
            return resp.content, "audio/mpeg"
        if provider == "azure":
            key = secret("azure_speech")
            region = secret("azure_speech_region") or "westeurope"
            if not key:
                raise MediaError("add an Azure Speech key and region in Settings → Video")
            name = voice or "ar-SA-HamedNeural"
            lang = "-".join(name.split("-")[:2])
            ssml = (
                f"<speak version='1.0' xml:lang='{lang}'><voice name='{name}'>"
                + text.replace("&", "&amp;").replace("<", "&lt;")
                + "</voice></speak>"
            )
            resp = await client.post(
                f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1",
                headers={
                    "Ocp-Apim-Subscription-Key": key,
                    "Content-Type": "application/ssml+xml",
                    "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
                },
                content=ssml.encode("utf-8"),
            )
            if resp.status_code >= 400:
                raise MediaError(f"Azure Speech failed: {resp.status_code} {resp.text[:200]}")
            return resp.content, "audio/mpeg"
        if provider == "local":
            from rafiq_agent.motion import local_models

            return await local_models.speak(text, voice)
    raise MediaError(f"unknown voice provider {provider!r}")


# ── Speech to text, word by word ───────────────────────────────────────────────────────


async def transcribe_words(session: AsyncSession, path: Path, language: str | None = None) -> dict[str, Any]:
    """{"text", "words": [{"w","t0","t1"}]} — from the local whisper when the user installed
    it (the audio never leaves the machine), else from their OpenAI or Groq agent (Whisper with
    word timestamps)."""
    from rafiq_agent.motion import local_models

    if local_models.whisper_ready():
        return await local_models.transcribe(path, language)
    agent = await _agent(session, ("openai", "groq"))
    if agent is None:
        raise MediaError("captions need the local whisper (Settings → Video) or an OpenAI or Groq model (Whisper)")
    base, headers = _openai_connection(agent)
    model = "whisper-large-v3" if agent.provider == "groq" else "whisper-1"
    data = {"model": model, "response_format": "verbose_json", "timestamp_granularities[]": "word"}
    if language:
        data["language"] = language
    async with httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=15.0)) as client:
        with path.open("rb") as handle:
            resp = await client.post(
                f"{base}/audio/transcriptions",
                headers=headers,
                data=data,
                files={"file": (path.name, handle, mimetypes.guess_type(path.name)[0] or "application/octet-stream")},
            )
    if resp.status_code >= 400:
        raise MediaError(f"transcription failed: {resp.status_code} {resp.text[:200]}")
    body = resp.json()
    words = [
        {"w": str(w.get("word", "")).strip(), "t0": float(w.get("start", 0)), "t1": float(w.get("end", 0))}
        for w in body.get("words") or []
        if str(w.get("word", "")).strip()
    ]
    return {"text": body.get("text", ""), "words": words, "language": body.get("language")}


# ── Stock photos ───────────────────────────────────────────────────────────────────────


async def stock_search(provider: str, query: str, orientation: str | None = None) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        if provider == "unsplash":
            key = secret("unsplash")
            if not key:
                raise MediaError("add an Unsplash access key in Settings → Video")
            params: dict[str, Any] = {"query": query, "per_page": 12}
            if orientation:
                params["orientation"] = orientation
            resp = await client.get("https://api.unsplash.com/search/photos", params=params, headers={"Authorization": f"Client-ID {key}"})
            if resp.status_code >= 400:
                raise MediaError(f"Unsplash: {resp.status_code}")
            return [
                {
                    "id": p["id"],
                    "provider": "unsplash",
                    "thumb": p["urls"]["small"],
                    "url": p["urls"]["regular"],
                    "download_location": p["links"]["download_location"],
                    "width": p["width"],
                    "height": p["height"],
                    "credit": f"Photo by {p['user']['name']} on Unsplash",
                    "author_url": p["user"]["links"]["html"],
                    "license": "Unsplash License",
                    "alt": p.get("alt_description") or "",
                }
                for p in resp.json().get("results", [])
            ]
        if provider == "pexels":
            key = secret("pexels")
            if not key:
                raise MediaError("add a Pexels API key in Settings → Video")
            params = {"query": query, "per_page": 12}
            if orientation:
                params["orientation"] = orientation
            resp = await client.get("https://api.pexels.com/v1/search", params=params, headers={"Authorization": key})
            if resp.status_code >= 400:
                raise MediaError(f"Pexels: {resp.status_code}")
            return [
                {
                    "id": str(p["id"]),
                    "provider": "pexels",
                    "thumb": p["src"]["medium"],
                    "url": p["src"]["large2x"],
                    "width": p["width"],
                    "height": p["height"],
                    "credit": f"Photo by {p['photographer']} on Pexels",
                    "author_url": p["photographer_url"],
                    "license": "Pexels License",
                    "alt": p.get("alt") or "",
                }
                for p in resp.json().get("photos", [])
            ]
    raise MediaError(f"unknown stock provider {provider!r}")


async def stock_download(item: dict[str, Any]) -> bytes:
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
        if item.get("provider") == "unsplash" and item.get("download_location"):
            # Unsplash's terms: tell them about the download.
            key = secret("unsplash")
            with contextlib.suppress(httpx.HTTPError):
                await client.get(item["download_location"], headers={"Authorization": f"Client-ID {key}"})
        resp = await client.get(item["url"])
        if resp.status_code >= 400:
            raise MediaError(f"download failed: {resp.status_code}")
        return resp.content


# ── Image generation ───────────────────────────────────────────────────────────────────


async def generate_image(session: AsyncSession, prompt: str, size: str = "1024x1024") -> bytes:
    agent = await _agent(session, ("openai",))
    if agent is None:
        raise MediaError("image generation needs an OpenAI model (its key is used)")
    base, headers = _openai_connection(agent)
    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=15.0)) as client:
        resp = await client.post(f"{base}/images/generations", headers=headers, json={"model": "gpt-image-1", "prompt": prompt, "size": size, "n": 1})
        if resp.status_code >= 400:
            resp = await client.post(
                f"{base}/images/generations", headers=headers, json={"model": "dall-e-3", "prompt": prompt, "size": size, "n": 1, "response_format": "b64_json"}
            )
        if resp.status_code >= 400:
            raise MediaError(f"image generation failed: {resp.status_code} {resp.text[:200]}")
        item = resp.json()["data"][0]
        if item.get("b64_json"):
            return base64.b64decode(item["b64_json"])
        got = await client.get(item["url"])
        return got.content


def temp_copy(data: bytes, suffix: str) -> Path:
    with tempfile.NamedTemporaryFile(prefix="rafiq-media-", suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        return Path(tmp.name)
