"""Rafiq in the terminal (repl.py): the chat loop, tool lines, permissions and commands."""

import io

from rafiq_agent import cli, repl

MODELS = [
    {"id": "m1", "name": "Claude Sonnet", "model_id": "claude-sonnet"},
    {"id": "m2", "name": "Qwen 3 · 8B · Ollama", "model_id": "qwen3:8b"},
]


class FakeApi:
    def __init__(self, replies):
        self.replies = list(replies)
        self.chats: list[tuple[str, str]] = []
        self.sent: list[tuple[str, str, str]] = []
        self.resolved: list[tuple[str, str]] = []
        self.stopped: list[str] = []

    def models(self):
        return MODELS

    def create_chat(self, folder, model_id):
        self.chats.append((folder, model_id))
        return f"chat-{len(self.chats)}"

    def send(self, chat_id, text, model_id):
        self.sent.append((chat_id, text, model_id))
        yield from self.replies.pop(0)

    def resolve(self, chat_id, request_id, resolution):
        self.resolved.append((request_id, resolution))

    def stop(self, chat_id):
        self.stopped.append(chat_id)


def run(api, lines, lang="en", model=None):
    keys = iter(lines)
    out = io.StringIO()

    def read(_prompt):
        try:
            return next(keys)
        except StopIteration:
            raise EOFError from None

    repl.Repl(api, "C:/code/app", out, read, lang, model).run()
    return out.getvalue()


def test_a_reply_streams_with_its_tool_lines():
    api = FakeApi([[
        {"type": "delta", "text": "Running "},
        {"type": "delta", "text": "the tests."},
        {"type": "tool_call", "id": "t1", "tool": "shell_run", "args": {"command": "pnpm test"}},
        {"type": "tool_result", "id": "t1", "ok": True, "output": "1\n2\n3\n4\n5\n6"},
        {"type": "delta", "text": "All green."},
        {"type": "done"},
    ]])
    shown = run(api, ["run the tests"])
    assert api.chats == [("C:/code/app", "m1")]
    assert "Running the tests.\n● shell_run: pnpm test" in shown
    assert "… +2" in shown and "All green." in shown


def test_permission_is_asked_in_the_terminal():
    api = FakeApi([[
        {"type": "permission", "id": "r1", "call": {"tool": "filesystem_write", "args": {"path": "a.txt"}, "preview": "+hello", "review": "writes the file you named"}},
        {"type": "done"},
    ]])
    shown = run(api, ["write a.txt", "maybe", "a"])
    assert api.resolved == [("r1", "always")]
    assert "Needs permission: filesystem_write: a.txt" in shown
    assert "Reviewer: writes the file you named" in shown and "+hello" in shown


def test_permission_with_no_answer_is_a_deny():
    api = FakeApi([[{"type": "permission", "id": "r1", "call": {"tool": "shell_run", "args": {"command": "ls"}}}, {"type": "done"}]])
    run(api, ["list"])  # input runs out: EOF at the question
    assert api.resolved == [("r1", "denied")]


def test_commands_switch_model_and_start_over():
    api = FakeApi([[{"type": "done"}], [{"type": "done"}]])
    shown = run(api, ["/model", "/model qwen", "first", "/new", "second", "/nope", "/exit"])
    assert "● Claude Sonnet" in shown and "Model: Qwen 3 · 8B · Ollama" in shown
    assert [s[2] for s in api.sent] == ["m2", "m2"]
    assert [s[0] for s in api.sent] == ["chat-1", "chat-2"]
    assert "Unknown command" in shown


def test_continued_lines_and_arabic():
    api = FakeApi([[{"type": "delta", "text": "تمام"}, {"type": "done"}]])
    shown = run(api, ["رتّب \\", "ملفاتي"], lang="ar", model="qwen3:8b")
    assert api.sent[0][1] == "رتّب \nملفاتي" and api.sent[0][2] == "m2"
    assert "رفيق · Qwen 3 · 8B · Ollama" in shown and "تمام" in shown


def test_ctrl_c_stops_the_reply():
    def reply():
        yield {"type": "delta", "text": "working"}
        raise KeyboardInterrupt

    api = FakeApi([reply()])
    shown = run(api, ["go"])
    assert api.stopped == ["chat-1"] and "Stopped the reply." in shown


def test_plain_rafiq_opens_the_terminal_chat(monkeypatch):
    seen = []
    monkeypatch.setattr(repl, "main", lambda argv: seen.append(argv))
    cli.main([])
    cli.main(["--model", "qwen"])
    assert seen == [[], ["--model", "qwen"]]


def test_an_error_from_the_app_is_shown_not_raised():
    class Closed(FakeApi):
        def send(self, chat_id, text, model_id):
            raise RuntimeError("Rafiq isn't reachable: connection refused")
            yield  # pragma: no cover

    shown = run(Closed([]), ["hi", "/exit"])
    assert "isn't reachable" in shown and "Bye." in shown


