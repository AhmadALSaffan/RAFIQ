"""The git branch of a folder — what a task template's `{{branch}}` starts out as."""

import subprocess

import httpx
import pytest
from httpx import ASGITransport

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.core import gitops
from rafiq_agent.main import app

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}
pytestmark = pytest.mark.skipif(not gitops.available(), reason="git is not installed")


@pytest.fixture()
async def client():
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


async def test_a_repository_reports_its_branch_and_a_plain_folder_none(client, tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "feature/cart")
    _git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "start")
    (repo / "src").mkdir()

    r = await client.get("/files/git", params={"dir": str(repo / "src")}, headers=AUTH)
    assert r.json() == {"repo": True, "branch": "feature/cart"}

    plain = tmp_path / "plain"
    plain.mkdir()
    r = await client.get("/files/git", params={"dir": str(plain)}, headers=AUTH)
    assert r.json() == {"repo": False, "branch": None}

    _git(repo, "checkout", "-q", "--detach")
    r = await client.get("/files/git", params={"dir": str(repo)}, headers=AUTH)
    assert r.json() == {"repo": True, "branch": None}
