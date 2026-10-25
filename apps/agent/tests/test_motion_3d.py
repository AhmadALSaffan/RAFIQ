"""3D layers in the scene format, everything kept inside the video's time, sound only on
request, and which models get the step-by-step guides."""

import json

from rafiq_agent.core import motion as service
from rafiq_agent.motion import scene as rms
from rafiq_agent.motion.tiers import guided


def _scene(*layers: dict, duration: float = 10) -> dict:
    scene = rms.new_scene("16:9", duration=duration)
    scene["layers"] = list(layers)
    return scene


def test_a_3d_layer_is_valid_and_its_mistakes_are_named():
    layer = {
        "id": "hero",
        "type": "scene3d",
        "start": 0,
        "end": 6,
        "scene3d": {
            "recipe": "logoReveal",
            "params": {"text": "رفيق", "material": "gold"},
            "camera": {"position": [0, 0.4, 8], "move": {"type": "orbit", "amount": 30}},
            "objects": [
                {"id": "ring", "kind": "torus", "radius": 2.4, "material": "glow", "animate": [{"preset": "turntable", "at": 0, "amount": 40, "axis": "z"}]},
                {"kind": "particles", "count": 4000, "shape": "galaxy", "keyframes": {"morph": [{"t": 1, "v": 0}, {"t": 3, "v": 1}]}},
                {"kind": "text3d", "text": "3D", "keyframes": {"rotation.y": [{"t": 0, "v": -20}, {"t": 6, "v": 20, "ease": "inOut"}]}},
            ],
            "post": {"bloom": 0.6},
        },
    }
    assert rms.validate(_scene(layer)) == []

    bad = json.loads(json.dumps(layer))
    bad["scene3d"]["recipe"] = "fireworks"
    assert any("/scene3d" in e["path"] for e in rms.validate(_scene(bad)))

    missing = json.loads(json.dumps(layer))
    missing["scene3d"]["objects"].append({"kind": "model", "asset": "phone"})
    assert any("no asset 'phone'" in e["message"] for e in rms.validate(_scene(missing)))

    empty = {"id": "e", "type": "scene3d", "start": 0, "end": 2}
    assert any("needs 'scene3d'" in e["message"] for e in rms.validate(_scene(empty)))
    assert "logoReveal" in rms.summarize(_scene(layer))


def test_nothing_sits_past_a_layer_or_the_video():
    layer = {
        "id": "orbit",
        "type": "shape",
        "shape": "ring",
        "start": 8,
        "end": 14,
        "animate": [{"preset": "fadeIn", "at": 7}, {"preset": "pulse", "at": 12}],
        "keyframes": {"x": [{"t": 8, "v": 0}, {"t": 12, "v": 20}], "rotation": [{"t": 9, "v": 0}]},
    }
    scene = _scene(layer)
    notes = rms.keep_in_time(scene)
    fixed = scene["layers"][0]
    assert fixed["end"] == 10
    # the key at 12 becomes one at the new end with the value the motion has there
    assert fixed["keyframes"]["x"] == [{"t": 8, "v": 0}, {"t": 10, "v": 10.0}]
    assert [a["preset"] for a in fixed["animate"]] == ["fadeIn"]
    assert fixed["animate"][0]["at"] == 8
    assert notes and all("orbit" in n for n in notes)
    assert rms.validate(scene) == []


def test_3d_keys_and_the_camera_stay_inside_their_layer():
    layer = {
        "id": "hero",
        "type": "scene3d",
        "start": 0,
        "end": 5,
        "scene3d": {
            "camera": {"keyframes": {"position": [{"t": 0, "v": [0, 0, 10]}, {"t": 10, "v": [0, 0, 0]}]}},
            "objects": [{"kind": "box", "animate": [{"preset": "pop", "at": 6}], "keyframes": {"scale": [{"t": 7, "v": 2}]}}],
        },
    }
    scene = _scene(layer)
    rms.keep_in_time(scene)
    spec = scene["layers"][0]["scene3d"]
    assert spec["camera"]["keyframes"]["position"][-1] == {"t": 5, "v": [0.0, 0.0, 5.0]}
    assert spec["objects"][0]["animate"] == []
    assert spec["objects"][0]["keyframes"]["scale"] == [{"t": 5, "v": 2}]


def test_the_examples_are_silent_unless_asked_and_the_guides_say_so():
    folder = rms.SCHEMA_PATH.parent
    for name in ("pro-reel.json", "intro.json", "chart.json"):
        assert json.loads((folder / "examples" / name).read_text(encoding="utf-8"))["audio"] == []
    director = (folder / "DIRECTOR.md").read_text(encoding="utf-8")
    assert "Music always" not in director and "No sound unless the user asked" in director
    assert "audio: []" in service.MOTION_SYSTEM_PROMPT and "audio: []" in service.FREE_SYSTEM_PROMPT


