"""Motion projects on the agent side: the scene format, JSON Patch, the structural checks,
brand kits, versions and restore, assets, exports written in chunks and read back, and the
engine channel."""

import asyncio
import json
import struct
from pathlib import Path

import httpx
import pytest
from httpx import ASGITransport

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.main import app
from rafiq_agent.motion import brand, bridge, lint, mp4
from rafiq_agent.motion import scene as rms
from rafiq_agent.motion.patch import PatchError, apply_patch
from rafiq_agent.storage.db import SessionLocal, init_db
from rafiq_agent.storage.models import LlmModel

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}
EXAMPLES = Path(rms.SCHEMA_PATH).parent / "examples"


def _text(id_: str, text: str, start: float = 0, end: float = 4, **extra):
    return {"id": id_, "type": "text", "text": text, "style": "title", "start": start, "end": end, **extra}


# ── Format ──────────────────────────────────────────────────────────────────────────────


def test_a_new_scene_is_valid_for_every_aspect():
    for aspect in rms.ASPECTS:
        assert rms.validate(rms.new_scene(aspect)) == []


@pytest.mark.parametrize("name", ["reel", "intro", "chart"])
def test_the_skill_examples_are_valid_and_pass_the_checks(name):
    scene = json.loads((EXAMPLES / f"{name}.json").read_text(encoding="utf-8"))
    assert rms.validate(scene) == []
    assert lint.structural(scene, brand.template(None)) == []


def test_validation_catches_what_the_schema_cannot():
    scene = rms.new_scene()
    scene["layers"] = [
        _text("a", "x", 2, 1),
        _text("a", "y", layout={"below": "ghost"}),
        {"id": "img", "type": "image", "start": 0, "end": 1, "asset": "nope"},
    ]
    messages = " | ".join(e["message"] for e in rms.validate(scene))
    assert "end must be after start" in messages
    assert "duplicate layer id" in messages
    assert "no layer with id 'ghost'" in messages
    assert "no asset 'nope'" in messages


def test_validation_rejects_unknown_fields_and_bad_values():
    scene = rms.new_scene()
    scene["layers"] = [{**_text("a", "x"), "colour": "red"}, {**_text("b", "y"), "style": "huge"}]
    assert len(rms.validate(scene)) >= 2


# ── Patch ───────────────────────────────────────────────────────────────────────────────


def test_patch_adds_replaces_moves_and_tests():
    doc = {"layers": [{"id": "a"}], "n": 1}
    out = apply_patch(
        doc,
        [
            {"op": "add", "path": "/layers/-", "value": {"id": "b"}},
            {"op": "replace", "path": "/n", "value": 2},
            {"op": "move", "from": "/layers/0", "path": "/layers/1"},
            {"op": "test", "path": "/layers/0/id", "value": "b"},
            {"op": "copy", "from": "/n", "path": "/m"},
            {"op": "remove", "path": "/m"},
        ],
    )
    assert out == {"layers": [{"id": "b"}, {"id": "a"}], "n": 2}
    assert doc == {"layers": [{"id": "a"}], "n": 1}  # the original is untouched


def test_a_failing_patch_changes_nothing():
    doc = {"a": 1}
    with pytest.raises(PatchError):
        apply_patch(doc, [{"op": "replace", "path": "/a", "value": 2}, {"op": "remove", "path": "/missing"}])
    assert doc == {"a": 1}


def test_patch_paths_escape_and_index_rules():
    assert apply_patch({"a/b": 1}, [{"op": "replace", "path": "/a~1b", "value": 2}]) == {"a/b": 2}
    with pytest.raises(PatchError):
        apply_patch({"l": [1]}, [{"op": "add", "path": "/l/01", "value": 2}])


# ── Checks ──────────────────────────────────────────────────────────────────────────────


def _codes(scene):
    return {i["code"] for i in lint.structural(scene, brand.template(None))}


def test_structural_checks_each_code():
    scene = rms.new_scene()
    scene["layers"] = [
        _text("grid", "مرحبا", layout={"x": 1.5, "gap": 5}),
        _text("hex", "مرحبا", color="#ff0000"),
        _text("fast", "خمس كلمات بسرعة كبيرة جداً", 0, 0.6),
        {**_text("ease", "مرحبا"), "animate": [{"preset": "fadeIn", "at": 0, "ease": "bounceWild"}]},
    ]
    for i in range(4):
        scene["layers"].append({**_text(f"m{i}", "ok"), "animate": [{"preset": "fadeUp", "at": 1.0}]})
    codes = _codes(scene)
    assert {"M001", "M005", "M006"} <= codes
    # colours are open: a hex colour is fine (the contrast check still applies)
    assert "M008" not in codes
    # bounceWild doesn't even pass the schema; the lint still names it for the model.
    assert "M007" in codes


