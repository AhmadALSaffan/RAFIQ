"""Pictures reach the model however they come: attached, opened from a file, or taken by a
tool — and through Copilot as well as the direct APIs. Nothing to install on the machine."""

import asyncio
import base64
import io

import pytest
from PIL import Image

from rafiq_agent.tools.filesystem import FilesystemReadTool


def _png(path, size=(40, 30), colour=(230, 136, 53)) -> None:
    Image.new("RGB", size, colour).save(path, format="PNG")


async def test_reading_an_image_file_shows_the_picture(tmp_path):
    _png(tmp_path / "design.png")
    result = await FilesystemReadTool(tmp_path).run({"path": "design.png"})
    assert result.ok
    assert "40×30" in result.output
    assert result.images and result.images[0].startswith("data:image/")
    raw = base64.b64decode(result.images[0].split(",", 1)[1])
    assert Image.open(io.BytesIO(raw)).size == (40, 30)


async def test_a_binary_file_says_so_instead_of_returning_garbage(tmp_path):
    (tmp_path / "archive.bin").write_bytes(b"\x00\x01\x02binary\x00")
    result = await FilesystemReadTool(tmp_path).run({"path": "archive.bin"})
    assert not result.ok
    assert "binary" in result.output
    assert not result.images


async def test_a_pdf_comes_back_as_text(tmp_path):
    from pypdf import PdfWriter

    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    with open(tmp_path / "empty.pdf", "wb") as f:
        writer.write(f)
    result = await FilesystemReadTool(tmp_path).run({"path": "empty.pdf"})
    assert result.ok
    assert "صفحة 1" in result.output


async def test_copilot_gets_attached_and_tool_pictures(monkeypatch, tmp_path):
    pytest.importorskip("copilot")
    from copilot.session_events import AssistantMessageDeltaData, SessionIdleData

    from rafiq_agent.core.loop import LoopCallbacks, run_agent_loop
    from rafiq_agent.llm import copilot as bridge
    from rafiq_agent.tools.base import ToolRegistry

    _png(tmp_path / "shot.png")

    class Event:
        def __init__(self, data):
            self.data = data

    tool_results = []

    class FakeSession:
        def __init__(self, options):
            self.options = options
            self.attachments = []

        async def send(self, prompt, attachments=None):
            self.attachments.append(attachments)

            async def run():
                tool = self.options["tools"][0]

                class Invocation:
                    tool_call_id = "call_1"
                    arguments = {"path": "shot.png"}

                tool_results.append(await tool.handler(Invocation()))
                self.options["on_event"](Event(AssistantMessageDeltaData.from_dict({"deltaContent": "شفتها", "messageId": "m"})))
                self.options["on_event"](Event(SessionIdleData.from_dict({})))

            asyncio.get_running_loop().create_task(run())
            return "msg"

        async def disconnect(self):
            pass

    sessions = []

    class FakeClient:
        async def create_session(self, **options):
            sessions.append(FakeSession(options))
            return sessions[-1]

    async def fake_client_for(account_id, token):
        return FakeClient()

    monkeypatch.setattr(bridge, "client_for", fake_client_for)
    registry = ToolRegistry()
    registry.register(FilesystemReadTool(tmp_path))

    async def permit(*_args, **_kwargs):
        return True

    pixel = base64.b64encode(b"fake-jpeg").decode()
    messages = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": [{"type": "text", "text": "شو بالصورة؟"}, {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{pixel}"}}]},
    ]
    provider = bridge.CopilotProvider(account_id="acc", token="gho_x", model_id="claude-sonnet-5.5")
    result = await run_agent_loop(provider, messages, registry, LoopCallbacks(permit=permit))

    # The attached picture went along with the message, not as a "can't see it" note.
    sent = sessions[0].attachments[0]
    assert sent == [{"type": "blob", "data": pixel, "mimeType": "image/jpeg", "displayName": "image-1"}]
    # The picture the tool opened came back with the tool's result.
    binary = tool_results[0].binary_results_for_llm
    assert binary and binary[0].type == "image" and binary[0].mime_type.startswith("image/")
    assert "شفتها" in result.text
    # …and no extra user message was slipped in while the tool call waited.
    assert not any(m.get("role") == "user" and isinstance(m.get("content"), list) and m is not messages[1] for m in messages)
