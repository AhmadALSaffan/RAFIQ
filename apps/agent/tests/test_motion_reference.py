"""motion_reference: real photos to copy from, shown to the model, never added to the scene."""

from rafiq_agent.tools.motion import motion_tools
from rafiq_agent.tools.motion_media import COPY_METHOD, MotionReferenceTool, _meta_text


def test_it_is_one_of_the_motion_tools_and_only_reads():
    tools = {t.name: t for t in motion_tools("p1", chat_model="gpt-4o")}
    ref = tools["motion_reference"]
    assert isinstance(ref, MotionReferenceTool)
    assert ref.category == "read"
    assert ref.chat_model == "gpt-4o"


async def test_it_needs_something_to_look_for():
    result = await MotionReferenceTool("p1").run({})
    assert not result.ok
    assert "query" in result.output


async def test_it_refuses_a_private_address():
    result = await MotionReferenceTool("p1").run({"url": "http://127.0.0.1/secret.jpg"})
    assert not result.ok


def test_commons_credits_come_out_as_short_plain_text():
    meta = {"Artist": {"value": '<a href="//commons.wikimedia.org/wiki/User:X">Some   Photographer</a>'}}
    assert _meta_text(meta, "Artist") == "Some Photographer"
    assert _meta_text(meta, "LicenseShortName") == ""


def test_the_method_says_to_copy_tower_by_tower_and_match_the_camera():
    assert "building" in COPY_METHOD and "camera" in COPY_METHOD.lower() and "never a `city`" in COPY_METHOD
