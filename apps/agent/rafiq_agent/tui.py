"""Rafiq in a real terminal, drawn like a coding agent: rich for the output, prompt_toolkit for
the input line (repl.py is the engine and the plain view).

- A welcome box with the character and the white mark (terminal_logo.py).
- The input sits between two lines, with the mode, model and folder under it. The / menu
  lists the commands with what each does, @ completes file names, the arrows walk history.
- Arrow-key lists for /model (and adding one), /mode, /lang, /resume and the permission
  question; /status, /cost, /help and the other lists open a screen of their own (Esc leaves).
- Replies start with ●, each tool step with an orange ● and its result, dim, under ⎿.
- Arabic: most terminals don't do right-to-left, so every line with Arabic is put in display
  order (rtl.py) — the replies, the lists, and the line being typed, which also sits to the
  right while it's Arabic. A terminal that does right-to-left itself (JetBrains IDEs) is left
  to it; RAFIQ_BIDI=0 / 1 decides for any other.
- /lang switches all of it between Arabic, English and Russian (repl.py keeps the choice).
"""

from __future__ import annotations

import contextlib
import sys
import threading
import time
from pathlib import Path
from typing import Any

from rafiq_agent.acp import tool_title
from rafiq_agent.repl import COMMAND_HELP, ORANGE, Repl, custom_commands

RESULT_LINES = 3


def _short_path(path: str, limit: int = 56) -> str:
    """A long folder path, cut in the middle so both ends stay readable."""
    if len(path) <= limit:
        return path
    keep = (limit - 1) // 2
    return path[:keep] + "…" + path[-keep:]


def _columns() -> int:
    """The terminal's width while prompt_toolkit is drawing (one less: the last column wraps)."""
    from prompt_toolkit.application import get_app

    try:
        return max(20, get_app().output.get_size().columns - 1)
    except Exception:  # noqa: BLE001 - outside an app
        import shutil

        return max(20, shutil.get_terminal_size().columns - 1)


def _input_processor():
    """Shows the line being typed in display order, to the right while it's right-to-left,
    with the cursor following the text (rtl.visual_map)."""
    from prompt_toolkit.layout.processors import Processor, Transformation

    from rafiq_agent import rtl

    class BidiInput(Processor):
        def apply_transformation(self, ti):  # noqa: ANN001, ANN201
            line = ti.document.lines[ti.lineno] if ti.lineno < len(ti.document.lines) else ""
            if not rtl.has_arabic(line):
                return Transformation(ti.fragments)
            shown, at = rtl.visual_map(line)
            # Right-to-left: right aligned, with one free column on the left for the cursor.
            # (The width counts the prompt "› " too, and the last column would wrap.)
            pad = max(1, ti.width - len(shown) - 4) if rtl.is_rtl(line) else (1 if min(at) < 0 else 0)
            style = ti.fragments[0][0] if ti.fragments else ""
            fragments = [(style, " " * pad + shown)]
            source_to_display = [pad + col for col in at]
            back: dict[int, int] = {}
            for src, col in enumerate(source_to_display):
                back.setdefault(col, src)

            def to_display(i: int) -> int:
                return source_to_display[min(max(i, 0), len(source_to_display) - 1)]

            def to_source(col: int) -> int:
                return back.get(col, len(line))

            return Transformation(fragments, source_to_display=to_display, display_to_source=to_source)

    return BidiInput()


