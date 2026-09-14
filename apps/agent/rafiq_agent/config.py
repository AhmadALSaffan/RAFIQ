import os
import secrets
from pathlib import Path


def _data_dir() -> Path:
    base = os.environ.get("RAFIQ_DATA_DIR")
    if base:
        path = Path(base)
    else:
        appdata = os.environ.get("APPDATA")
        path = Path(appdata) / "Rafiq" if appdata else Path.home() / ".rafiq"
    path.mkdir(parents=True, exist_ok=True)
    return path


DATA_DIR = _data_dir()
DB_PATH = DATA_DIR / "rafiq.db"
DATABASE_URL = f"sqlite+aiosqlite:///{DB_PATH.as_posix()}"

KEYRING_SERVICE = "rafiq-agent"

# The Tauri sidecar passes this in; standalone dev runs generate one and print it
# so no other local process can call an agent that has shell/desktop-control power.
AUTH_TOKEN = os.environ.get("RAFIQ_TOKEN")
if AUTH_TOKEN is None:
    AUTH_TOKEN = secrets.token_urlsafe(32)
    print(f"[rafiq-agent] no RAFIQ_TOKEN set — generated dev token: {AUTH_TOKEN}")

# The packaged app's webview doesn't use one fixed origin: Windows serves the bundle from
# http://tauri.localhost, macOS/Linux from tauri://localhost, and `vite dev` from :1420.
# Missing one of these looks exactly like "the backend never starts" — every request from
# the UI fails CORS while the server itself is fine.
DEFAULT_CORS_ORIGINS = ",".join(
    [
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ]
)

CORS_ORIGINS = os.environ.get("RAFIQ_CORS_ORIGINS", DEFAULT_CORS_ORIGINS).split(",")
