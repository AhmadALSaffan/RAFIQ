"""The logs, readable from inside the app.

Two kinds: the agent's own (`agent.log` beside the database — the installed app sends its
output there) and one per stdio MCP server (`logs/mcp-<name>.log`, the server's stderr).

What leaves here is the tail of a file, never the whole of it, and never a secret. An MCP
server is third-party code and prints what it likes — some print their own config, token
and all — so every line is scrubbed on the way out: the secrets Rafiq knows about (the
keys in the credential store, MCP env and header values, the agent's own token) are
replaced exactly, and anything shaped like a key or a password is masked by pattern.
"""

from __future__ import annotations

import os
import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from rafiq_agent.config import DATA_DIR

AGENT_ID = "agent"
AGENT_LOG = DATA_DIR / "agent.log"
MCP_DIR = DATA_DIR / "logs"
MCP_PREFIX = "mcp-"
MASK = "••••••"

DEFAULT_LINES = 500
MAX_LINES = 5_000
# However many lines are asked for, no more than this is read from the end of the file.
MAX_BYTES = 1024 * 1024
# A known secret shorter than this is left alone: masking "on" or "1" would mangle the log
# without protecting anything.
MIN_SECRET = 6

# Shapes of secrets that no list could know about in advance. Each keeps its prefix (the
# part that says what kind of thing was there) and masks the rest.
_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # Authorization headers: whatever follows Bearer or Basic is a credential.
    (re.compile(r"(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}"), rf"\1 {MASK}"),
    # "token <value>" only when the value looks like one — long and with a digit in it — so
    # an error like "Token exchange failed" stays readable.
    (re.compile(r"(?i)\b(token)\s+(?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]{16,}"), rf"\1 {MASK}"),
    # key=value / "key": "value" for anything whose name ends like a secret's: access_token,
    # client_secret, x-api-key, Authorization… — but not prompt_tokens or author.
    (
        re.compile(
            r"""(?ix)
            (\b[\w-]*(?:api[_-]?key|secret|token|password|passwd|pwd|credentials?|private[_-]?key|authorization)
             ["']?\s*[:=]\s*["']?)
            ([^\s"',;&}]{3,})
            """
        ),
        rf"\1{MASK}",
    ),
    # Provider keys with a recognisable prefix.
    (re.compile(r"\b(sk-(?:ant-|proj-)?)[A-Za-z0-9_-]{12,}"), rf"\1{MASK}"),
    (re.compile(r"\b(gh[pousr]_|github_pat_)[A-Za-z0-9_]{12,}"), rf"\1{MASK}"),
    (re.compile(r"\b(xox[abposr]-)[A-Za-z0-9-]{8,}"), rf"\1{MASK}"),
    (re.compile(r"\b(AIza)[A-Za-z0-9_-]{20,}"), rf"\1{MASK}"),
    (re.compile(r"\b(AKIA|ASIA)[A-Z0-9]{12,}"), rf"\1{MASK}"),
    (re.compile(r"\b(glpat-|npm_|pypi-|figd_|ntn_|secret_|lin_api_|sntrys_)[A-Za-z0-9_-]{12,}"), rf"\1{MASK}"),
    # JSON web tokens: three base64url parts, the first starting with a JSON brace.
    (re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"), MASK),
    # Credentials inside a URL: scheme://user:password@host
    (re.compile(r"(\b[a-z][a-z0-9+.-]*://[^\s:/@]+:)[^\s@/]+(@)", re.I), rf"\1{MASK}\2"),
]


@dataclass
class LogFile:
    id: str
    name: str
    kind: str  # "agent" | "mcp"
    path: Path
    size: int
    modified: datetime


def _stat(path: Path) -> tuple[int, datetime] | None:
    try:
        st = path.stat()
    except OSError:
        return None
    return st.st_size, datetime.fromtimestamp(st.st_mtime, UTC)


def list_logs(server_names: dict[str, str] | None = None) -> list[LogFile]:
    """Every log there is, the agent's first, then MCP servers by most recently written.

    `server_names` maps a server's log slug to the name the user gave it, so a log reads as
    "Context7" rather than "mcp-context7".
    """
    names = server_names or {}
    out: list[LogFile] = []
    if (info := _stat(AGENT_LOG)) is not None:
        out.append(LogFile(AGENT_ID, "Rafiq", "agent", AGENT_LOG, *info))
    servers: list[LogFile] = []
    if MCP_DIR.is_dir():
        for path in MCP_DIR.glob(f"{MCP_PREFIX}*.log"):
            if (info := _stat(path)) is None:
                continue
            slug = path.stem[len(MCP_PREFIX) :]
            servers.append(LogFile(path.stem, names.get(slug, slug), "mcp", path, *info))
    servers.sort(key=lambda log: log.modified, reverse=True)
    return out + servers


def find(log_id: str, server_names: dict[str, str] | None = None) -> LogFile | None:
    """A log by id — only ever one from the listing, so an id can't name any other file."""
    return next((log for log in list_logs(server_names) if log.id == log_id), None)


def tail(path: Path, lines: int = DEFAULT_LINES) -> tuple[str, bool]:
    """The last `lines` lines of a file, read from the end so a large log costs the same as
    a small one. Returns the text and whether anything before it was left out."""
    lines = max(1, min(lines, MAX_LINES))
    with open(path, "rb") as handle:
        handle.seek(0, os.SEEK_END)
        size = handle.tell()
        start = max(0, size - MAX_BYTES)
        handle.seek(start)
        data = handle.read()
    text = data.decode("utf-8", errors="replace")
    rows = text.splitlines()
    if start > 0 and rows:
        rows = rows[1:]  # the first line was cut in the middle by the byte limit
    cut = start > 0 or len(rows) > lines
    return "\n".join(rows[-lines:]), cut


def redact(text: str, known: Iterable[str] = ()) -> str:
    """The text with every secret masked: the ones we know exactly, the rest by shape."""
    for secret in sorted({s for s in known if s and len(s) >= MIN_SECRET}, key=len, reverse=True):
        text = text.replace(secret, MASK)
    for pattern, replacement in _PATTERNS:
        text = pattern.sub(replacement, text)
    return text
