from typing import Any

import psutil

from rafiq_agent.tools.base import Tool, ToolResult


class ProcessListTool(Tool):
    name = "process_list"
    category = "read_only"
    description = "List running processes (pid, name, cpu%, memory%)."
    parameters = {
        "type": "object",
        "properties": {
            "name_filter": {"type": "string", "description": "optional substring filter on process name"}
        },
    }

    async def run(self, args: dict[str, Any]) -> ToolResult:
        name_filter = (args.get("name_filter") or "").lower()
        rows = []
        for p in psutil.process_iter(["pid", "name", "cpu_percent", "memory_percent"]):
            info = p.info
            if name_filter and name_filter not in (info.get("name") or "").lower():
                continue
            rows.append(
                f"{info['pid']:>7}  {info.get('name', '?'):<28}  cpu={info.get('cpu_percent', 0):.1f}%  mem={info.get('memory_percent', 0):.1f}%"
            )
        rows.sort()
        return ToolResult(ok=True, output="\n".join(rows[:200]) or "(no matching processes)")


class ProcessKillTool(Tool):
    name = "process_kill"
    category = "exec"
    description = "Terminate a process by PID."
    parameters = {
        "type": "object",
        "properties": {"pid": {"type": "integer"}},
        "required": ["pid"],
    }

    async def run(self, args: dict[str, Any]) -> ToolResult:
        pid = args["pid"]
        try:
            proc = psutil.Process(pid)
            name = proc.name()
            proc.terminate()
            return ToolResult(ok=True, output=f"terminated pid {pid} ({name})")
        except psutil.NoSuchProcess:
            return ToolResult(ok=False, output=f"no such process: {pid}")
        except psutil.AccessDenied:
            return ToolResult(ok=False, output=f"access denied terminating pid {pid}")
