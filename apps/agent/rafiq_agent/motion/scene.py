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
            needs = {"text": "text", "shape": "shape", "image": "asset", "video": "asset", "lottie": "asset", "chart": "chart", "icon": "icon", "scene3d": "scene3d"}
            field = needs.get(layer["type"])
            if field and layer.get(field) in (None, ""):
                errors.append({"path": where, "message": f"a {layer['type']} layer needs {field!r}"})
            if layer.get("scene3d"):
                errors.extend(_scene3d_errors(layer["scene3d"], assets, f"{where}/scene3d"))
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
        if track["source"] == "compose":
            parts = track.get("parts") or []
            if not parts and not track.get("style"):
                errors.append({"path": where, "message": "a compose track needs a style or parts"})
            for pi, part in enumerate(parts):
                if bool(part.get("instrument")) == bool(part.get("drum")):
                    errors.append({"path": f"{where}/parts/{pi}", "message": "a part is an instrument or a drum (one of the two)"})
                elif part.get("instrument") and not part.get("notes"):
                    errors.append({"path": f"{where}/parts/{pi}", "message": "an instrument part needs notes"})
                elif part.get("drum") and not (part.get("hits") or part.get("steps") or part.get("notes")):
                    errors.append({"path": f"{where}/parts/{pi}", "message": "a drum part needs hits or steps"})
        if track.get("duck") and track["duck"] not in track_ids:
            errors.append({"path": f"{where}/duck", "message": f"no audio track {track['duck']!r}"})
    return errors[:30]


def _scene3d_errors(spec: dict[str, Any], assets: dict[str, Any], where: str) -> list[dict[str, str]]:
    """What a schema can't say about a 3D scene: the assets it names exist, and the points
    and blocks stay within what a frame can draw."""
    errors: list[dict[str, str]] = []
    params = spec.get("params") or {}
    named = [params.get("asset")] + list(params.get("images") or [])
    for key in named:
        if isinstance(key, str) and key and key not in assets:
            errors.append({"path": f"{where}/params", "message": f"no asset {key!r}"})
    particles = 0

    def walk(objects: list[dict[str, Any]], base: str) -> None:
        nonlocal particles
        for index, obj in enumerate(objects):
            at = f"{base}/{index}"
            kind = obj.get("kind")
            if obj.get("asset") and obj["asset"] not in assets:
                errors.append({"path": f"{at}/asset", "message": f"no asset {obj['asset']!r}"})
            material = obj.get("material") if isinstance(obj.get("material"), dict) else {}
            for field, key in [("texture", obj.get("texture"))] + [(f"material/{m}", material.get(m)) for m in ("map", "bumpMap", "normalMap", "roughnessMap", "emissiveMap")]:
                if key and key not in assets:
                    errors.append({"path": f"{at}/{field}", "message": f"no asset {key!r} — add the picture first (motion_fetch_image with its link, or motion_stock)"})
            if kind in ("model", "image") and not obj.get("asset"):
                errors.append({"path": at, "message": f"a {kind} object needs 'asset'"})
            if kind == "text3d" and not str(obj.get("text") or "").strip():
                errors.append({"path": at, "message": "a text3d object needs 'text'"})
            if kind == "extrude" and not (obj.get("svg") or obj.get("icon") or obj.get("outline")):
                errors.append({"path": at, "message": "an extrude object needs 'outline' (heart, star, bolt…), 'svg' or 'icon'"})
            if kind == "particles":
                particles += int(obj.get("count") or 3000)
            walk(obj.get("children") or [], f"{at}/children")

    walk(spec.get("objects") or [], f"{where}/objects")
    if particles > 100_000:
        errors.append({"path": f"{where}/objects", "message": f"{particles} particles in one scene — keep it under 100000"})
    return errors


def _at_time(a: dict[str, Any], b: dict[str, Any], t: float) -> Any:
    """The value between two keys at `t`, straight-line (a colour keeps the nearer key's)."""
    va, vb = a.get("v"), b.get("v")
    if isinstance(va, (int, float)) and isinstance(vb, (int, float)) and b["t"] != a["t"]:
        return round(va + (vb - va) * (t - a["t"]) / (b["t"] - a["t"]), 4)
    if isinstance(va, list) and isinstance(vb, list) and len(va) == len(vb) and b["t"] != a["t"]:
        u = (t - a["t"]) / (b["t"] - a["t"])
        return [round(x + (y - x) * u, 4) if isinstance(x, (int, float)) and isinstance(y, (int, float)) else x for x, y in zip(va, vb, strict=True)]
    return va if abs(t - a["t"]) <= abs(t - b["t"]) else vb


def _fit_keys(keys: list[dict[str, Any]], start: float, end: float) -> list[dict[str, Any]]:
    """Keys outside [start, end] become one key on the edge with the value the motion has
    there, so what shows doesn't change and nothing sits past the layer."""
    keys = sorted((k for k in keys if isinstance(k, dict) and isinstance(k.get("t"), (int, float))), key=lambda k: k["t"])
    inside = [k for k in keys if start <= k["t"] <= end]
    before = [k for k in keys if k["t"] < start]
    after = [k for k in keys if k["t"] > end]
    out = list(inside)
    if before:
        nxt = inside[0] if inside else (after[0] if after else None)
        v = _at_time(before[-1], nxt, start) if nxt else before[-1].get("v")
        out.insert(0, {**before[-1], "t": start, "v": v})
    if after:
        prev = inside[-1] if inside else (before[-1] if before else None)
        v = _at_time(prev, after[0], end) if prev else after[0].get("v")
        out.append({**after[0], "t": end, "v": v})
    # two keys on the same edge: the edge one wins
    dedup: dict[float, dict[str, Any]] = {}
    for k in out:
        dedup[k["t"]] = k
    return sorted(dedup.values(), key=lambda k: k["t"])