def test_small_type_is_flagged():
    kit = brand.template(None)
    kit["type"]["caption"] = 20
    scene = rms.new_scene()
    scene["layers"] = [{**_text("c", "صغير"), "style": "caption"}]
    assert "M012" in {i["code"] for i in lint.structural(scene, kit)}


def test_lottie_target_flags_what_lottie_cannot_carry():
    scene = rms.new_scene()
    scene["assets"] = {"v": {"type": "video", "src": "asset://abc"}}
    scene["layers"] = [{"id": "v", "type": "video", "asset": "v", "start": 0, "end": 2}]
    issues = lint.structural(scene, brand.template(None), "lottie")
    assert any(i["code"] == "L001" for i in issues)
    assert not any(i["code"] == "L001" for i in lint.structural(scene, brand.template(None), "mp4"))


# ── Brand kits ──────────────────────────────────────────────────────────────────────────


def test_templates_pass_their_own_contrast_rules():
    for name in brand.TEMPLATES:
        assert brand.check_kit(brand.template(name)) == []


def test_a_kit_with_unreadable_pairs_or_unknown_fonts_is_refused():
    kit = brand.template(None)
    kit["colors"]["onSurface"] = "#111111"
    kit["fonts"]["display"] = "Comic Sans"
    problems = " ".join(brand.check_kit(kit))
    assert "contrast" in problems or "fonts.display" in problems
    assert "fonts.display" in problems


# ── MP4 read-back ───────────────────────────────────────────────────────────────────────


def _box(kind: bytes, body: bytes) -> bytes:
    return struct.pack(">I4s", 8 + len(body), kind) + body


def _tiny_mp4(frames: int, fps: int, width: int, height: int) -> bytes:
    """Just enough box structure for the reader: one video track."""
    timescale = fps * 100
    mvhd = _box(b"mvhd", b"\0" * 4 + struct.pack(">IIII", 0, 0, timescale, frames * 100) + b"\0" * 80)
    tkhd = _box(b"tkhd", b"\0" * 4 + b"\0" * 20 + b"\0" * 52 + struct.pack(">II", width << 16, height << 16))
    mdhd = _box(b"mdhd", b"\0" * 4 + struct.pack(">IIII", 0, 0, timescale, frames * 100) + b"\0" * 4)
    hdlr = _box(b"hdlr", b"\0" * 8 + b"vide" + b"\0" * 12)
    stsd = _box(b"stsd", b"\0" * 8 + struct.pack(">I4s", 16, b"avc1") + b"\0" * 8)
    stsz = _box(b"stsz", b"\0" * 4 + struct.pack(">II", 0, frames))
    stbl = _box(b"stbl", stsd + stsz)
    minf = _box(b"minf", stbl)
    mdia = _box(b"mdia", mdhd + hdlr + minf)
    trak = _box(b"trak", tkhd + mdia)
    moov = _box(b"moov", mvhd + trak)
    return _box(b"ftyp", b"isom" + b"\0" * 4) + moov + _box(b"mdat", b"")


def test_mp4_probe_reads_size_frames_and_rate(tmp_path):
    path = tmp_path / "x.mp4"
    path.write_bytes(_tiny_mp4(300, 60, 1920, 1080))
    report, problems = mp4.verify(path, {"width": 1920, "height": 1080, "fps": 60, "duration": 5})
    assert problems == []
    assert report["video"]["frames"] == 300
    assert report["video"]["fps"] == 60.0
    _, wrong = mp4.verify(path, {"width": 1080, "fps": 30, "duration": 5, "audio": True})
    assert any("width" in p for p in wrong) and any("fps" in p for p in wrong) and "no audio track" in wrong


def test_mp4_probe_refuses_an_incomplete_file(tmp_path):
    path = tmp_path / "half.mp4"
    path.write_bytes(_box(b"ftyp", b"isom" + b"\0" * 4) + _box(b"mdat", b"\0" * 10))
    with pytest.raises(ValueError):
        mp4.probe(path)


# ── API ─────────────────────────────────────────────────────────────────────────────────


