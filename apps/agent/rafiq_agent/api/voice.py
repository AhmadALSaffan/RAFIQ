"""Speech to text for the microphone in the composer.

The recording is sent with the credentials of an agent the user already configured on a
provider that transcribes (OpenAI, Groq or Azure), or to ElevenLabs (Scribe) with the key
saved for voice-overs. Settings → Voice says which; "auto" takes the first that's there.
"""

import contextlib
import logging
import tempfile
from pathlib import Path

import httpx
import litellm
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rafiq_agent.api.deps import require_token
from rafiq_agent.auth.resolve import credentials_for
from rafiq_agent.core.agent_runtime import load_settings
from rafiq_agent.i18n import tr
from rafiq_agent.llm.presets import call_kwargs
from rafiq_agent.schemas.voice import Transcript
from rafiq_agent.storage.db import get_session
from rafiq_agent.storage.models import LlmModel

log = logging.getLogger(__name__)
router = APIRouter(tags=["voice"], dependencies=[Depends(require_token)])

# Providers that can turn speech into text, in the order they're tried.
SPEECH_PROVIDERS = ("openai", "groq", "azure")
MAX_BYTES = 25 * 1024 * 1024  # what the providers themselves accept
# Each provider's own speech model, used when the setting names none ("whisper-1" is
# OpenAI's name; sent as-is with a Groq key, litellm would ask OpenAI and fail).
DEFAULT_SPEECH_MODEL = {"openai": "whisper-1", "groq": "whisper-large-v3"}
ELEVENLABS_STT = "https://api.elevenlabs.io/v1/speech-to-text"
ELEVENLABS_STT_MODEL = "scribe_v1"


async def elevenlabs_transcribe(data: bytes, filename: str, key: str) -> str:
    """ElevenLabs Scribe. The language is left to it: people mix Arabic and English."""
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=15.0)) as client:
        resp = await client.post(
            ELEVENLABS_STT,
            headers={"xi-api-key": key},
            data={"model_id": ELEVENLABS_STT_MODEL},
            files={"file": (filename, data, "application/octet-stream")},
        )
    if resp.status_code >= 400:
        raise RuntimeError(f"ElevenLabs {resp.status_code}: {resp.text[:200]}")
    return str(resp.json().get("text") or "").strip()


def speech_model(setting: str | None, provider: str) -> str:
    """The litellm model name for transcribing with `provider`: always prefixed with the
    provider, so the request goes where the key belongs."""
    name = (setting or "").strip() or "whisper-1"
    if "/" in name:
        return name
    if provider == "openai":
        return name
    if provider == "groq" and name == "whisper-1":
        name = DEFAULT_SPEECH_MODEL["groq"]
    return f"{provider}/{name}"


