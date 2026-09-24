from collections.abc import AsyncIterator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession, async_sessionmaker, create_async_engine

from rafiq_agent.config import DATABASE_URL
from rafiq_agent.storage.models import Base

engine = create_async_engine(DATABASE_URL)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

# Columns added after the first release. create_all() never alters existing tables,
# so an existing user DB needs these added in place (all nullable → safe, additive).
_ADDED_COLUMNS: dict[str, dict[str, str]] = {
    "llm_models": {
        "verify_ok": "BOOLEAN",
        "verify_error": "TEXT",
        "verify_latency_ms": "INTEGER",
        "verified_at": "DATETIME",
        "supports_tools": "BOOLEAN",
        "auth_method": "VARCHAR DEFAULT 'api_key'",
        "account_id": "VARCHAR",
        "fallback_model_id": "VARCHAR",
        "options": "JSON",
    },
    "tasks": {
        "working_dir": "VARCHAR",
        "attachments": "JSON",
        "origin": "JSON",
        "paths": "JSON",
        "depends_on": "JSON",
        "git": "JSON",
        "mode": "VARCHAR DEFAULT 'auto'",
        "plan": "TEXT",
        "workspace_id": "VARCHAR",
    },
    "chats": {
        "working_dir": "VARCHAR",
        "settings": "JSON",
        "summary": "TEXT",
        "summary_until": "VARCHAR",
        "pinned": "BOOLEAN DEFAULT 0",
        "mode": "VARCHAR DEFAULT 'chat'",
        "workspace_id": "VARCHAR",
        "archived_at": "DATETIME",
    },
    "chat_messages": {"parts": "JSON", "attachments": "JSON"},
    "designs": {"working_dir": "VARCHAR", "saved_path": "VARCHAR", "workspace_id": "VARCHAR", "files": "JSON"},
    "mcp_servers": {"auth": "VARCHAR DEFAULT 'none'", "preset": "VARCHAR"},
}


async def _add_missing_columns(conn: AsyncConnection) -> None:
    for table, columns in _ADDED_COLUMNS.items():
        rows = await conn.execute(text(f"PRAGMA table_info({table})"))
        existing = {row[1] for row in rows}
        for name, ddl in columns.items():
            if name not in existing:
                await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


async def init_db() -> None:
    from rafiq_agent.core.search import create_index

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _add_missing_columns(conn)
        # The full-text index for chat search (core/search.py). It fills itself in on the
        # first search, so a database from before it existed needs nothing more.
        await create_index(conn)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
