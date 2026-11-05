"""Rafiq in a real terminal, drawn like a coding agent: rich for the output, prompt_toolkit for
the input line (repl.py is the engine and the plain view).

- A welcome box with the character and the white mark (terminal_logo.py).
- A / menu with each command's description, @ completes file names, history with the arrows.
- Arrow-key lists for /model, /mode, /resume and the permission question.
- Shift+Tab cycles the mode; the bar under the input shows the model, the mode and the folder.
- Arabic: most terminals don't do right-to-left, so every line with Arabic is shaped and put
  in display order (rtl.py) — the replies, the lists, and the line being typed, which also
  sits to the right while it's Arabic. A terminal that does right-to-left itself (JetBrains
  IDEs) is left to it; RAFIQ_BIDI=0 / 1 decides for any other.
- /lang switches all of it between Arabic, English and Russian (repl.py keeps the choice).
"""

from __future__ import annotations

import contextlib
import time
from pathlib import Path
from typing import Any

from rafiq_agent.acp import tool_title
from rafiq_agent.repl import COMMAND_HELP, MAX_RESULT_LINES, ORANGE, Repl


def _short_path(path: str, limit: int = 56) -> str:
    """A long folder path, cut in the middle so both ends stay readable."""
    if len(path) <= limit:
        return path
    keep = (limit - 1) // 2
    return path[:keep] + "…" + path[-keep:]


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


