"""A free model on this computer, with one click: Ollama, installed and fed by Rafiq.

The models page offers it when the user has no key or doesn't want to pay. Rafiq checks for
Ollama, installs it on Windows (the official installer, its signature checked before it runs),
downloads a model that speaks Arabic and uses tools, and adds it like any other model. On a Mac
the user installs Ollama from its site (it opens) and Rafiq does the rest.

Nothing here runs unless the user presses the button; progress is kept in memory and read by
the page (GET /models/local).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

import httpx
import psutil

from rafiq_agent.config import DATA_DIR

log = logging.getLogger(__name__)

OLLAMA = "http://127.0.0.1:11434"
INSTALLER_URL = "https://ollama.com/download/OllamaSetup.exe"
DOWNLOAD_PAGE = "https://ollama.com/download"
CREATE_NO_WINDOW = 0x08000000

# What the page offers. Qwen 3 speaks Arabic well and calls tools; the bigger one wants the RAM.
RECOMMENDED: list[dict[str, Any]] = [
    {"tag": "qwen3:4b", "name": "Qwen 3 · 4B", "size_gb": 2.6, "min_ram_gb": 8},
    {"tag": "qwen3:8b", "name": "Qwen 3 · 8B", "size_gb": 5.2, "min_ram_gb": 16},
]
ALLOWED_TAGS = {m["tag"] for m in RECOMMENDED}

# One install and one download at a time, watched by the page.
state: dict[str, Any] = {"install": None, "pull": None}
_lock = asyncio.Lock()


def ram_gb() -> float:
    return round(psutil.virtual_memory().total / 1024**3, 1)


def suggested() -> str:
    """The bigger model when the computer can carry it."""
    return "qwen3:8b" if ram_gb() >= 16 else "qwen3:4b"


def _binary() -> Path | None:
    found = shutil.which("ollama")
    if found:
        return Path(found)
    if sys.platform == "win32":
        guess = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Ollama" / "ollama.exe"
        return guess if guess.exists() else None
    if sys.platform == "darwin":
        app = Path("/Applications/Ollama.app/Contents/Resources/ollama")
        return app if app.exists() else None
    return None


async def _tags() -> list[str] | None:
    """The models Ollama has, or None when it isn't answering."""
    try:
        async with httpx.AsyncClient(timeout=2.5) as client:
            response = await client.get(f"{OLLAMA}/api/tags")
            response.raise_for_status()
            return [m.get("name", "") for m in response.json().get("models", [])]
    except (httpx.HTTPError, ValueError):
        return None


async def status() -> dict[str, Any]:
    tags = await _tags()
    return {
        "running": tags is not None,
        "installed": tags is not None or _binary() is not None,
        "models": tags or [],
        "can_install": sys.platform == "win32",
        "download_page": DOWNLOAD_PAGE,
        "ram_gb": ram_gb(),
        "suggested": suggested(),
        "recommended": RECOMMENDED,
        "install": state["install"],
        "pull": state["pull"],
    }


