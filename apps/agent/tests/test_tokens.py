"""What Rafiq sends before the user has said anything, and the switches that shrink it."""

import httpx
import pytest
from httpx import ASGITransport

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.core.agent_runtime import ALL_GROUPS, build_registry
from rafiq_agent.core.designs import skills_note
from rafiq_agent.core.prompts import ECONOMY_MAX_TOKENS, LENGTH_MAX_TOKENS
from rafiq_agent.llm import usage
from rafiq_agent.main import app
from rafiq_agent.schemas.chats import AUTO_SUMMARIZE_TOKENS, ReplySettings
from rafiq_agent.schemas.settings import AppSettings
from rafiq_agent.storage.db import init_db
from rafiq_agent.tools.filesystem import READ_CHARS, FilesystemReadTool

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}


@pytest.fixture()
async def client():
    await init_db()
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def schema_chars(registry) -> int:
    import json

    return sum(len(json.dumps(s, ensure_ascii=False)) for s in registry.schemas())


# ── The fixed prompt ──────────────────────────────────────────────────────────────────


def test_the_skills_note_lists_names_not_the_whole_catalogue():
    note = skills_note()
    assert "impeccable" in note and "design-taste" in note
    assert "skill_read" in note and "skill_list" in note
    # The descriptions are what made this 5.8k characters; they live behind skill_list now.
    assert len(note) < 700


def test_the_saver_can_be_turned_off_and_the_skills_come_back_in_full():
    full = skills_note(full=True)
    assert len(full) > len(skills_note()) * 5
    # Every skill with its own description, as it was before the saving.
    assert full.count("—") >= 10 or full.count(":") >= 10


def test_a_design_session_and_a_saver_off_chat_both_get_the_full_catalogue():
    from rafiq_agent.core.chat_service import ChatTurn

    turn = ChatTurn.__new__(ChatTurn)
    for design_mode, saver, expected_full in ((True, True, True), (False, False, True), (False, True, False)):
        turn.design_mode = design_mode
        turn.reply = ReplySettings(saver=saver)
        assert (turn.design_mode or not turn.reply.saver) is expected_full


async def test_tool_groups_decide_what_is_described_to_the_model(client, tmp_path):
    everything = await build_registry(tmp_path, AppSettings(), frozenset(), ALL_GROUPS)
    lean = await build_registry(tmp_path, AppSettings(), frozenset(), frozenset({"files"}))
    none = await build_registry(tmp_path, AppSettings(), frozenset(), frozenset())
    try:
        assert {"filesystem_read", "shell_run"} <= everything.names()
        assert any(n.startswith("browser_") for n in everything.names())
        assert lean.names() >= {"filesystem_read", "shell_run"}
        assert not any(n.startswith("browser_") for n in lean.names())
        assert "web_fetch" not in lean.names() and "skill_read" not in lean.names()
        assert schema_chars(lean) < schema_chars(everything)
        assert none.names() == set()
    finally:
        for registry in (everything, lean, none):
            await registry.aclose()


async def test_issue_tools_need_a_connected_tracker(client, tmp_path, monkeypatch):
    from rafiq_agent.core import agent_runtime

    async def none() -> bool:
        return False

    monkeypatch.setattr(agent_runtime, "_has_integrations", none)
    registry = await build_registry(tmp_path, AppSettings(), frozenset(), ALL_GROUPS)
    try:
        assert not any(n.startswith("issue_") for n in registry.names())
    finally:
        await registry.aclose()


# ── The switches ──────────────────────────────────────────────────────────────────────


def test_reply_settings_carry_the_new_switches():
    settings = ReplySettings()
    assert settings.mcp is True and settings.browser is True and settings.economy is False
    # Saving starts off: the skills are worth their tokens until the user says otherwise.
    assert settings.saver is False
    # Old saved settings still load — the fields have defaults.
    assert ReplySettings.model_validate({"length": "short"}).economy is False


def test_every_reply_length_has_a_ceiling():
    assert all(LENGTH_MAX_TOKENS[k] for k in ("short", "balanced", "detailed"))
    assert LENGTH_MAX_TOKENS["short"] < LENGTH_MAX_TOKENS["balanced"] < LENGTH_MAX_TOKENS["detailed"]
    assert LENGTH_MAX_TOKENS["short"] * 2 >= ECONOMY_MAX_TOKENS