class RichRepl(Repl):
    def __init__(self, *args: Any, version: str = "", **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        from prompt_toolkit import PromptSession
        from prompt_toolkit.completion import Completer, Completion, PathCompleter
        from prompt_toolkit.document import Document
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
        repl = self
        paths = PathCompleter(expanduser=True, get_paths=lambda: [repl.folder])

        class Commands(Completer):
            """/ opens the command menu with descriptions; @ completes file names."""

            def get_completions(self, document, complete_event):  # noqa: ANN001, ANN201
                text = document.text_before_cursor
                if text.startswith("/") and " " not in text:
                    for name, about in COMMAND_HELP:
                        if name.startswith(text):
                            yield Completion(name, start_position=-len(text), display=name, display_meta=repl.v(repl.describe(about)))
                    return
                word = text.split(" ")[-1]
                if word.startswith("@"):
                    sub = Document(word[1:], len(word) - 1)
                    yield from paths.get_completions(sub, complete_event)

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
        self.session = PromptSession(
            history=FileHistory(str(history)),
            completer=Commands(),
            complete_while_typing=True,
            key_bindings=keys,
            bottom_toolbar=self._toolbar,
            input_processors=[_input_processor()] if self.bidi else None,
            # What was typed is printed again by Rafiq, in display order and in place.
            erase_when_done=True,
            style=PStyle.from_dict({
                "prompt": f"{ORANGE} bold",
                "bottom-toolbar": "noreverse #8a8a8a",
                "bottom-toolbar.mode": f"noreverse {ORANGE}",
                "placeholder": "#6b6b6b",
                # The / menu as a plain list under the line, no box: the choice in orange.
                "completion-menu": "bg:default noreverse",
                "completion-menu.completion": "bg:default #d6d6d6",
                "completion-menu.completion.current": f"bg:default {ORANGE} bold noreverse",
                "completion-menu.meta.completion": "bg:default #7a7a7a",
                "completion-menu.meta.completion.current": f"bg:default {ORANGE} noreverse",
                "completion-menu.multi-column-meta": "bg:default #7a7a7a",
                "scrollbar.background": "bg:default",
                "scrollbar.button": "bg:default",
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

    def _toolbar(self):
        from prompt_toolkit.formatted_text import FormattedText

        agent = self.text["mode_own"] if self.owned() else self.text["mode_app"]
        name = Path(self.folder).name or self.folder
        return FormattedText([
            ("bold", f" {self.model['name']}"),
            ("", "  ·  "),
            ("class:bottom-toolbar.mode", f"⏵⏵ {self.v(self.mode_label())}"),
            ("", f" ({self.text['mode_hint']})  ·  {self.v(name)}  ·  {self.v(agent)}"),
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
            Text(self.v(_short_path(self.folder)), style="dim"),
            Text(""),
            Text(self.v(self.text["tips"]), style="dim"),
        )
        grid = Table.grid(padding=(0, 4))
        grid.add_column()
        grid.add_column(vertical="middle")
        grid.add_row(half_blocks(PEEP), info)
        panel = Panel(grid, border_style=ORANGE, padding=(1, 3), expand=False)
        if self.bidi:
            self.console.print(panel)
            return
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

    def thinking(self, on: bool) -> None:
        if on and self._status is None and self._live is None:
            self._status = self.console.status(f"[{ORANGE}]✻[/] {self.v(self.text['thinking'])}", spinner="dots", spinner_style=ORANGE)
            self._status.start()
        elif not on and self._status is not None:
            self._status.stop()
            self._status = None

    def _reply(self):
        """The reply so far: Markdown, or (with Arabic, in a terminal without right-to-left)
        rtl.Paragraphs, which does the wrapping and the order itself."""
        from rich.markdown import Markdown

        from rafiq_agent import rtl

        if self.bidi and rtl.has_arabic(self._buffer):
            return rtl.Paragraphs(self._buffer)
        return Markdown(self._buffer)

    def text_delta(self, text: str) -> None:
        from rich.live import Live

        self._buffer += text
        if self._live is None:
            self._live = Live(self._reply(), console=self.console, refresh_per_second=12, vertical_overflow="visible")
            self._live.start()
        else:
            self._live.update(self._reply())

    def text_end(self) -> None:
        if self._live is not None:
            self._live.update(self._reply())
            self._live.stop()
            self._live = None
        self._buffer = ""

    def show_tool(self, name: str, args: dict[str, Any]) -> None:
        from rich.text import Text

        line = Text()
        line.append("⏺ ", style=ORANGE)
        tool, _, detail = tool_title(name, args).partition(": ")
        line.append(tool, style="bold")
        if detail:
            line.append(f"({self.v(detail, False)})", style="dim")
        self.console.print(line)

    def show_result(self, ok: bool, output: str) -> None:
        from rich.text import Text

        lines = output.strip().splitlines() or [""]
        for i, text in enumerate(lines[:MAX_RESULT_LINES]):
            line = Text("  ⎿  " if i == 0 else "     ", style="green" if ok else "red")
            line.append(self.v(text[:160], False), style="dim")
            self.console.print(line)
        if len(lines) > MAX_RESULT_LINES:
            self.console.print(f"     … +{len(lines) - MAX_RESULT_LINES}", style="dim", markup=False)

    def show_message(self, role: str, text: str) -> None:
        if role == "user":
            self._echo(text.strip()[:600])
        else:
            self._print_text(text.strip()[:1200])

    def show_models(self) -> None:
        self.cmd_model("")

    def pick(self, title: str, options: list[tuple[str, str]], default: str | None = None) -> str | None:
        """An arrow-key list (↑ ↓ and Enter; Ctrl+C leaves it)."""
        from prompt_toolkit.shortcuts import choice
        from prompt_toolkit.styles import Style as PStyle

        try:
            return choice(
                message=self.v(title),
                options=[(value, self.v(label)) for value, label in options],
                default=default if default in {v for v, _ in options} else None,
                symbol="❯",
                style=PStyle.from_dict({"selected-option": f"{ORANGE} bold", "frame.border": ORANGE}),
            )
        except (KeyboardInterrupt, EOFError):
            return None

    def ask_permission(self, call: dict[str, Any]) -> str:
        from rich.console import Group
        from rich.panel import Panel
        from rich.syntax import Syntax
        from rich.text import Text

        parts: list[Any] = [Text(self.v(tool_title(call.get("tool", ""), call.get("args") or {})), style="bold")]
        if call.get("review"):
            parts.append(Text(self.v(self.text["review"].format(reason=call["review"])), style="dim"))
        preview = str(call.get("preview") or "").strip()
        if preview:
            shown = "\n".join(self.v(line) for line in preview.splitlines()[:24])
            parts.append(Syntax(shown, "diff", theme="ansi_dark", background_color="default"))
        self.console.print(Panel(Group(*parts), title=self.v(self.text["ask_title"]), title_align="left", border_style=ORANGE, expand=False))
        chosen = self.pick(
            "",
            [("approved", self.text["opt_yes"]), ("always", self.text["opt_always"]), ("denied", self.text["opt_no"])],
            "approved",
        )
        return chosen or "denied"

    def read_line(self) -> str:
        from prompt_toolkit.formatted_text import FormattedText

        self.console.rule(style="grey35")
        while True:
            try:
                line = self.session.prompt(
                    [("class:prompt", "› ")],
                    placeholder=FormattedText([("class:placeholder", self.v(self.text["placeholder"]))]),
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
        return line

    def _echo(self, line: str) -> None:
        """What was typed, printed back in display order; an Arabic line on the right, with
        the marker at its right like the input line's."""
        from rich.align import Align
        from rich.text import Text

        from rafiq_agent import rtl

        for i, part in enumerate(line.split("\n")):
            if self.bidi and rtl.is_rtl(part):
                echo = Text()
                echo.append(self.v(part), style="bold")
                echo.append(" ‹" if i == 0 else "  ", style=f"bold {ORANGE}")
                self.console.print(Align.right(echo))
            else:
                echo = Text("› " if i == 0 else "  ", style=f"bold {ORANGE}")
                echo.append(self.v(part), style="bold")
                self.console.print(echo)