async def start() -> bool:
    """Start Ollama when it's installed but not running; True once it answers."""
    if await _tags() is not None:
        return True
    binary = _binary()
    if binary is None:
        return False
    if sys.platform == "darwin" and Path("/Applications/Ollama.app").exists():
        subprocess.Popen(["open", "-a", "Ollama"])
    else:
        kwargs: dict[str, Any] = {"stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
        if sys.platform == "win32":
            kwargs["creationflags"] = CREATE_NO_WINDOW | 0x00000008  # DETACHED_PROCESS
        else:
            kwargs["start_new_session"] = True
        subprocess.Popen([str(binary), "serve"], **kwargs)
    for _ in range(40):
        await asyncio.sleep(0.5)
        if await _tags() is not None:
            return True
    return False


def _signed_by_ollama(path: Path) -> bool:
    """The installer carries a valid Authenticode signature from Ollama."""
    script = (
        f"$s = Get-AuthenticodeSignature -LiteralPath '{path}'; "
        "if ($s.Status -eq 'Valid' -and $s.SignerCertificate.Subject -match 'Ollama') { 'ok' } else { $s.Status }"
    )
    shell = shutil.which("powershell") or str(Path(os.environ.get("SYSTEMROOT", r"C:\Windows")) / "System32/WindowsPowerShell/v1.0/powershell.exe")
    out = subprocess.run([shell, "-NoProfile", "-NonInteractive", "-Command", script], capture_output=True, text=True, timeout=60, creationflags=CREATE_NO_WINDOW)
    return out.stdout.strip() == "ok"


async def install() -> None:
    """Download the official installer, check its signature, run it quietly (per user, no
    admin), then wait for Ollama to answer. Progress goes to state["install"]."""
    if sys.platform != "win32":
        raise RuntimeError("install from the download page on this system")
    async with _lock:
        state["install"] = {"status": "downloading", "completed": 0, "total": 0, "error": None}
        target = DATA_DIR / "downloads" / "OllamaSetup.exe"
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            async with (
                httpx.AsyncClient(timeout=httpx.Timeout(30, read=120), follow_redirects=True) as client,
                client.stream("GET", INSTALLER_URL) as response,
            ):
                response.raise_for_status()
                state["install"]["total"] = int(response.headers.get("content-length") or 0)
                with target.open("wb") as file:
                    async for chunk in response.aiter_bytes(1 << 20):
                        file.write(chunk)
                        state["install"]["completed"] += len(chunk)
            state["install"]["status"] = "checking"
            if not await asyncio.to_thread(_signed_by_ollama, target):
                raise RuntimeError("the installer isn't signed by Ollama")
            state["install"]["status"] = "installing"
            process = await asyncio.create_subprocess_exec(
                str(target), "/VERYSILENT", "/NORESTART", "/SUPPRESSMSGBOXES", creationflags=CREATE_NO_WINDOW
            )
            if await asyncio.wait_for(process.wait(), timeout=900) != 0:
                raise RuntimeError("the installer didn't finish")
            state["install"]["status"] = "starting"
            if not await start():
                raise RuntimeError("Ollama didn't start")
            state["install"]["status"] = "done"
        except Exception as e:  # noqa: BLE001 - shown on the page
            log.warning("ollama install failed", exc_info=True)
            state["install"] = {**(state["install"] or {}), "status": "error", "error": str(e)[:300]}
        finally:
            target.unlink(missing_ok=True)


async def pull(tag: str) -> None:
    """Download one of the offered models into Ollama, then add it to Rafiq."""
    if tag not in ALLOWED_TAGS:
        raise ValueError(tag)
    async with _lock:
        state["pull"] = {"tag": tag, "status": "starting", "completed": 0, "total": 0, "error": None, "model_id": None}
        try:
            if not await start():
                raise RuntimeError("Ollama isn't running")
            async with (
                httpx.AsyncClient(timeout=httpx.Timeout(30, read=600)) as client,
                client.stream("POST", f"{OLLAMA}/api/pull", json={"model": tag, "stream": True}) as response,
            ):
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    event = json.loads(line)
                    if event.get("error"):
                        raise RuntimeError(event["error"])
                    state["pull"]["status"] = "downloading" if event.get("total") else event.get("status", "")
                    if event.get("total"):
                        state["pull"]["total"] = int(event["total"])
                        state["pull"]["completed"] = int(event.get("completed") or 0)
            state["pull"]["status"] = "adding"
            state["pull"]["model_id"] = await register(tag)
            state["pull"]["status"] = "done"
        except Exception as e:  # noqa: BLE001 - shown on the page
            log.warning("ollama pull failed", exc_info=True)
            state["pull"] = {**(state["pull"] or {}), "status": "error", "error": str(e)[:300]}


async def register(tag: str) -> str:
    """Add the downloaded model to Rafiq (once), checked like any other."""
    from sqlalchemy import select

    from rafiq_agent.api.models import _apply_verification
    from rafiq_agent.llm.discovery import verify_model
    from rafiq_agent.storage.db import SessionLocal
    from rafiq_agent.storage.models import LlmModel

    name = next((m["name"] for m in RECOMMENDED if m["tag"] == tag), tag)
    async with SessionLocal() as session:
        existing = (
            await session.execute(select(LlmModel).where(LlmModel.provider == "ollama", LlmModel.model_id == tag))
        ).scalars().first()
        if existing is not None:
            return existing.id
        result = await verify_model("ollama", tag, None, None)
        model = LlmModel(name=f"{name} · Ollama", provider="ollama", model_id=tag, auth_method="api_key")
        _apply_verification(model, result)
        session.add(model)
        await session.commit()
        await session.refresh(model)
        return model.id
