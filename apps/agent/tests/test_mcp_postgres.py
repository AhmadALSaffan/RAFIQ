"""The Postgres MCP preset: the password lives in the keychain, never in a saved URL, and
servers saved by earlier versions are moved over on startup."""

from sqlalchemy import delete

from rafiq_agent.mcp_bridge import (
    OLD_POSTGRES,
    POSTGRES_ARGS,
    load_secrets,
    save_secrets,
    secure_args,
    split_password,
    upgrade_saved_servers,
)
from rafiq_agent.storage.db import SessionLocal, init_db
from rafiq_agent.storage.models import McpServer


def test_the_password_comes_out_of_the_url():
    assert split_password("postgresql://ana:s3cr%40t@db.local:5432/shop") == ("postgresql://ana@db.local:5432/shop", "s3cr@t")
    assert split_password("postgresql://ana@db.local/shop") == ("postgresql://ana@db.local/shop", "")
    assert split_password("postgresql://db.local/shop") == ("postgresql://db.local/shop", "")
    assert split_password("not a url") == ("not a url", "")


def test_only_database_urls_lose_their_password_and_a_typed_one_wins():
    args, env = secure_args(["--x", "postgres://u:pw@h/db", "https://u:p@example.com"], {})
    assert args == ["--x", "postgres://u@h/db", "https://u:p@example.com"]
    assert env == {"PGPASSWORD": "pw"}
    _, env = secure_args(["postgresql://u:old@h/db"], {"PGPASSWORD": "typed"})
    assert env == {"PGPASSWORD": "typed"}


async def test_a_server_saved_the_old_way_is_upgraded_once():
    await init_db()
    async with SessionLocal() as session:
        old = McpServer(
            name="PostgreSQL", transport="stdio", command="npx", preset="postgres",
            args=["-y", OLD_POSTGRES, "postgresql://ana:hunter2@localhost:5432/shop"],
        )
        session.add(old)
        await session.commit()
        server_id = old.id
    try:
        await upgrade_saved_servers()
        async with SessionLocal() as session:
            row = await session.get(McpServer, server_id)
            assert row.command == "uvx"
            assert row.args == [*POSTGRES_ARGS, "postgresql://ana@localhost:5432/shop"]
            assert "hunter2" not in str(row.args) and row.secret_keys == ["PGPASSWORD"]
        assert load_secrets(server_id)["env"] == {"PGPASSWORD": "hunter2"}

        await upgrade_saved_servers()  # nothing left to do
        async with SessionLocal() as session:
            assert (await session.get(McpServer, server_id)).args == [*POSTGRES_ARGS, "postgresql://ana@localhost:5432/shop"]
    finally:
        save_secrets(server_id, {}, {})
        async with SessionLocal() as session:
            await session.execute(delete(McpServer).where(McpServer.id == server_id))
            await session.commit()