def test_strong_models_create_freely_and_weaker_ones_get_the_guides():
    for provider, model in [("anthropic", "claude-opus-5-5"), ("anthropic", "claude-sonnet-5-5"), ("openai", "gpt-5.2"), ("gemini", "gemini-3-pro"), ("xai", "grok-4"), ("chatgpt", "gpt-6.1-sol"), ("github_copilot", "claude-sonnet-5-5")]:
        assert not guided(provider, model), model
    for provider, model in [("anthropic", "claude-haiku-5-5"), ("deepseek", "deepseek-chat"), ("openrouter", "deepseek/deepseek-r1"), ("openrouter", "qwen/qwen3-coder"), ("dashscope", "qwen-max"), ("github_copilot", "auto"), ("openai", "gpt-5-mini"), ("ollama", "llama3.3")]:
        assert guided(provider, model), model

    free = service.skill_note(False)
    full = service.skill_note(True)
    assert "scene3d" in free and "## 8. Recipes" not in free and "Step 1" not in free
    assert "## 8. Recipes" in full and "3D, step by step" in full and "Music always" not in full
    assert service.system_prompt(False) is service.FREE_SYSTEM_PROMPT


def test_a_3d_surface_names_a_picture_that_exists():
    layer = {
        "id": "planet",
        "type": "scene3d",
        "start": 0,
        "end": 5,
        "scene3d": {"objects": [
            {"id": "earth", "kind": "sphere", "texture": "earth", "material": {"emissiveMap": "night", "bumpMap": "bump", "bumpScale": 2}},
            {"id": "rings", "kind": "ring", "radius": 2.3, "width": 1.8, "texture": "rings"},
            {"id": "globe", "kind": "globe", "style": "texture", "texture": "earth"},
        ]},
    }
    scene = _scene(layer)
    scene["assets"] = {k: {"type": "image", "src": f"asset://{k}1"} for k in ("earth", "night", "bump", "rings")}
    assert rms.validate(scene) == []
    del scene["assets"]["night"]
    errors = rms.validate(scene)
    assert any(e["path"].endswith("material/emissiveMap") and "motion_fetch_image" in e["message"] for e in errors)


def test_a_composed_score_is_valid_and_its_mistakes_are_named():
    score = {
        "id": "score", "source": "compose", "tempo": 92, "reverb": 0.6, "swing": 0.15,
        "parts": [
            {"instrument": "keys", "notes": [{"t": 0, "n": "Dm9", "d": 4}, {"t": 4, "n": ["G3", "Bb3", "D4"], "d": 4}], "loop": 8, "cutoff": 3000},
            {"drum": "kick", "steps": "x.....x...x.....", "from": 4},
            {"drum": "hat", "hits": [0.5, 1.5], "tune": 3},
        ],
    }
    scene = _scene()
    scene["audio"] = [score, {"id": "hit", "source": "sfx", "kind": "impact", "tune": -5, "length": 1.5}]
    assert rms.validate(scene) == []
    scene["audio"][0]["parts"].append({"instrument": "piano"})
    scene["audio"][0]["parts"].append({"drum": "kick", "instrument": "pad", "notes": [{"t": 0, "n": "C4"}]})
    messages = [e["message"] for e in rms.validate(scene)]
    assert "an instrument part needs notes" in messages
    assert "a part is an instrument or a drum (one of the two)" in messages


def test_the_new_shapes_sounds_and_styles_are_valid():
    heart = {"id": "h", "type": "scene3d", "start": 0, "end": 6, "scene3d": {"objects": [
        {"id": "heart", "kind": "extrude", "outline": "heart", "material": "glass", "color": "#ff3b5c"},
        {"id": "gear", "kind": "extrude", "outline": "gear", "sides": 12},
        {"id": "vase", "kind": "lathe", "profile": [[0, -0.6], [0.4, -0.6], [0.5, 0], [0.25, 0.6]]},
        {"id": "gem", "kind": "dodecahedron"},
    ]}}
    badge = {"id": "b", "type": "shape", "shape": "burst", "points": 14, "blend": "add", "start": 0, "end": 4}
    scene = _scene(heart, badge)
    scene["audio"] = [
        {"id": "band", "source": "compose", "style": "arabic", "key": "D"},
        {"id": "lead", "source": "compose", "tempo": 100, "parts": [
            {"instrument": "oud", "notes": [{"t": 0, "n": "Dm", "d": 2}], "arp": "updown", "rate": 0.25,
             "strum": 0.03, "delay": {"time": 0.75, "feedback": 0.4, "mix": 0.3}, "drive": 0.3, "sweep": {"from": 300, "to": 5000}},
            {"drum": "doum", "steps": "x.......x......."},
        ]},
        {"id": "magic", "source": "sfx", "kind": "shimmer", "at": 1},
    ]
    assert rms.validate(scene) == []
    # an extrusion still needs something to extrude
    scene["layers"][0]["scene3d"]["objects"].append({"id": "x", "kind": "extrude"})
    assert any("needs 'outline'" in e["message"] for e in rms.validate(scene))

