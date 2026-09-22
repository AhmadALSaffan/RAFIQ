import asyncio
import contextlib
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from rafiq_agent.api.accounts import callback_router as accounts_callback_router
from rafiq_agent.api.accounts import router as accounts_router
from rafiq_agent.api.attachments import router as attachments_router
from rafiq_agent.api.automation import oauth_callback_router as mcp_oauth_callback_router
from rafiq_agent.api.automation import router as automation_router
from rafiq_agent.api.backup import router as backup_router
from rafiq_agent.api.chats import router as chats_router
from rafiq_agent.api.designs import router as designs_router
from rafiq_agent.api.files import router as files_router
from rafiq_agent.api.insights import router as insights_router
from rafiq_agent.api.integrations import router as integrations_router
from rafiq_agent.api.memory import router as memory_router
from rafiq_agent.api.models import router as models_router
from rafiq_agent.api.settings import router as settings_router
from rafiq_agent.api.tasks import router as tasks_router
from rafiq_agent.api.tasks import ws_router as tasks_ws_router
from rafiq_agent.api.voice import router as voice_router
from rafiq_agent.api.workspaces import router as workspaces_router
from rafiq_agent.config import AUTH_TOKEN, CORS_ORIGINS, DATA_DIR
from rafiq_agent.core.agent_runtime import load_settings, parallel_limit, run_task
from rafiq_agent.core.chat_service import stop_all_turns
from rafiq_agent.core.manager import manager
from rafiq_agent.core.schedules import run_forever as run_schedules
from rafiq_agent.i18n import reset_request_locale, set_request_locale
from rafiq_agent.llm import usage
from rafiq_agent.llm.resilience import set_concurrency
from rafiq_agent.mcp_bridge import MANAGER as MCP
from rafiq_agent.storage.db import init_db
from rafiq_agent.tools.browser import BROWSER

DISCOVERY_FILE = DATA_DIR / "agent.json"


def write_discovery() -> None:
    """Where the `rafiq` CLI finds the running agent: port and token, in the user's own
    data folder (readable only by them), removed on shutdown."""
    import json
    import os

    port = int(os.environ.get("RAFIQ_PORT", "8765"))
    with contextlib.suppress(OSError):
        DISCOVERY_FILE.write_text(
            json.dumps({"port": port, "token": AUTH_TOKEN, "pid": os.getpid()}), encoding="utf-8"
        )


def remove_discovery() -> None:
    with contextlib.suppress(OSError):
        DISCOVERY_FILE.unlink()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    settings = await load_settings()
    set_concurrency(settings.provider_concurrency)
    usage.set_budgets(settings.daily_budget_usd, settings.monthly_budget_usd)
    await usage.load_totals()  # today's and this month's spending survive a restart
    await manager.recover()
    manager.start(run_task, limit=parallel_limit)
    schedules = asyncio.create_task(run_schedules())
    MCP.warm()  # connect the MCP servers while the user is still opening a chat
    write_discovery()
    # Optional experimental adapter: load its saved config, or skip it silently.
    with contextlib.suppress(Exception):
        from rafiq_agent.auth.experimental.authai import load_config

        await load_config()
    yield
    remove_discovery()
    schedules.cancel()
    # Replies still being written are saved as far as they got.
    await stop_all_turns()
    await usage.drain()  # don't lose the last calls' cost
    await MCP.shutdown()
    BROWSER.stop()
    # Copilot runtimes are child processes — don't leave them behind.
    from rafiq_agent.llm import copilot

    await copilot.shutdown_all()


class LocaleMiddleware:
    """Makes the UI's language (Accept-Language) the language of every message in this request."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        header = next(
            (v.decode("latin-1") for k, v in scope.get("headers", []) if k == b"accept-language"), None
        )
        token = set_request_locale(header)
        try:
            await self.app(scope, receive, send)
        finally:
            reset_request_locale(token)


class NoStoreMiddleware:
    """Pure ASGI (not BaseHTTPMiddleware) so streamed chat replies aren't buffered."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_header(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() != b"cache-control"]
                headers.append((b"cache-control", b"no-store"))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_header)


app = FastAPI(title="Rafiq Agent", lifespan=lifespan)

app.add_middleware(NoStoreMiddleware)
app.add_middleware(LocaleMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(models_router)
app.include_router(accounts_router)
app.include_router(accounts_callback_router)
app.include_router(settings_router)
app.include_router(tasks_router)
app.include_router(tasks_ws_router)
app.include_router(chats_router)
app.include_router(attachments_router)
app.include_router(integrations_router)
app.include_router(files_router)
app.include_router(designs_router)
app.include_router(automation_router)
app.include_router(mcp_oauth_callback_router)
app.include_router(insights_router)
app.include_router(voice_router)
app.include_router(memory_router)
app.include_router(workspaces_router)
app.include_router(backup_router)


# AuthAI's own settings routes — mounted only if the experimental module loads.
with contextlib.suppress(Exception):
    from rafiq_agent.auth.experimental.authai import router as authai_router

    app.include_router(authai_router)


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}
