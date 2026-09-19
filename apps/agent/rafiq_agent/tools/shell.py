import asyncio
from pathlib import Path
from typing import Any

from rafiq_agent.tools.base import Tool, ToolResult

DEFAULT_TIMEOUT_SECONDS = 60


class ShellRunTool(Tool):
    name = "shell_run"
    category = "exec"
    description = "Run a shell command in the task's working directory and return its stdout/stderr."
    parameters = {
        "type": "object",
        "properties": {
            "command": {"type": "string"},
            "timeout_seconds": {"type": "integer", "description": f"default {DEFAULT_TIMEOUT_SECONDS}"},
        },
        "required": ["command"],
    }

    def __init__(self, working_dir: Path) -> None:
        self.working_dir = working_dir

    async def run(self, args: dict[str, Any]) -> ToolResult:
        command = args["command"]
        timeout = args.get("timeout_seconds") or DEFAULT_TIMEOUT_SECONDS

        process = await asyncio.create_subprocess_shell(
            command,
            cwd=str(self.working_dir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(process.communicate(), timeout=timeout)
        except TimeoutError:
            process.kill()
            await process.wait()
            return ToolResult(ok=False, output=f"command timed out after {timeout}s")

        stdout = stdout_bytes.decode(errors="replace")
        stderr = stderr_bytes.decode(errors="replace")
        output = stdout
        if stderr:
            output += f"\n[stderr]\n{stderr}"
        if len(output) > 8_000:
            output = output[:8_000] + "\n… (truncated — narrow the command to see more)"

        return ToolResult(
            ok=process.returncode == 0, output=output.strip() or f"(exit code {process.returncode})"
        )