def _session_class():
    """PromptSession, with the input only as tall as what's typed (plus room for the menu
    while it's open). Otherwise prompt_toolkit stretches it over every row below the cursor
    and the line under it lands at the bottom of the window: a big empty box."""
    from prompt_toolkit import PromptSession
    from prompt_toolkit.layout.dimension import Dimension

    class Session(PromptSession):
        def _get_default_buffer_control_height(self) -> Dimension:
            menu = super()._get_default_buffer_control_height().min or 0
            width = max(10, _columns() - 2)
            lines = sum(max(1, -(-len(line) // width)) for line in self.default_buffer.document.lines)
            return Dimension(min=lines + menu, max=lines + menu, preferred=lines + menu)

    return Session


class RichRepl(Repl):
    def __init__(self, *args: Any, version: str = "", **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        from prompt_toolkit.completion import Completer, Completion, PathCompleter
        from prompt_toolkit.document import Document
        from prompt_toolkit.filters import Condition
        from prompt_toolkit.formatted_text import FormattedText
        from prompt_toolkit.history import FileHistory
        from prompt_toolkit.key_binding import KeyBindings
        from prompt_toolkit.styles import Style as PStyle
        from rich.console import Console

        from rafiq_agent import rtl
        from rafiq_agent.cli import data_dir

        self.console = Console(highlight=False, soft_wrap=False)
        self.bidi = rtl.enabled()
        self.version = version
        self._live = None
        self._status = None
        self._buffer = ""
        self._last_interrupt = 0.0
        self._last = ""  # what was printed last: "tool", "text", or ""
        # Keys typed while a reply was coming: they wait in the next prompt.
        self._typeahead = ""
        # While a list or a question reads the keyboard, the Esc watcher keeps its hands off.
        self._keys_busy = threading.Event()
        repl = self
        paths = PathCompleter(expanduser=True, get_paths=lambda: [repl.folder])

        class Commands(Completer):
            """/ opens the command menu, one row per command with what it does; @ completes
            file names."""

            def get_completions(self, document, complete_event):  # noqa: ANN001, ANN201
                text = document.text_before_cursor
                if text.startswith("/") and " " not in text:
                    rows = [(name, repl.describe(about)) for name, about in COMMAND_HELP]
                    rows += [(f"/{name}", about or repl.text["custom_cmd"].format(file=f"{name}.md")) for name, (about, _) in custom_commands(repl.folder).items()]
                    width = max(len(name) for name, _ in rows) + 1
                    for name, about in rows:
                        if name.startswith(text):
                            display = FormattedText([("class:cmd", f" {name:<{width}}"), ("class:about", f" {repl.v(about)} ")])
                            yield Completion(name, start_position=-len(text), display=display)
                    return
                word = text.split(" ")[-1]
                if word.startswith("@"):
                    sub = Document(word[1:], len(word) - 1)
                    yield from paths.get_completions(sub, complete_event)

        def completing() -> bool:
            # The menu (and the room it needs) only while a command or a file is being typed:
            # otherwise the input stays two lines tall.
            from prompt_toolkit.application import get_app

            text = get_app().current_buffer.document.text_before_cursor
            return (text.startswith("/") and " " not in text) or text.split(" ")[-1].startswith("@")

        keys = KeyBindings()

        @keys.add("escape", "enter")
        @keys.add("c-j")
        def _newline(event):  # noqa: ANN001
            event.current_buffer.insert_text("\n")

        @keys.add("s-tab")
        def _mode(event):  # noqa: ANN001
            repl.cycle_mode()
            event.app.invalidate()

        history = data_dir() / "terminal_history"
        with contextlib.suppress(OSError):
            history.parent.mkdir(parents=True, exist_ok=True)
        self.session = _session_class()(
            history=FileHistory(str(history)),
            completer=Commands(),
            complete_while_typing=Condition(completing),
            reserve_space_for_menu=10,
            key_bindings=keys,
            bottom_toolbar=self._toolbar,
            input_processors=[_input_processor()] if self.bidi else None,
            # What was typed is printed again by Rafiq, in display order and in place.
            erase_when_done=True,
            style=PStyle.from_dict({
                "rule": "#4a4a46",
                "prompt": f"{ORANGE} bold",
                "bottom-toolbar": "noreverse bg:default #8a8a8a",
                "bottom-toolbar.text": "noreverse",
                "toolbar.mode": f"{ORANGE}",
                "toolbar.dim": "#6b6b6b",
                "placeholder": "#6b6b6b",
                # The / menu as a plain list under the line, no box: the choice in orange.
                "completion-menu": "bg:default noreverse",
                "completion-menu.completion": "bg:default #d6d6d6",
                "completion-menu.completion.current": f"bg:#2a2a27 {ORANGE} bold noreverse",
                "completion-menu.completion cmd": "#d6d6d6",
                "completion-menu.completion.current cmd": f"{ORANGE} bold",
                "about": "#7a7a7a",
                "completion-menu.completion.current about": "#bdbdb6 nobold",
                "completion-menu.meta.completion": "bg:default #7a7a7a",
                "completion-menu.meta.completion.current": f"bg:default {ORANGE} noreverse",
                "scrollbar.background": "bg:default",
                "scrollbar.button": "bg:#3a3a37",
                "scrollbar.arrow": "bg:default #4a4a4a",
            }),
        )

    def v(self, text: str, rtl_base: bool | None = None) -> str:
        """A line as the terminal should get it (rtl_base=False: a path, a command or tool
        output, which reads left to right even with Arabic in it)."""
        if not self.bidi:
            return text
        from rafiq_agent import rtl

        return "\n".join(rtl.visual(line, rtl_base) for line in text.split("\n"))

    # The input: a line above, the prompt, a line below and the status under it ------------

    def _message(self):
        from prompt_toolkit.formatted_text import FormattedText

        return FormattedText([("class:rule", "─" * _columns() + "\n"), ("class:prompt", "› ")])

    def _toolbar(self):
        from prompt_toolkit.formatted_text import FormattedText

        agent = self.text["mode_own"] if self.owned() else self.text["mode_app"]
        name = Path(self.folder).name or self.folder
        return FormattedText([
            ("class:rule", "─" * _columns() + "\n"),
            ("class:toolbar.mode", f"  ⏵⏵ {self.v(self.mode_label())}"),
            ("class:toolbar.dim", f"  ({self.text['mode_hint']})"),
            ("class:toolbar.dim", "  ·  "),
            ("bold", self.model["name"]),
            ("class:toolbar.dim", f"  ·  {self.v(name, False)}  ·  {self.v(agent)}"),
        ])

    # View --------------------------------------------------------------------------------

    def _print_text(self, text: str, style: str = "") -> None:
        if self.bidi:
            from rafiq_agent import rtl

            if rtl.has_arabic(text):
                self.console.print(rtl.Paragraphs(text, style))
                return
        self.console.print(text, style=style, markup=False)

    def say(self, line: str = "", end: str = "\n") -> None:
        if end == "\n":
            self._print_text(line)
        else:
            self.console.print(self.v(line), end=end, markup=False)

    def show_banner(self) -> None:
        from rich.console import Group
        from rich.panel import Panel
        from rich.table import Table
        from rich.text import Text

        from rafiq_agent.terminal_logo import MARK, PEEP, half_blocks

        agent = self.text["mode_own"] if self.owned() else self.text["mode_app"]
        name = Text()
        name.append(self.v(self.text["name"]), style="bold #f4f2ea")
        if self.version:
            name.append(f"  {self.version}", style="dim")
        model = Text()
        model.append(self.model["name"], style=f"bold {ORANGE}")
        model.append("  ·  " + self.v(agent), style="dim")
        info = Group(
            half_blocks(MARK),
            Text(""),
            name,
            Text(""),
            model,
            Text(self.v(_short_path(self.folder), False), style="dim"),
            Text(""),
            Text(self.v(self.text["tips"]), style="dim"),
        )
        grid = Table.grid(padding=(0, 4))
        grid.add_column()
        grid.add_column(vertical="middle")
        grid.add_row(half_blocks(PEEP), info)
        panel = Panel(grid, border_style=ORANGE, padding=(1, 3), expand=False)
        self._last = ""
        if self.bidi:
            self.console.print(panel)
            return
        # A terminal that lays out right-to-left itself (IntelliJ) would flip a whole banner
        # line that has Arabic in it, drawing and all: each line starts with a left-to-right mark.
        from rafiq_agent.rtl import LRM

        with self.console.capture() as captured:
            self.console.print(panel)
        self.console.file.write("".join(LRM + line for line in captured.get().splitlines(keepends=True)))
        self.console.file.flush()

    def info(self, text: str) -> None:
        self._print_text(text, "dim")

    def error(self, text: str) -> None:
        self._print_text(text, "red")

    def heading(self, text: str) -> None:
        self._print_text(text, f"bold {ORANGE}")

    def rows(self, rows: list[tuple[str, str]]) -> None:
        from rich.table import Table

        table = Table.grid(padding=(0, 3))
        table.add_column(style="bold", no_wrap=True)
        table.add_column(style="dim")
        for name, note in rows:
            table.add_row(self.v(name), self.v(note))
        self.console.print(table)

    def clear(self) -> None:
        self.console.clear()

    def mode_changed(self) -> None:
        self.info(self.text["mode_now"].format(mode=self.mode_label()))

    def lang_changed(self) -> None:
        # The welcome box again, in the new language.
        self.show_banner()

    def busy(self, text: str) -> Any:
        return self.console.status(f"[{ORANGE}]✻[/] {self.v(text)}", spinner="dots", spinner_style=ORANGE)

    def screen(self, title: str, draw: Any) -> None:
        """A screen of its own for a view (status, cost, lists): drawn by the same methods as
        the chat, scrolled with the arrows, closed with Esc (or q, or Enter)."""
        from prompt_toolkit.application import Application
        from prompt_toolkit.formatted_text import ANSI, FormattedText
        from prompt_toolkit.key_binding import KeyBindings
        from prompt_toolkit.layout import HSplit, Layout, Window
        from prompt_toolkit.layout.controls import FormattedTextControl
        from prompt_toolkit.styles import Style as PStyle

        with self.console.capture() as captured:
            draw()
        lines = captured.get().rstrip("\n").split("\n")
        state = {"top": 0}

        def height() -> int:
            return max(1, app.output.get_size().rows - 4)

        def body():
            h = height()
            state["top"] = max(0, min(state["top"], len(lines) - h))
            return ANSI("\n".join(lines[state["top"]: state["top"] + h]))

        def scroll(by: int) -> None:
            state["top"] = max(0, min(state["top"] + by, max(0, len(lines) - height())))

        keys = KeyBindings()

        @keys.add("escape", eager=True)
        @keys.add("q")
        @keys.add("enter")
        @keys.add("c-c")
        def _leave(event):  # noqa: ANN001
            event.app.exit()

        keys.add("up")(lambda e: scroll(-1))
        keys.add("down")(lambda e: scroll(1))
        keys.add("pageup")(lambda e: scroll(-height()))
        keys.add("pagedown")(lambda e: scroll(height()))
        keys.add("home")(lambda e: scroll(-len(lines)))
        keys.add("end")(lambda e: scroll(len(lines)))

        header = FormattedText([("class:mark", " ● "), ("class:title", self.v(title))])
        footer = FormattedText([("class:hint", " " + self.v(self.text["screen_hint"]))])
        layout = HSplit([
            Window(FormattedTextControl(header), height=1),
            Window(height=1, char="─", style="class:rule"),
            Window(FormattedTextControl(body), wrap_lines=False),
            Window(FormattedTextControl(footer), height=1),
        ])
        app = Application(
            layout=Layout(layout),
            key_bindings=keys,
            full_screen=True,
            style=PStyle.from_dict({"mark": ORANGE, "title": "bold #f4f2ea", "rule": "#4a4a46", "hint": "#7a7a7a"}),
        )
        app.run()

    def ask_text(self, label: str, secret: bool = False, default: str = "") -> str | None:
        from prompt_toolkit.formatted_text import FormattedText
        from prompt_toolkit.shortcuts import prompt
        from prompt_toolkit.styles import Style as PStyle

        self._keys_busy.set()
        try:
            answer = prompt(
                FormattedText([("class:label", self.v(label)), ("", "\n"), ("class:prompt", "› ")]),
                is_password=secret,
                style=PStyle.from_dict({"label": f"{ORANGE} bold", "prompt": f"{ORANGE} bold"}),
            ).strip()
        except (EOFError, KeyboardInterrupt):
            return None
        finally:
            self._keys_busy.clear()
        return answer or default

    def send(self, message: str) -> None:
        """A reply, with Esc watched meanwhile: Esc stops it (like Ctrl+C), anything else
        typed is kept for the next prompt."""
        done = threading.Event()
        watcher = threading.Thread(target=self._watch_keys, args=(done,), daemon=True)
        watcher.start()
        try:
            super().send(message)
        finally:
            done.set()
            watcher.join(timeout=1)

    def _watch_keys(self, done: threading.Event) -> None:
        def stop() -> None:
            if self.chat_id:
                with contextlib.suppress(Exception):
                    self.api.stop(self.chat_id)

        if sys.platform == "win32":
            import msvcrt

            while not done.is_set():
                if self._keys_busy.is_set() or not msvcrt.kbhit():
                    time.sleep(0.04)
                    continue
                key = msvcrt.getwch()
                if key in ("\x00", "\xe0"):  # an arrow or function key: its second half too
                    msvcrt.getwch()
                elif key == "\x1b" or key == "\x03":
                    stop()
                elif key == "\x08":
                    self._typeahead = self._typeahead[:-1]
                elif key.isprintable():
                    self._typeahead += key
            return
        import select
        import termios
        import tty

        try:
            fd = sys.stdin.fileno()
            saved = termios.tcgetattr(fd)
        except (OSError, ValueError, termios.error):
            return
        try:
            tty.setcbreak(fd)
            while not done.is_set():
                if self._keys_busy.is_set():
                    termios.tcsetattr(fd, termios.TCSADRAIN, saved)
                    while self._keys_busy.is_set() and not done.is_set():
                        time.sleep(0.05)
                    tty.setcbreak(fd)
                    continue
                ready, _, _ = select.select([fd], [], [], 0.05)
                if not ready:
                    continue
                key = sys.stdin.read(1)
                if key == "\x1b":
                    more, _, _ = select.select([fd], [], [], 0.03)
                    if more:  # an escape sequence (arrows): drop it
                        while select.select([fd], [], [], 0.01)[0]:
                            sys.stdin.read(1)
                    else:
                        stop()
                elif key in ("\x7f", "\x08"):
                    self._typeahead = self._typeahead[:-1]
                elif key.isprintable():
                    self._typeahead += key
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, saved)

    def reasoning(self, text: str) -> None:
        """The model's thinking for a step (/think): a dim block, its last lines."""
        from rich.table import Table
        from rich.text import Text

        from rafiq_agent import rtl

        lines = [ln for ln in text.strip().splitlines() if ln.strip()]
        if not lines:
            return
        shown = "\n".join(lines[-8:])
        if len(lines) > 8:
            shown = "…\n" + shown
        if self._last:
            self.console.print()
        grid = Table.grid()
        grid.add_column(width=2)
        grid.add_column(ratio=1)
        body = rtl.Paragraphs(shown, "dim italic") if self.bidi and rtl.has_arabic(shown) else Text(shown, style="dim italic")
        grid.add_row(Text("✻ ", style=ORANGE), body)
        self.console.print(Text(self.v(self.text["thought"]), style=f"dim {ORANGE}"))
        self.console.print(grid)
        self._last = "tool"

    def markdown(self, text: str) -> None:
        from rich.markdown import Markdown

        self.console.print(Markdown(text))

    def cmd_vim(self, _rest: str) -> None:
        from prompt_toolkit.enums import EditingMode

        vi = self.session.editing_mode != EditingMode.VI
        self.session.editing_mode = EditingMode.VI if vi else EditingMode.EMACS
        self.info(self.text["vim_on"] if vi else self.text["vim_off"])

    def thinking(self, on: bool) -> None:
        if on and self._status is None and self._live is None:
            self._status = self.console.status(f"[{ORANGE}]✻[/] {self.v(self.text['thinking'])}", spinner="dots", spinner_style=ORANGE)
            self._status.start()
        elif not on and self._status is not None:
            self._status.stop()
            self._status = None

    def _reply(self):
        """The reply so far after its ● mark: Markdown, or (with Arabic, in a terminal without
        right-to-left) rtl.Paragraphs on the right with the mark on its right."""
        from rich.markdown import Markdown
        from rich.table import Table
        from rich.text import Text

        from rafiq_agent import rtl

        grid = Table.grid(expand=True)
        if self.bidi and rtl.is_rtl(self._buffer.lstrip()):
            grid.add_column(ratio=1)
            grid.add_column(width=2)
            grid.add_row(rtl.Paragraphs(self._buffer.strip("\n"), rtl=True), Text(" ●", style="#f4f2ea"))
            return grid
        grid.add_column(width=2)
        grid.add_column(ratio=1)
        text = self._buffer.strip("\n")
        body = rtl.Paragraphs(text, rtl=False) if self.bidi and rtl.has_arabic(text) else Markdown(text)
        grid.add_row(Text("● ", style="#f4f2ea"), body)
        return grid

    def text_delta(self, text: str) -> None:
        from rich.live import Live

        if self._live is None and not text.strip() and not self._buffer:
            return
        self._buffer += text
        if self._live is None:
            if self._last:
                self.console.print()
            self._live = Live(self._reply(), console=self.console, refresh_per_second=12, vertical_overflow="visible")
            self._live.start()
        else:
            self._live.update(self._reply())

    def text_end(self) -> None:
        if self._live is not None:
            self._live.update(self._reply())
            self._live.stop()
            self._live = None
            self._last = "text"
        self._buffer = ""

    def show_tool(self, name: str, args: dict[str, Any]) -> None:
        from rich.text import Text

        if self._last:
            self.console.print()
        line = Text(no_wrap=True, overflow="ellipsis")
        line.append("● ", style=ORANGE)
        tool, _, detail = tool_title(name, args).partition(": ")
        line.append(tool, style="bold")
        if detail:
            line.append(f"({self.v(detail, False)})", style="dim")
        self.console.print(line)
        self._last = "tool"

    def show_result(self, ok: bool, output: str) -> None:
        from rich.text import Text

        lines = [ln for ln in output.strip().splitlines() if ln.strip()] or [""]
        for i, text in enumerate(lines[:RESULT_LINES]):
            line = Text(no_wrap=True, overflow="ellipsis")
            line.append("  ⎿  " if i == 0 else "     ", style="dim" if ok else "red")
            line.append(self.v(text.strip(), False), style="#8a8a8a" if ok else "red")
            self.console.print(line)
        if len(lines) > RESULT_LINES:
            self.console.print(f"     … +{len(lines) - RESULT_LINES}", style="dim", markup=False)
        self._last = "tool"

    def show_message(self, role: str, text: str) -> None:
        if role == "user":
            self._echo(text.strip()[:600])
        else:
            self._buffer = text.strip()[:1200]
            self.console.print(self._reply())
            self._buffer = ""
            self._last = "text"

    def show_models(self) -> None:
        self.cmd_model("")

    def pick(self, title: str, options: list[tuple[str, str]], default: str | None = None) -> str | None:
        """An arrow-key list (↑ ↓ and Enter; Esc or Ctrl+C leaves it)."""
        from prompt_toolkit.key_binding import KeyBindings
        from prompt_toolkit.shortcuts import choice
        from prompt_toolkit.styles import Style as PStyle

        keys = KeyBindings()

        @keys.add("escape", eager=True)
        def _leave(event):  # noqa: ANN001
            event.app.exit(exception=KeyboardInterrupt())

        self._keys_busy.set()
        try:
            return choice(
                message=self.v(title),
                options=[(value, self.v(label)) for value, label in options],
                default=default if default in {v for v, _ in options} else None,
                symbol="❯",
                key_bindings=keys,
                style=PStyle.from_dict({"selected-option": f"{ORANGE} bold", "frame.border": ORANGE}),
            )
        except (KeyboardInterrupt, EOFError):
            return None
        finally:
            self._keys_busy.clear()

    def ask_permission(self, call: dict[str, Any]) -> str:
        from rich.console import Group
        from rich.panel import Panel
        from rich.syntax import Syntax
        from rich.text import Text

        parts: list[Any] = [Text(self.v(tool_title(call.get("tool", ""), call.get("args") or {}), False), style="bold")]
        if call.get("review"):
            parts.append(Text(self.v(self.text["review"].format(reason=call["review"])), style="dim"))
        preview = str(call.get("preview") or "").strip()
        if preview:
            shown = "\n".join(self.v(line, False) for line in preview.splitlines()[:24])
            parts.append(Syntax(shown, "diff", theme="ansi_dark", background_color="default"))
        self.console.print()
        self.console.print(Panel(Group(*parts), title=self.v(self.text["ask_title"]), title_align="left", border_style=ORANGE, expand=False))
        chosen = self.pick(
            self.text["allow_q"],
            [("approved", self.text["opt_yes"]), ("always", self.text["opt_always"]), ("denied", self.text["opt_no"])],
            "approved",
        )
        self._last = "tool"
        return chosen or "denied"

    def read_line(self) -> str:
        from prompt_toolkit.formatted_text import FormattedText

        self.console.print()
        while True:
            try:
                waiting, self._typeahead = self._typeahead, ""
                line = self.session.prompt(
                    self._message,
                    placeholder=FormattedText([("class:placeholder", self.v(self.text["placeholder"]))]),
                    default=waiting,
                )
                self._last_interrupt = 0.0
                break
            except KeyboardInterrupt:
                # Once clears the line; twice in a row leaves, like other terminal agents.
                now = time.monotonic()
                if now - self._last_interrupt < 4.0:
                    raise
                self._last_interrupt = now
                self.info(self.text["again"])
        while line.endswith("\\"):
            line = line[:-1] + "\n" + self.session.prompt([("class:prompt", "  ")])
        if line.strip():
            self._echo(line)
        self._last = "you"
        return line

    def _echo(self, line: str) -> None:
        """What was typed, printed back in display order on a dark band; an Arabic line on
        the right, with the marker at its right like the input line's."""
        from rich.align import Align
        from rich.text import Text

        from rafiq_agent import rtl

        for i, part in enumerate(line.split("\n")):
            if self.bidi and rtl.is_rtl(part):
                echo = Text()
                echo.append(self.v(part), style="bold #f4f2ea")
                echo.append(" ‹" if i == 0 else "  ", style=f"bold {ORANGE}")
                self.console.print(Align.right(echo))
            else:
                echo = Text("› " if i == 0 else "  ", style=f"bold {ORANGE}")
                echo.append(self.v(part), style="bold #f4f2ea")
                self.console.print(echo)