@pytest.fixture()
async def client():
    await init_db()
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture()
async def model_id():
    async with SessionLocal() as session:
        model = LlmModel(name="test", provider="openai", model_id="gpt-test")
        session.add(model)
        await session.commit()
        return model.id


async def test_project_lifecycle_versions_and_restore(client, model_id):
    created = await client.post("/motion/projects", json={"model_id": model_id, "title": "ريل", "aspect": "16:9", "fps": 60}, headers=AUTH)
    assert created.status_code == 201
    project = created.json()
    assert project["scene"]["composition"]["width"] == 1920
    assert project["kit"]["colors"]["primary"]
    pid = project["id"]
    assert Path(project["folder"], "scene.json").is_file()

    layer = _text("title", "مرحبا")
    patched = await client.post(f"/motion/projects/{pid}/patch", json={"patch": [{"op": "add", "path": "/layers/-", "value": layer}], "summary": "add title"}, headers=AUTH)
    assert patched.status_code == 200, patched.text
    assert patched.json()["version"] == 2

    bad = await client.post(f"/motion/projects/{pid}/patch", json={"patch": [{"op": "add", "path": "/layers/-", "value": {"id": "x"}}]}, headers=AUTH)
    assert bad.status_code == 400  # invalid layer: nothing saved
    assert (await client.get(f"/motion/projects/{pid}", headers=AUTH)).json()["version"] == 2

    listed = (await client.get(f"/motion/projects/{pid}/versions", headers=AUTH)).json()
    assert [v["number"] for v in listed] == [2, 1]

    restored = await client.post(f"/motion/projects/{pid}/versions/1/restore", headers=AUTH)
    assert restored.json()["version"] == 3
    assert restored.json()["scene"]["layers"] == []

    summaries = (await client.get("/motion/projects", headers=AUTH)).json()
    assert any(s["id"] == pid and s["width"] == 1920 for s in summaries)
    assert (await client.delete(f"/motion/projects/{pid}", headers=AUTH)).status_code == 204


async def test_assets_upload_and_serve(client, model_id):
    pid = (await client.post("/motion/projects", json={"model_id": model_id}, headers=AUTH)).json()["id"]
    up = await client.post(f"/motion/projects/{pid}/assets", files={"file": ("logo.png", b"\x89PNG fake", "image/png")}, headers=AUTH)
    assert up.status_code == 201
    asset = up.json()
    assert asset["kind"] == "image"
    got = await client.get(f"/motion/assets/{asset['id']}/file", params={"token": AUTH_TOKEN})
    assert got.content == b"\x89PNG fake"
    assert (await client.get(f"/motion/assets/{asset['id']}/file", params={"token": "nope"})).status_code == 401
    patched = await client.patch(f"/motion/assets/{asset['id']}", json={"width": 640, "meta": {"words": []}}, headers=AUTH)
    assert patched.json()["width"] == 640


async def test_render_written_in_chunks_and_checked(client, model_id):
    pid = (await client.post("/motion/projects", json={"model_id": model_id}, headers=AUTH)).json()["id"]
    render = (await client.post(f"/motion/projects/{pid}/renders", json={"settings": {"format": "mp4"}}, headers=AUTH)).json()
    data = _tiny_mp4(150, 30, 1080, 1920)
    # out of order, the way a muxer patches a header at the end
    await client.put(f"/motion/renders/{render['id']}/chunk", params={"position": 100}, content=data[100:], headers=AUTH)
    await client.put(f"/motion/renders/{render['id']}/chunk", params={"position": 0}, content=data[:100], headers=AUTH)
    done = (await client.post(f"/motion/renders/{render['id']}/finish", json={"expect": {"width": 1080, "height": 1920, "fps": 30, "duration": 5}, "encoder": "test"}, headers=AUTH)).json()
    assert done["status"] == "done", done
    assert done["report"]["video"]["frames"] == 150
    assert Path(done["path"]).read_bytes() == data

    second = (await client.post(f"/motion/projects/{pid}/renders", json={"settings": {}}, headers=AUTH)).json()
    await client.put(f"/motion/renders/{second['id']}/chunk", params={"position": 0}, content=data, headers=AUTH)
    wrong = (await client.post(f"/motion/renders/{second['id']}/finish", json={"expect": {"fps": 60, "duration": 5}}, headers=AUTH)).json()
    assert wrong["status"] == "failed"
    assert "fps" in wrong["error"]


