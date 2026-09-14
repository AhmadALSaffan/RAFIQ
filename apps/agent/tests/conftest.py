"""Test fixtures.

Every test runs against a throwaway data directory so the suite never touches the real
database, attachments, or the user's skills.
"""

import os
import tempfile
from pathlib import Path

import pytest

_TMP = tempfile.mkdtemp(prefix="rafiq-tests-")
os.environ.setdefault("RAFIQ_DATA_DIR", _TMP)
os.environ.setdefault("RAFIQ_WORKSPACE_DIR", str(Path(_TMP) / "workspace"))
os.environ.setdefault("RAFIQ_TOKEN", "test-token")


@pytest.fixture()
def data_dir() -> Path:
    return Path(_TMP)