class ApiWithRoutes(FakeApi):
    """FakeApi plus the app's other routes the commands read."""

    def __init__(self, replies, routes=None):
        super().__init__(replies)
        self.routes = routes or {}
        self.posted: list[tuple[str, object]] = []

    def _request(self, method, path, body=None, stream=False):
        if method == "POST":
            self.posted.append((path, body))
            return self.routes.get(("POST", path), {})
        return self.routes[path]


def test_modes_answer_permissions_themselves():
    write = {"type": "permission", "id": "w", "call": {"tool": "filesystem_write", "args": {"path": "a"}}}
    shell = {"type": "permission", "id": "s", "call": {"tool": "shell_run", "args": {"command": "ls"}}}
    api = FakeApi([[write, shell, {"type": "done"}], [write, {"type": "done"}], [shell, {"type": "done"}]])
    shown = run(api, ["/mode edits", "one", "n", "/mode plan", "two", "/mode auto", "three"])
    # accept edits: the write passes, the command still asks (answered n); plan: denied;
    # don't ask: allowed.
    assert api.resolved == [("w", "approved"), ("s", "denied"), ("w", "denied"), ("s", "approved")]
    assert api.sent[1][1].startswith("Plan mode:")
    assert "Mode: plan only, changes nothing" in shown


def test_bang_runs_here_and_goes_with_the_next_message(tmp_path):
    api = FakeApi([[{"type": "done"}]])
    keys = iter(["!echo hello-from-shell", "what did it print?"])
    out = io.StringIO()

    def read(_p):
        try:
            return next(keys)
        except StopIteration:
            raise EOFError from None

    repl.Repl(api, str(tmp_path), out, read, "en").run()
    assert "hello-from-shell" in out.getvalue()
    sent = api.sent[0][1]
    assert "hello-from-shell" in sent and sent.endswith("what did it print?")


def test_hash_remembers_and_cost_reads_usage():
    api = ApiWithRoutes([], {"/usage?days=30": {"today_usd": 0.5, "month_usd": 3.25, "daily_budget_usd": 0, "monthly_budget_usd": 10}})
    shown = run(api, ["# answer in English with code", "/cost"])
    assert api.posted == [("/memories", {"text": "answer in English with code"})]
    assert "Today: $0.50 · This month: $3.25" in shown and "Monthly: $10.00" in shown


def test_resume_picks_a_chat_of_this_folder():
    routes = {
        "/chats": [
            {"id": "c1", "title": "old", "working_dir": "C:/code/app", "message_count": 2, "updated_at": "2026-11-01T10:00"},
            {"id": "c2", "title": "elsewhere", "working_dir": "D:/other", "message_count": 2, "updated_at": "2026-11-02T10:00"},
        ],
        "/chats/c1": {"title": "old", "messages": [{"role": "user", "content": "fix the bug"}, {"role": "assistant", "content": "fixed"}]},
    }
    api = ApiWithRoutes([[{"type": "done"}]], routes)
    out = io.StringIO()
    keys = iter(["/resume", "go on"])

    class Picking(repl.Repl):
        def pick(self, title, options, default=None):
            assert [v for v, _ in options] == ["c1"]
            return "c1"

    def read(_p):
        try:
            return next(keys)
        except StopIteration:
            raise EOFError from None

    Picking(api, "C:/code/app", out, read, "en").run()
    assert "Back in: old" in out.getvalue() and "fix the bug" in out.getvalue()
    assert api.sent[0][0] == "c1"  # carries on in the same chat


def test_lang_switches_every_text_and_is_kept(tmp_path, monkeypatch):
    monkeypatch.setenv("RAFIQ_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("RAFIQ_LANG", raising=False)
    api = FakeApi([])
    api.lang = "ar"
    shown = run(api, ["/lang ru", "/help", "/lang fr", "/lang en", "/lang ru"], lang="ar")
    assert "Язык: Русский" in shown and "Команды" in shown and "выбрать модель" in shown
    assert "Языки: ar · en · ru" in shown and "Language: English" in shown
    assert shown.rstrip().endswith("До встречи.")
    assert api.lang == "ru"  # the agent's own messages follow too
    assert repl.saved_lang() == "ru" and repl.pick_lang(None) == "ru"
    assert repl.pick_lang("en") == "en"
    monkeypatch.setenv("RAFIQ_LANG", "en-US")
    assert repl.pick_lang(None) == "en"


def test_every_language_has_every_text():
    keys = set(repl.TEXTS["en"])
    for lang in repl.LANGS:
        assert set(repl.TEXTS[lang]) == keys, lang
    for command, about in repl.COMMAND_HELP:
        assert set(about) == set(repl.LANGS), command
    assert "/lang" in repl.COMMANDS


def test_the_cli_opens_the_terminal_chat_with_lang(monkeypatch):
    seen = []
    monkeypatch.setattr(repl, "main", lambda args: seen.append(args))
    cli.main(["--lang", "ru"])
    cli.main(["--lang=en"])
    assert seen == [["--lang", "ru"], ["--lang=en"]]
    assert repl._option(["--model", "x", "--lang", "ru"], "--lang", "-l") == "ru"
    assert repl._option(["--lang=en"], "--lang", "-l") == "en"