async def test_kit_saved_for_the_app_and_refused_when_unreadable(client):
    kit = brand.template("light")
    saved = await client.put("/motion/kit", json={"kit": kit}, headers=AUTH)
    assert saved.status_code == 200
    assert saved.json()["kit"]["colors"]["surface"] == kit["colors"]["surface"]
    kit["colors"]["onSurface"] = kit["colors"]["surface"]
    assert (await client.put("/motion/kit", json={"kit": kit}, headers=AUTH)).status_code == 400
    await client.put("/motion/kit", json={"kit": None}, headers=AUTH)


async def test_saving_settings_keeps_the_kit(client):
    """The settings page holds a copy of everything; saving a toggle mustn't put an old kit back."""
    kit = brand.template("neon")
    await client.put("/motion/kit", json={"kit": kit}, headers=AUTH)
    settings = (await client.get("/settings", headers=AUTH)).json()
    settings["brand_kit"] = None
    settings["tts_provider"] = "openai"
    assert (await client.put("/settings", json=settings, headers=AUTH)).status_code == 200
    got = (await client.get("/motion/kit", headers=AUTH)).json()
    assert got["own"] and got["kit"]["colors"]["primary"] == kit["colors"]["primary"]
    assert (await client.get("/settings", headers=AUTH)).json()["tts_provider"] == "openai"
    settings["tts_provider"] = "none"
    await client.put("/settings", json=settings, headers=AUTH)
    await client.put("/motion/kit", json={"kit": None}, headers=AUTH)


async def test_a_workspace_kit_overrides_the_app_and_falls_back(client):
    from rafiq_agent.storage.models import Workspace

    async with SessionLocal() as session:
        ws = Workspace(name="brand test")
        session.add(ws)
        await session.commit()
        wid = ws.id
    inherited = (await client.get("/motion/kit", params={"workspace_id": wid}, headers=AUTH)).json()
    assert inherited["own"] is False
    light = brand.template("light")
    own = (await client.put("/motion/kit", json={"kit": light, "workspace_id": wid}, headers=AUTH)).json()
    assert own["own"] and own["kit"]["colors"]["surface"] == light["colors"]["surface"]
    assert (await client.get("/motion/kit", headers=AUTH)).json()["kit"]["colors"]["surface"] != light["colors"]["surface"]
    back = (await client.put("/motion/kit", json={"kit": None, "workspace_id": wid}, headers=AUTH)).json()
    assert back["own"] is False
    assert (await client.put("/motion/kit", json={"kit": light, "workspace_id": "missing"}, headers=AUTH)).status_code == 404


async def test_engine_channel_round_trip():
    queue = bridge.connect()
    try:
        task = asyncio.create_task(bridge.call("lint", {"scene": {}}, timeout=5))
        request = await asyncio.wait_for(queue.get(), 2)
        assert request["kind"] == "lint"
        assert bridge.resolve(request["id"], True, {"issues": []})
        assert await task == {"issues": []}
    finally:
        bridge.disconnect(queue)
    with pytest.raises(bridge.EngineUnavailable):
        await bridge.call("lint", {}, timeout=1)


async def test_frames_go_to_the_vision_helper_for_a_model_that_cannot_see(client, model_id, monkeypatch):
    from rafiq_agent.core import motion as service
    from rafiq_agent.llm import discovery
    from rafiq_agent.tools.motion import MotionRenderFramesTool

    pid = (await client.post("/motion/projects", json={"model_id": model_id}, headers=AUTH)).json()["id"]

    async def frames(scene, kit, times, max_side=960):
        return ["data:image/png;base64,AAAA" for _ in times]

    async def inspect(scene, kit, times):
        return "measured: title box ok"

    monkeypatch.setattr(service, "frames", frames)
    monkeypatch.setattr(service, "inspect", inspect)

    # a model that can see gets the pictures
    monkeypatch.setattr(discovery, "supports_vision", lambda model: True)
    seen = await MotionRenderFramesTool(pid, "gpt-4o").run({"times": [1]})
    assert seen.images and "frames" in seen.output

    # one that can't, with a vision model set: words from it, and the report
    monkeypatch.setattr(discovery, "supports_vision", lambda model: False)

    async def describe(images, times):
        return f"described {len(images)}"

    monkeypatch.setattr(service, "describe_frames", describe)
    blind = await MotionRenderFramesTool(pid, "text-only").run({"times": [1, 2]})
    assert not blind.images
    assert "described 2" in blind.output and "measured: title box ok" in blind.output

    # and without one: the report, and where to set the helper
    async def missing(images, times):
        raise LookupError("no vision model")

    monkeypatch.setattr(service, "describe_frames", missing)
    plain = await MotionRenderFramesTool(pid, "text-only").run({"times": [1]})
    assert "Settings" in plain.output and "measured" in plain.output


