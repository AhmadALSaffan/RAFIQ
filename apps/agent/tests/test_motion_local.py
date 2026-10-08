"""The optional local models: nothing is kept unless its hash matches, only the listed files
come out of an archive, and whisper's per-word output becomes caption words."""

import hashlib
import io
import zipfile

import httpx
import pytest

from rafiq_agent.motion import local_models


def _zip(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in files.items():
            z.writestr(name, data)
    return buf.getvalue()


@pytest.fixture()
def fake_pack(tmp_path, monkeypatch):
    """A tiny 'voice' pack served from memory, installed under a temporary folder."""
    archive = _zip({"piper/piper.exe": b"exe", "piper/espeak-ng-data/ar_dict": b"d", "other/evil.exe": b"x", "piper/../../escape.txt": b"x"})
    model = b"onnx-bytes"
    config = b"{}"
    files = {"https://example.test/piper.zip": archive, "https://example.test/voice.onnx": model, "https://example.test/voice.onnx.json": config}
    spec = {
        "files": [
            {"name": "piper_windows_amd64.zip", "url": "https://example.test/piper.zip", "sha256": hashlib.sha256(archive).hexdigest(), "size": len(archive), "unzip": r"^piper/"},
            {"name": "ar_JO-kareem-medium.onnx", "url": "https://example.test/voice.onnx", "sha256": hashlib.sha256(model).hexdigest(), "size": len(model)},
            {"name": "ar_JO-kareem-medium.onnx.json", "url": "https://example.test/voice.onnx.json", "sha256": hashlib.sha256(config).hexdigest(), "size": len(config)},
        ],
        "version": "test",
        "licenses": ["MIT"],
    }
    transport = httpx.MockTransport(lambda request: httpx.Response(200, content=files[str(request.url)]) if str(request.url) in files else httpx.Response(404))
    real_client = httpx.AsyncClient

    def client(*args, **kwargs):
        kwargs.pop("follow_redirects", None)
        return real_client(*args, transport=transport, **kwargs)

    monkeypatch.setattr(local_models.httpx, "AsyncClient", client)
    monkeypatch.setattr(local_models, "ROOT", tmp_path / "local")
    monkeypatch.setitem(local_models.PACKS, "voice", spec)

    async def tried():
        return None

    monkeypatch.setattr(local_models, "_try_voice", tried)
    return spec


async def test_a_pack_installs_only_its_listed_files(fake_pack, tmp_path):
    result = await local_models.install("voice")
    assert result["installed"]
    folder = tmp_path / "local" / "voice"
    assert (folder / "piper" / "piper.exe").read_bytes() == b"exe"
    assert not (folder / "other").exists()
    assert not (tmp_path / "escape.txt").exists() and not (tmp_path / "local" / "escape.txt").exists()
    assert local_models.voice_ready()
    local_models.remove("voice")
    assert not local_models.voice_ready()


async def test_a_wrong_hash_installs_nothing(fake_pack, tmp_path):
    fake_pack["files"][1]["sha256"] = "0" * 64
    with pytest.raises(local_models.LocalModelError, match="checksum mismatch"):
        await local_models.install("voice")
    assert not local_models.voice_ready()
    assert not (tmp_path / "local" / "voice").exists()
    assert local_models.status()["voice"]["progress"]["state"] == "failed"


def test_whisper_word_segments_become_caption_words():
    result = {
        "transcription": [
            {"text": " مرحبا", "offsets": {"from": 220, "to": 880}},
            {"text": " ", "offsets": {"from": 880, "to": 900}},
            {"text": "رفيق", "offsets": {"from": 900, "to": 1500}},
        ]
    }
    assert local_models._words_from(result) == [{"w": "مرحبا", "t0": 0.22, "t1": 0.88}, {"w": "رفيق", "t0": 0.9, "t1": 1.5}]


def test_status_lists_every_pack_with_its_licences_and_size():
    status = local_models.status()
    assert set(status) == {"whisper", "voice"}
    for pack in status.values():
        assert pack["licenses"] and pack["download_size"] > 0