@router.post("/transcribe", response_model=Transcript)
async def transcribe(
    audio: UploadFile = File(...),
    language: str | None = Form(default=None),
    session: AsyncSession = Depends(get_session),
) -> Transcript:
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail=tr("التسجيل فاضي."))
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail=tr("التسجيل طويل كتير — جرّب أقصر."))

    from rafiq_agent.motion import media

    settings = await load_settings()
    setting = settings.transcribe_model or "whisper-1"
    chosen = settings.listen_provider
    wanted = chosen if chosen not in ("auto", "elevenlabs") else (setting.split("/")[0] if "/" in setting else None)

    models = (
        (await session.execute(select(LlmModel).where(LlmModel.provider.in_(SPEECH_PROVIDERS))))
        .scalars()
        .all()
    )
    order = (wanted,) if chosen not in ("auto", "elevenlabs") else ((wanted,) + SPEECH_PROVIDERS if wanted else SPEECH_PROVIDERS)
    agent = None if chosen == "elevenlabs" else next((m for provider in order for m in models if m.provider == provider), None)
    eleven_key = media.secret("elevenlabs") if agent is None and chosen in ("auto", "elevenlabs") else None
    if agent is None and eleven_key:
        try:
            return Transcript(text=await elevenlabs_transcribe(data, audio.filename or "speech.webm", eleven_key))
        except Exception as exc:  # noqa: BLE001 - shown to the user as-is
            log.info("transcription failed", exc_info=True)
            raise HTTPException(status_code=502, detail=tr("ما قدرت أفهم التسجيل: {0}", str(exc))) from exc
    if agent is None:
        if chosen == "elevenlabs":
            detail = tr("ضيف مفتاح ElevenLabs من الإعدادات ← الفيديو.")
        elif chosen != "auto":
            detail = tr("ما في نموذج من {0} — ضيف واحد من صفحة النماذج، أو خلّي «مين بيسمعك» تلقائي.", {"openai": "OpenAI", "groq": "Groq", "azure": "Azure"}[chosen])
        else:
            detail = tr("التسجيل الصوتي بده نموذج من OpenAI أو Groq أو Azure، أو مفتاح ElevenLabs — ضيف واحد منهم.")
        raise HTTPException(status_code=400, detail=detail)

    model_name = speech_model(setting, agent.provider)
    creds = credentials_for(agent)
    connection = call_kwargs(agent.provider, creds.api_key, creds.base_url, agent.options)
    connection.pop("api_version", None)

    # litellm wants a file on disk with a real extension — that's how the provider knows
    # which audio format it's getting.
    suffix = Path(audio.filename or "").suffix or ".webm"
    with tempfile.NamedTemporaryFile(prefix="rafiq-voice-", suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        path = Path(tmp.name)
    try:
        with path.open("rb") as handle:
            response = await litellm.atranscription(
                model=model_name,
                file=handle,
                language=language or None,
                **connection,
            )
        text = (getattr(response, "text", None) or "").strip()
    except Exception as exc:  # noqa: BLE001 - shown to the user as-is
        log.info("transcription failed", exc_info=True)
        raise HTTPException(status_code=502, detail=tr("ما قدرت أفهم التسجيل: {0}", str(exc))) from exc
    finally:
        with contextlib.suppress(OSError):
            path.unlink()
    return Transcript(text=text)


class SpeakIn(BaseModel):
    text: str = Field(min_length=1, max_length=6000)
    # Windows has no voice for the reply's language: use whichever other voice there is.
    fallback: bool = False


async def _fallback_provider(session: AsyncSession, voice_over: str) -> str | None:
    """A voice to use when Windows has none for the language: the local voice (Arabic, on
    this machine), then an OpenAI model's voice, then the one chosen for voice-overs."""
    from rafiq_agent.motion import local_models

    if local_models.voice_ready():
        return "local"
    if await session.scalar(select(LlmModel.id).where(LlmModel.provider == "openai").limit(1)):
        return "openai"
    return voice_over if voice_over not in ("none", "", None) else None


@router.post("/speak")
async def speak(body: SpeakIn, session: AsyncSession = Depends(get_session)) -> Response:
    """A chat reply read out loud by the provider chosen in Settings → Voice. Windows' own
    voices ("system") are played by the app itself and never come here."""
    from rafiq_agent.motion import media

    settings = await load_settings()
    provider, voice = settings.speak_provider, settings.speak_voice
    if provider == "system":
        if not body.fallback:
            raise HTTPException(status_code=400, detail=tr("القراءة بصوت ويندوز بتصير بالتطبيق نفسه."))
        provider, voice = await _fallback_provider(session, settings.tts_provider), None
        if provider is None:
            raise HTTPException(
                status_code=400,
                detail=tr("ما في صوت عربي على ويندوز. نزّل واحد من إعدادات ويندوز ← الوقت واللغة ← الكلام، أو نزّل الصوت المحلي من إعدادات الفيديو."),
            )
    try:
        data, mime = await media.speak(session, body.text, provider, voice)
    except media.MediaError as exc:
        raise HTTPException(status_code=502, detail=tr("ما قدرت أقرأ الرد: {0}", str(exc))) from exc
    return Response(content=data, media_type=mime, headers={"Cache-Control": "no-store"})
