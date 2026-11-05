"""Entry point for `rafiq.exe`: the `rafiq` command and code editors (ACP, rafiq_agent/acp.py).

A console program of its own, frozen next to rafiq-agent.exe (see rafiq-agent.spec). The agent
itself is a windowed program, and Windows doesn't wait for those: started through PowerShell,
as Zed does, it returned at once with no output and the editor saw the agent exit. A console
program is waited for and keeps its pipes. It only needs the standard library.
"""

from rafiq_agent.cli import main

if __name__ == "__main__":
    main()
