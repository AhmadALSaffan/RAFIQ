"""Speech to text for the microphone in the composer.

There's no separate key to enter: the recording is sent with the credentials of an agent
the user already configured on a provider that transcribes (OpenAI, Groq or Azure).
"""

import contextlib
import logging
import tempfile
from pathlib import Path

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

    settings = await load_settings()
    model_name = settings.transcribe_model or "whisper-1"
    wanted = model_name.split("/")[0] if "/" in model_name else None

    models = (
        (await session.execute(select(LlmModel).where(LlmModel.provider.in_(SPEECH_PROVIDERS))))
        .scalars()
        .all()
    )
    order = (wanted,) + SPEECH_PROVIDERS if wanted else SPEECH_PROVIDERS
    agent = next((m for provider in order for m in models if m.provider == provider), None)
    if agent is None:
        raise HTTPException(
            status_code=400,
            detail=tr("التسجيل الصوتي بده نموذج من OpenAI أو Groq أو Azure — ضيف واحد من صفحة النماذج."),
        )

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
