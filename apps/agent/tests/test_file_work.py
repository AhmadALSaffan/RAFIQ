"""How a run works on files: editing part of a file, running code with Arabic in it, and
keeping a long run from re-sending every page it touched."""

import json
import sys
from pathlib import Path
from typing import Any

import pytest

from rafiq_agent.core.context import compact_steps, message_tokens
from rafiq_agent.tools.filesystem import FilesystemEditTool
from rafiq_agent.tools.shell import ShellRunTool

ARABIC_NAME = "بورتفوليو-أحمد-السفان.html"


async def test_an_edit_replaces_exactly_the_text_given(tmp_path: Path) -> None:
    (tmp_path / "a.html").write_text("<h1>مرحبا</h1>\n<p>قديم</p>\n", encoding="utf-8")
    tool = FilesystemEditTool(tmp_path)
    result = await tool.run({"path": "a.html", "old_text": "<p>قديم</p>", "new_text": "<p>جديد</p>"})
    assert result.ok, result.output
    assert (tmp_path / "a.html").read_text(encoding="utf-8") == "<h1>مرحبا</h1>\n<p>جديد</p>\n"
    preview = await tool.preview({"path": "a.html", "old_text": "جديد", "new_text": "أحدث"})
    assert preview and "-<p>جديد</p>" in preview and "+<p>أحدث</p>" in preview


async def test_an_edit_that_doesnt_match_says_how_to_fix_it(tmp_path: Path) -> None:
    (tmp_path / "a.txt").write_text("one\ntwo\ntwo\n", encoding="utf-8")
    tool = FilesystemEditTool(tmp_path)
    missing = await tool.run({"path": "a.txt", "old_text": "three", "new_text": "x"})
    assert not missing.ok and "filesystem_read" in missing.output
    twice = await tool.run({"path": "a.txt", "old_text": "two", "new_text": "x"})
    assert not twice.ok and "2 times" in twice.output
    every = await tool.run({"path": "a.txt", "old_text": "two", "new_text": "x", "replace_all": True})
    assert every.ok and (tmp_path / "a.txt").read_text(encoding="utf-8") == "one\nx\nx\n"
    gone = await tool.run({"path": "nope.txt", "old_text": "a", "new_text": "b"})
    assert not gone.ok and "filesystem_write" in gone.output
    escape = await tool.run({"path": "../outside.txt", "old_text": "a", "new_text": "b"})
    assert not escape.ok


async def test_an_edit_matches_a_file_with_windows_line_ends(tmp_path: Path) -> None:
    (tmp_path / "a.txt").write_bytes(b"first\r\nsecond\r\n")
    result = await FilesystemEditTool(tmp_path).run({"path": "a.txt", "old_text": "first\nsecond", "new_text": "1\n2"})
    assert result.ok, result.output
    assert (tmp_path / "a.txt").read_bytes() == b"1\r\n2\r\n"


async def test_a_script_prints_arabic_and_keeps_its_quotes(tmp_path: Path) -> None:
    (tmp_path / ARABIC_NAME).write_text("<html><body class='x'>أهلا</body></html>", encoding="utf-8")
    # The two failures from real runs: printing an Arabic name, and a regex with ^ and quotes.
    script = (
        "import pathlib, re\n"
        f"s = pathlib.Path('{ARABIC_NAME}').read_text(encoding='utf-8')\n"
        "print(s[s.index('<body'):])\n"
        "print(re.search(r'<body[^>]+>', s).group())\n"
    )
    result = await ShellRunTool(tmp_path).run({"script": script, "language": "python"})
    assert result.ok, result.output
    assert "أهلا" in result.output and "<body class='x'>" in result.output
    # nothing left behind in the user's folder
    assert sorted(p.name for p in tmp_path.iterdir()) == [ARABIC_NAME]


async def test_a_plain_command_prints_arabic_from_python(tmp_path: Path) -> None:
    result = await ShellRunTool(tmp_path).run({"command": f'"{sys.executable}" -c "print(chr(0x0623) + chr(0x062D))"'})
    assert result.ok, result.output
    assert "أح" in result.output


async def test_a_failed_one_liner_points_to_scripts(tmp_path: Path) -> None:
    result = await ShellRunTool(tmp_path).run({"command": f'"{sys.executable}" -c "import nothing_here_at_all"'})
    assert not result.ok
    assert "`script`" in result.output


async def test_a_run_needs_a_command_or_a_script(tmp_path: Path) -> None:
    assert not (await ShellRunTool(tmp_path).run({})).ok
    assert "language" in (await ShellRunTool(tmp_path).run({"script": "x", "language": "ruby"})).output


def _step(n: int, page: str) -> list[dict[str, Any]]:
    """One tool step of a run: write a whole page, then read it back."""
    return [
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [{"id": f"w{n}", "type": "function", "function": {"name": "filesystem_write", "arguments": json.dumps({"path": f"p{n}.html", "content": page})}}],
        },
        {"role": "tool", "tool_call_id": f"w{n}", "content": page},
    ]


def test_older_steps_shrink_and_the_newest_stay_whole() -> None:
    page = "<section>" + "x" * 20_000 + "</section>"
    messages: list[dict[str, Any]] = [{"role": "system", "content": "rafiq"}, {"role": "user", "content": "build it"}]
    for n in range(5):
        messages += _step(n, page)
    before = sum(message_tokens(m) for m in messages)
    compact_steps(messages, 1)
    after = sum(message_tokens(m) for m in messages)
    assert after < before / 2
    # The newest two steps are untouched; the older ones still say what was written, and stay valid JSON.
    assert messages[-1]["content"] == page and messages[-3]["content"] == page
    old_args = json.loads(messages[2]["tool_calls"][0]["function"]["arguments"])
    assert old_args["path"] == "p0.html" and "20019" in old_args["content"]
    assert len(messages[3]["content"]) < 2_000
    # Compacting again changes nothing, so the request's beginning stays the same.
    snapshot = json.dumps(messages, ensure_ascii=False)
    compact_steps(messages, 1)
    assert json.dumps(messages, ensure_ascii=False) == snapshot


@pytest.mark.parametrize("steps", [0, 2])
def test_a_short_run_is_left_alone(steps: int) -> None:
    messages: list[dict[str, Any]] = [{"role": "user", "content": "go"}]
    for n in range(steps):
        messages += _step(n, "y" * 5_000)
    snapshot = json.dumps(messages)
    compact_steps(messages, 0)
    assert json.dumps(messages) == snapshot
