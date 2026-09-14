from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from rafiq_agent.api.attachments import router as attachments_router
from rafiq_agent.api.chats import router as chats_router
from rafiq_agent.api.designs import router as designs_router
from rafiq_agent.api.files import router as files_router
from rafiq_agent.api.integrations import router as integrations_router
from rafiq_agent.api.models import router as models_router
from rafiq_agent.api.settings import router as settings_router
from rafiq_agent.api.tasks import router as tasks_router
from rafiq_agent.api.tasks import ws_router as tasks_ws_router
from rafiq_agent.config import CORS_ORIGINS
from rafiq_agent.core.agent_runtime import run_task
from rafiq_agent.core.manager import manager
from rafiq_agent.storage.db import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await manager.recover()
    manager.start(run_task)
    yield


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
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(models_router)
app.include_router(settings_router)
app.include_router(tasks_router)
app.include_router(tasks_ws_router)
app.include_router(chats_router)
app.include_router(attachments_router)
app.include_router(integrations_router)
app.include_router(files_router)
app.include_router(designs_router)


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}