def test_a_motion_turn_gets_the_models_own_output_room():
    from types import SimpleNamespace

    from rafiq_agent.core.chat_service import work_max_tokens

    # a reasoning model writing a scene patch mustn't be held to the 1,500-token reply cap
    assert work_max_tokens(SimpleNamespace(provider="deepseek", model_id="deepseek-reasoner")) >= 8192
    assert work_max_tokens(SimpleNamespace(provider="lm_studio", model_id="something-local")) is None


def test_continue_sees_what_the_last_turn_did():
    from rafiq_agent.core.chat_service import _tools_done

    parts = [
        {"kind": "text", "text": "x"},
        {"kind": "tool", "tool": "motion_assets", "args": {"action": "icons", "queries": ["salad"]}, "ok": True, "output": "salad: tabler:salad"},
        {"kind": "tool", "tool": "motion_patch_scene", "args": {"patch": [], "summary": "intro"}, "ok": False, "output": "nothing changed"},
    ]
    done = _tools_done(parts)
    assert "motion_assets" in done and "tabler:salad" in done and "failed" in done
    assert _tools_done([]) == ""


async def test_icons_are_looked_up_together():
    from rafiq_agent.tools.motion_media import MotionAssetsTool

    out = (await MotionAssetsTool("none").run({"action": "icons", "queries": ["salad", "dumbbell", "zzzz-nothing"]})).output
    assert "salad: tabler:salad" in out and "dumbbell:" in out and "zzzz-nothing: no icons match" in out


def test_the_skill_comes_with_the_prompt():
    from rafiq_agent.core import motion as service

    note = service.skill_note()
    assert "motion_patch_scene" in note and not note.startswith("---")


def test_open_colours_gradients_and_new_shapes_validate():
    scene = rms.new_scene("9:16")
    scene["composition"]["background"] = {"type": "linear", "angle": 90, "stops": [{"at": 0, "color": "#101030"}, {"at": 1, "color": "brand.surface"}]}
    scene["layers"] = [
        _text("t", "مرحبا", color="#ffcc00", outline={"color": "#000", "width": 0.5}, shadow={"color": "#000000", "blur": 4, "y": 1}),
        {"id": "ring", "type": "shape", "shape": "arc", "arc": {"from": 0, "to": 270}, "thickness": 3, "fill": {"type": "radial", "stops": [{"at": 0, "color": "#ff0080"}, {"at": 1, "color": "#7928caff"}]}, "glow": {"color": "brand.primary", "size": 6}, "start": 0, "end": 4, "animate": [{"preset": "spin", "at": 0}]},
        {"id": "dash", "type": "shape", "shape": "polygon", "points": 6, "stroke": "brand.accent", "dash": [2, 1], "fill": "transparent", "start": 0, "end": 4, "animate": [{"preset": "bounceIn", "at": 0.2}]},
    ]
    assert rms.validate(scene) == []
    bad = rms.new_scene("9:16")
    bad["layers"] = [_text("x", "a", color="#12")]
    assert rms.validate(bad)


async def test_motion_chats_stay_out_of_the_chat_list(client, model_id):
    project = (await client.post("/motion/projects", json={"model_id": model_id, "title": "hidden"}, headers=AUTH)).json()
    listed = {c["id"] for c in (await client.get("/chats", headers=AUTH)).json()}
    assert project["chat_id"] not in listed
    # its own page still opens it
    assert (await client.get(f"/chats/{project['chat_id']}", headers=AUTH)).status_code == 200


def test_a_layer_can_move_within_its_list():
    scene = rms.new_scene("9:16")
    scene["layers"] = [_text("a", "1"), _text("b", "2"), _text("c", "3")]
    moved = apply_patch(scene, [{"op": "move", "from": "/layers/2", "path": "/layers/0"}])
    assert [layer["id"] for layer in moved["layers"]] == ["c", "a", "b"]
    locked = apply_patch(scene, [{"op": "add", "path": "/layers/0/locked", "value": True}])
    assert rms.validate(locked) == []
