import asyncio
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any

from rafiq_agent.tools.base import Tool, ToolResult

DEFAULT_TIMEOUT_SECONDS = 60
MAX_OUTPUT = 8_000

# An inline program squeezed into one command line: on Windows it goes through cmd.exe, which
# eats `^`, `%` and quotes inside it, so any regex or nested string comes out broken.
INLINE_CODE = re.compile(r"\b(python3?|py|node)(\.exe)?\"?\s+(-\w*c\b|-e\b)|\bpowershell(\.exe)?\b.*-c(ommand)?\b", re.I)
INLINE_HINT = (
    "\n\n(hint: code inside a one-line command breaks on quotes, ^, % and non-English text when it "
    "goes through the Windows shell. Send it as `script` with `language` instead — it runs from a "
    "file, exactly as written.)"
)

LANGUAGES = ("python", "powershell", "node")


def _child_env() -> dict[str, str]:
    """Programs the model runs print UTF-8: a Python script printing an Arabic file name
    otherwise dies on Windows' default encoding (cp1252) before printing anything."""
    env = dict(os.environ)
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    return env


def _decode(data: bytes) -> str:
    """UTF-8 first (what our children print); cmd's own messages come in the console code page."""
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        pass
    if sys.platform == "win32":
        import ctypes

        try:
            return data.decode(f"cp{ctypes.windll.kernel32.GetOEMCP()}", errors="replace")
        except LookupError:
            pass
    return data.decode(errors="replace")


def _python() -> list[str] | None:
    found = shutil.which("python")
    # The Microsoft Store stub answers to "python" but only opens the Store.
    if found and "WindowsApps" not in found:
        return [found]
    if launcher := shutil.which("py"):
        return [launcher, "-3"]
    return [found] if found else None


def _interpreter(language: str, script: Path) -> list[str] | None:
    if language == "python":
        python = _python()
        return [*python, str(script)] if python else None
    if language == "node":
        node = shutil.which("node")
        return [node, str(script)] if node else None
    shell = shutil.which("powershell") or shutil.which("pwsh")
    return [shell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script)] if shell else None


class ShellRunTool(Tool):
    name = "shell_run"
    category = "exec"
    description = (
        "Run a command in the task's working directory and return its stdout/stderr. "
        "`command` is one shell command line (cmd.exe on Windows) — for running programs, git, "
        "builds and tests. For anything with code in it (a Python or Node snippet, a regex, "
        "nested quotes, non-English text) pass `script` and `language` instead: it's saved to a "
        "file and run as written, with UTF-8 output. Print only what you need to see — a "
        "length, a count, a few lines — not whole files."
    )
    parameters = {
        "type": "object",
        "properties": {
            "command": {"type": "string", "description": "A single command line"},
            "script": {"type": "string", "description": "A whole program, run from a file (instead of command)"},
            "language": {"type": "string", "enum": list(LANGUAGES), "description": "The script's language (default python)"},
            "timeout_seconds": {"type": "integer", "description": f"default {DEFAULT_TIMEOUT_SECONDS}"},
        },
    }

    def __init__(self, working_dir: Path) -> None:
        self.working_dir = working_dir

    async def run(self, args: dict[str, Any]) -> ToolResult:
        timeout = args.get("timeout_seconds") or DEFAULT_TIMEOUT_SECONDS
        script = args.get("script")
        if script:
            language = str(args.get("language") or "python").lower()
            if language not in LANGUAGES:
                return ToolResult(ok=False, output=f"unknown language: {language} (one of {', '.join(LANGUAGES)})")
            return await self._run_script(str(script), language, timeout)
        command = args.get("command")
        if not command:
            return ToolResult(ok=False, output="pass `command`, or `script` with `language`")
        process = await asyncio.create_subprocess_shell(
            command,
            cwd=str(self.working_dir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=_child_env(),
        )
        result = await self._collect(process, timeout)
        if not result.ok and INLINE_CODE.search(command):
            result.output += INLINE_HINT
        return result

    async def _run_script(self, script: str, language: str, timeout: int) -> ToolResult:
        suffix = {"python": ".py", "node": ".js", "powershell": ".ps1"}[language]
        if language == "powershell":
            # Windows PowerShell reads a file without a BOM as ANSI, and prints in the console's
            # code page unless told otherwise.
            script = "[Console]::OutputEncoding = [Text.Encoding]::UTF8\n$OutputEncoding = [Text.Encoding]::UTF8\n" + script
        # Outside the user's folder, so it never shows up in their files or their git status.
        folder = Path(tempfile.mkdtemp(prefix="rafiq-run-"))
        try:
            path = folder / f"script{suffix}"
            path.write_text(script, encoding="utf-8-sig" if language == "powershell" else "utf-8")
            argv = _interpreter(language, path)
            if argv is None:
                return ToolResult(ok=False, output=f"{language} isn't installed on this computer (not on PATH)")
            process = await asyncio.create_subprocess_exec(
                *argv,
                cwd=str(self.working_dir),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=_child_env(),
            )
            return await self._collect(process, timeout)
        finally:
            shutil.rmtree(folder, ignore_errors=True)

    async def _collect(self, process: asyncio.subprocess.Process, timeout: int) -> ToolResult:
        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(process.communicate(), timeout=timeout)
        except TimeoutError:
            process.kill()
            await process.wait()
            return ToolResult(ok=False, output=f"command timed out after {timeout}s")

        stdout = _decode(stdout_bytes)
        stderr = _decode(stderr_bytes)
        output = stdout
        if stderr:
            output += f"\n[stderr]\n{stderr}"
        if len(output) > MAX_OUTPUT:
            # The start says what ran, the end says how it ended (the error is usually last).
            half = MAX_OUTPUT // 2
            output = f"{output[:half]}\n… ({len(output) - MAX_OUTPUT} characters cut — print less to see it all) …\n{output[-half:]}"

        return ToolResult(
            ok=process.returncode == 0, output=output.strip() or f"(exit code {process.returncode})"
        )
