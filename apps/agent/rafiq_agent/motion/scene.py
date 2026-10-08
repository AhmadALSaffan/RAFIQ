"""The scene document: its schema, a fresh scene for each aspect ratio, and validation.

The schema lives with the motion skill (skills/bundled/motion/schema.json) so the model
reads the very file the agent validates against."""

import copy
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "skills" / "bundled" / "motion" / "schema.json"

# name → (width, height, safe area)
ASPECTS: dict[str, tuple[int, int, str]] = {
    "9:16": (1080, 1920, "reels"),
    "1:1": (1080, 1080, "square"),
    "16:9": (1920, 1080, "youtube"),
    "4:5": (1080, 1350, "reels"),
}


@lru_cache(maxsize=1)
def schema() -> dict[str, Any]:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _validator() -> Draft202012Validator:
    return Draft202012Validator(schema())


def new_scene(aspect: str = "9:16", fps: int = 30, duration: float = 10.0, title: str = "") -> dict[str, Any]:
    width, height, safe = ASPECTS.get(aspect, ASPECTS["9:16"])
    if aspect == "custom":
        width, height, safe = 1080, 1920, "none"
    return {
        "version": 1,
        "title": title[:120],
        "composition": {
            "width": width,
            "height": height,
            "fps": fps,
            "duration": duration,
            "background": "brand.surface",
            "safeArea": safe,
            "direction": "rtl",
        },
        "brand": "workspace",
        "assets": {},
        "layers": [],
        "audio": [],
    }


def _path(error: Any) -> str:
    return "/" + "/".join(str(p) for p in error.absolute_path)


def validate(scene: Any) -> list[dict[str, str]]:
    """Schema errors as {path, message}, plus the rules a schema can't say (unique ids,
    end after start, references that point somewhere). Empty means valid."""
    errors = [{"path": _path(e), "message": e.message} for e in _validator().iter_errors(scene)]
    if errors or not isinstance(scene, dict):
        return errors[:30]

    seen: set[str] = set()
    ids: set[str] = set()

    def walk(layers: list[dict[str, Any]], base: str) -> None:
        for index, layer in enumerate(layers):
            where = f"{base}/{index}"
            lid = layer["id"]
            if lid in seen:
                errors.append({"path": f"{where}/id", "message": f"duplicate layer id {lid!r}"})
            seen.add(lid)
            ids.add(lid)
            if layer["end"] <= layer["start"]:
                errors.append({"path": f"{where}/end", "message": "end must be after start"})
            if layer.get("children"):
                walk(layer["children"], f"{where}/children")

    walk(scene.get("layers", []), "/layers")
    assets = scene.get("assets", {})

    def refs(layers: list[dict[str, Any]], base: str) -> None:
        for index, layer in enumerate(layers):
            where = f"{base}/{index}"
            for rel in ("below", "above", "beside"):
                target = (layer.get("layout") or {}).get(rel)
                if target and target not in ids:
                    errors.append({"path": f"{where}/layout/{rel}", "message": f"no layer with id {target!r}"})
                if target == layer["id"]:
                    errors.append({"path": f"{where}/layout/{rel}", "message": "a layer can't be placed relative to itself"})
            for key in ("asset", "source"):
                if layer.get(key) and layer[key] not in assets:
                    errors.append({"path": f"{where}/{key}", "message": f"no asset {layer[key]!r}"})
            needs = {"text": "text", "shape": "shape", "image": "asset", "video": "asset", "lottie": "asset", "chart": "chart", "icon": "icon"}
            field = needs.get(layer["type"])
            if field and layer.get(field) in (None, ""):
                errors.append({"path": where, "message": f"a {layer['type']} layer needs {field!r}"})
            if layer.get("children"):
                refs(layer["children"], f"{where}/children")

    refs(scene.get("layers", []), "/layers")
    track_ids = {a["id"] for a in scene.get("audio", [])}
    for index, track in enumerate(scene.get("audio", [])):
        where = f"/audio/{index}"
        if track["source"] == "asset" and track.get("asset") not in assets:
            errors.append({"path": f"{where}/asset", "message": f"no asset {track.get('asset')!r}"})
        if track["source"] == "sfx" and not track.get("kind"):
            errors.append({"path": where, "message": "an sfx track needs a kind"})
        if track["source"] == "tts" and not track.get("text"):
            errors.append({"path": where, "message": "a tts track needs text"})
        if track.get("duck") and track["duck"] not in track_ids:
            errors.append({"path": f"{where}/duck", "message": f"no audio track {track['duck']!r}"})
    return errors[:30]


def layer_ids(scene: dict[str, Any]) -> list[str]:
    out: list[str] = []

    def walk(layers: list[dict[str, Any]]) -> None:
        for layer in layers:
            out.append(layer["id"])
            walk(layer.get("children") or [])

    walk(scene.get("layers", []))
    return out


def summarize(scene: dict[str, Any]) -> str:
    """A few lines a model can read instead of the whole document."""
    comp = scene.get("composition", {})
    lines = [
        f"{comp.get('width')}×{comp.get('height')} @ {comp.get('fps')}fps · {comp.get('duration')}s · "
        f"safe area {comp.get('safeArea', 'none')} · {comp.get('direction', 'rtl')}",
    ]

    def walk(layers: list[dict[str, Any]], depth: int) -> None:
        for layer in layers:
            label = layer.get("text") or layer.get("icon") or layer.get("asset") or layer.get("shape") or layer.get("chart") or ""
            label = str(label).replace("\n", " ")[:50]
            lines.append(f"{'  ' * depth}- {layer['id']} ({layer['type']}) {layer['start']:g}→{layer['end']:g}s {label}")
            walk(layer.get("children") or [], depth + 1)

    walk(scene.get("layers", []), 0)
    for track in scene.get("audio", []):
        what = track.get("pattern") or track.get("kind") or track.get("asset") or (track.get("text") or "")[:40]
        lines.append(f"- audio {track['id']} ({track['source']}) {what} at {track.get('at', 0):g}s")
    return "\n".join(lines)


def deep_copy(scene: dict[str, Any]) -> dict[str, Any]:
    return copy.deepcopy(scene)
