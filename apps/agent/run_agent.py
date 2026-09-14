"""Entry point for the packaged backend.

`pnpm tauri dev` runs the agent through uvicorn's CLI from the venv. The installed app has
no venv and no Python, so PyInstaller freezes this file into `rafiq-agent.exe`, which Tauri
ships next to the app and spawns the same way.
"""

import argparse
import os
import sys
from pathlib import Path


def _log_file() -> Path:
    base = os.environ.get("RAFIQ_DATA_DIR")
    if base:
        path = Path(base)
    else:
        appdata = os.environ.get("APPDATA")
        path = Path(appdata) / "Rafiq" if appdata else Path.home() / ".rafiq"
    path.mkdir(parents=True, exist_ok=True)
    return path / "agent.log"


def _attach_streams() -> None:
    """A windowed PyInstaller build starts with stdout/stderr set to None.

    Anything that touches them then explodes — uvicorn's colour formatter calls
    `sys.stdout.isatty()` before it logs a single line — so give the process real streams
    pointed at a log file next to the database.
    """
    if sys.stdout is not None and sys.stderr is not None:
        return
    try:
        # Deliberately not a context manager: this stream stays open for the life of
        # the process because it *is* stdout/stderr from here on.
        stream = open(_log_file(), "a", encoding="utf-8", buffering=1)  # noqa: SIM115
    except OSError:
        stream = open(os.devnull, "w", encoding="utf-8")  # noqa: SIM115
    if sys.stdout is None:
        sys.stdout = stream
    if sys.stderr is None:
        sys.stderr = stream


def main() -> None:
    parser = argparse.ArgumentParser(prog="rafiq-agent")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    import uvicorn

    from rafiq_agent.config import CORS_ORIGINS, DATA_DIR
    from rafiq_agent.main import app

    # One line per launch, so a broken install can be diagnosed from the log alone.
    print(
        f"[rafiq-agent] starting on {args.host}:{args.port} | data: {DATA_DIR} | "
        f"origins: {','.join(CORS_ORIGINS)}",
        flush=True,
    )

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        # The frozen build has no terminal: uvicorn's own logging config assumes one.
        log_config=None,
        log_level="warning",
        access_log=False,
    )


if __name__ == "__main__":
    if getattr(sys, "frozen", False):
        import multiprocessing

        multiprocessing.freeze_support()
        _attach_streams()
    main()