async def test_economy_mode_sends_no_tools_and_says_why(client):
    from rafiq_agent.core.chat_service import ChatTurn

    turn = ChatTurn.__new__(ChatTurn)
    turn.reply = ReplySettings(economy=True)
    turn.working_dir = None
    turn.supports_tools = True
    registry, system = await turn._tools("SYSTEM")
    assert registry.names() == set()
    assert "اقتصادي" in system


def test_groups_follow_the_chats_switches():
    from rafiq_agent.core.chat_service import ChatTurn

    turn = ChatTurn.__new__(ChatTurn)
    turn.reply = ReplySettings()
    assert {"mcp", "browser", "files"} <= turn._groups()

    turn.reply = ReplySettings(mcp=False, browser=False)
    groups = turn._groups()
    assert "mcp" not in groups and "browser" not in groups and "files" in groups

    turn.reply = ReplySettings(tools=False)
    assert turn._groups() == frozenset()
    turn.reply = ReplySettings(economy=True)
    assert turn._groups() == frozenset()


# ── Reading a file comes in pages ─────────────────────────────────────────────────────


async def test_a_long_file_is_read_in_pages(tmp_path):
    (tmp_path / "big.txt").write_text("x" * (READ_CHARS * 2), encoding="utf-8")
    tool = FilesystemReadTool(tmp_path)

    first = await tool.run({"path": "big.txt"})
    assert first.ok and len(first.output) < READ_CHARS + 200
    assert f"offset={READ_CHARS}" in first.output

    second = await tool.run({"path": "big.txt", "offset": READ_CHARS})
    assert second.ok and "offset=" not in second.output  # the tail fits, so nothing is left
    assert await tool.run({"path": "big.txt", "offset": "nonsense"})


# ── What a turn cost ──────────────────────────────────────────────────────────────────


def test_usage_collect_adds_up_the_calls_inside_it():
    before = usage.collect()
    with before as turn:
        usage.record("gpt-4o-mini", {"prompt_tokens": 100, "completion_tokens": 20})
        usage.record("gpt-4o-mini", {"prompt_tokens": 40, "completion_tokens": 5})
    total = turn.total()
    assert total.prompt_tokens == 140 and total.completion_tokens == 25

    # Outside the block nothing is collected, and a second turn starts from zero.
    usage.record("gpt-4o-mini", {"prompt_tokens": 999, "completion_tokens": 999})
    assert turn.total().prompt_tokens == 140


def test_summarising_is_triggered_by_weight_not_only_by_count():
    assert AUTO_SUMMARIZE_TOKENS > 0


async def test_settings_take_a_helper_model(client):
    current = (await client.get("/settings", headers=AUTH)).json()
    assert current["helper_model_id"] is None
    saved = (await client.put("/settings", json={**current, "helper_model_id": None}, headers=AUTH)).json()
    assert "helper_model_id" in saved


def test_a_new_chat_starts_at_the_setting_the_user_chose():
    from rafiq_agent.schemas.settings import AppSettings

    assert AppSettings().token_saver is False  # off out of the box
    # What the chat row stores is the one field; everything else keeps following its default.
    assert ReplySettings.model_validate({"saver": True}).saver is True
    assert ReplySettings.model_validate({"saver": True}).length == "balanced"


def test_a_registration_that_comes_back_with_a_secret_is_told_to_use_it():
    from mcp.shared.auth import OAuthClientInformationFull

    from rafiq_agent import mcp_oauth

    # Figma: we ask for "none", it mints a secret and echoes "none" back anyway.
    figma = OAuthClientInformationFull(
        client_id="abc",
        client_secret="s3cret",
        redirect_uris=["http://127.0.0.1:8765/callback"],
        token_endpoint_auth_method="none",
    )
    assert mcp_oauth.usable_client(figma).token_endpoint_auth_method == "client_secret_post"

    # A real public client is left alone.
    public = OAuthClientInformationFull(
        client_id="abc",
        redirect_uris=["http://127.0.0.1:8765/mcp/oauth/callback"],
        token_endpoint_auth_method="none",
    )
    assert mcp_oauth.usable_client(public).token_endpoint_auth_method == "none"

    # And a server that already said how to authenticate keeps its answer.
    basic = OAuthClientInformationFull(
        client_id="abc",
        client_secret="s3cret",
        redirect_uris=["http://127.0.0.1:8765/mcp/oauth/callback"],
        token_endpoint_auth_method="client_secret_basic",
    )
    assert mcp_oauth.usable_client(basic).token_endpoint_auth_method == "client_secret_basic"