def _keep_3d_in_time(spec: dict[str, Any], start: float, end: float, lid: str, notes: list[str]) -> None:
    """The same for a 3D scene: its objects' and camera's keys inside the layer."""

    def fit(keys: Any, label: str) -> Any:
        if isinstance(keys, list) and any(isinstance(k, dict) and not start <= k.get("t", start) <= end for k in keys):
            notes.append(f"{lid}: {label} keys moved inside {start:g}–{end:g}s")
            return _fit_keys(keys, start, end)
        return keys

    def walk(objects: list[Any]) -> None:
        for obj in objects:
            if not isinstance(obj, dict):
                continue
            name = obj.get("id") or obj.get("kind")
            for prop, keys in list((obj.get("keyframes") or {}).items()):
                obj["keyframes"][prop] = fit(keys, f"{name} {prop}")
            if isinstance(obj.get("animate"), list):
                kept = [a for a in obj["animate"] if not (isinstance(a, dict) and isinstance(a.get("at"), (int, float)) and a["at"] >= end)]
                if len(kept) < len(obj["animate"]):
                    notes.append(f"{lid}: {name} animations after {end:g}s dropped")
                for a in kept:
                    if isinstance(a, dict) and isinstance(a.get("at"), (int, float)) and a["at"] < start:
                        a["at"] = start
                obj["animate"] = kept
            walk(obj.get("children") or [])

    walk(spec.get("objects") or [])
    camera = spec.get("camera")
    if isinstance(camera, dict) and isinstance(camera.get("keyframes"), dict):
        for prop, keys in list(camera["keyframes"].items()):
            camera["keyframes"][prop] = fit(keys, f"camera {prop}")


def keep_in_time(scene: dict[str, Any]) -> list[str]:
    """Pulls everything back inside the video: a layer that ends after it ends with it, and
    keys and animations outside their layer move onto its edges (or go, when they'd start
    after it). Changes the scene in place; returns what moved, for the model to read."""
    notes: list[str] = []
    duration = (scene.get("composition") or {}).get("duration")
    if not isinstance(duration, (int, float)) or duration <= 0:
        return notes

    def walk(layers: list[dict[str, Any]], lo: float, hi: float) -> None:
        for layer in layers:
            if not isinstance(layer, dict) or not isinstance(layer.get("start"), (int, float)) or not isinstance(layer.get("end"), (int, float)):
                continue
            lid = layer.get("id", "?")
            if layer["end"] > hi:
                notes.append(f"{lid}: end {layer['end']:g}s → {hi:g}s (the video ends there)")
                layer["end"] = hi
            if layer["start"] >= layer["end"]:
                layer["start"] = max(lo, round(layer["end"] - 0.5, 2))
                notes.append(f"{lid}: start → {layer['start']:g}s")
            start, end = layer["start"], layer["end"]
            for prop, keys in list((layer.get("keyframes") or {}).items()):
                if isinstance(keys, list) and any(isinstance(k, dict) and not start <= k.get("t", start) <= end for k in keys):
                    layer["keyframes"][prop] = _fit_keys(keys, start, end)
                    notes.append(f"{lid}: {prop} keys moved inside {start:g}–{end:g}s")
            animations = layer.get("animate")
            if isinstance(animations, list):
                kept = []
                for a in animations:
                    at = a.get("at") if isinstance(a, dict) else None
                    if not isinstance(at, (int, float)):
                        kept.append(a)
                    elif at >= end:
                        notes.append(f"{lid}: {a.get('preset')} at {at:g}s dropped (after the layer ends at {end:g}s)")
                    else:
                        if at < start:
                            notes.append(f"{lid}: {a.get('preset')} at {at:g}s → {start:g}s")
                            a["at"] = start
                        kept.append(a)
                layer["animate"] = kept
            if isinstance(layer.get("scene3d"), dict):
                _keep_3d_in_time(layer["scene3d"], start, end, lid, notes)
            if layer.get("children"):
                walk(layer["children"], start, end)

    walk(scene.get("layers") or [], 0.0, float(duration))
    for track in scene.get("audio") or []:
        if not isinstance(track, dict):
            continue
        if isinstance(track.get("end"), (int, float)) and track["end"] > duration:
            track["end"] = duration
            notes.append(f"audio {track.get('id')}: end → {duration:g}s")
        if isinstance(track.get("at"), (int, float)) and track["at"] >= duration:
            track["at"] = max(0.0, round(duration - 0.5, 2))
            notes.append(f"audio {track.get('id')}: at → {track['at']:g}s")
    return notes


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
            if layer.get("type") == "scene3d":
                spec = layer.get("scene3d") or {}
                kinds = ", ".join(str(o.get("kind")) for o in (spec.get("objects") or [])[:6])
                label = " · ".join(x for x in (spec.get("recipe"), kinds) if x)
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
