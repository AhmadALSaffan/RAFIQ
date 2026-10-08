"""JSON Patch (RFC 6902): how the model and the timeline change a scene a little at a time.
Applied to a copy, all or nothing: a patch that fails halfway changes nothing."""

import copy
from typing import Any


class PatchError(ValueError):
    pass


def _unescape(token: str) -> str:
    return token.replace("~1", "/").replace("~0", "~")


def _tokens(pointer: str) -> list[str]:
    if pointer == "":
        return []
    if not pointer.startswith("/"):
        raise PatchError(f"path must start with '/': {pointer!r}")
    return [_unescape(t) for t in pointer[1:].split("/")]


def _index(container: list[Any], token: str, for_add: bool) -> int:
    if token == "-" and for_add:
        return len(container)
    if not token.isdigit() or (len(token) > 1 and token.startswith("0")):
        raise PatchError(f"bad array index {token!r}")
    index = int(token)
    limit = len(container) if for_add else len(container) - 1
    if index > limit:
        raise PatchError(f"array index {index} out of range")
    return index


def _parent(doc: Any, pointer: str) -> tuple[Any, str]:
    tokens = _tokens(pointer)
    if not tokens:
        raise PatchError("the whole document can't be the target here")
    node = doc
    for token in tokens[:-1]:
        node = _child(node, token)
    return node, tokens[-1]


def _child(node: Any, token: str) -> Any:
    if isinstance(node, dict):
        if token not in node:
            raise PatchError(f"no member {token!r}")
        return node[token]
    if isinstance(node, list):
        return node[_index(node, token, False)]
    raise PatchError(f"can't go into {type(node).__name__} at {token!r}")


def get(doc: Any, pointer: str) -> Any:
    node = doc
    for token in _tokens(pointer):
        node = _child(node, token)
    return node


def _add(doc: Any, pointer: str, value: Any) -> Any:
    if pointer == "":
        return value
    parent, token = _parent(doc, pointer)
    if isinstance(parent, dict):
        parent[token] = value
    elif isinstance(parent, list):
        parent.insert(_index(parent, token, True), value)
    else:
        raise PatchError(f"can't add into {type(parent).__name__}")
    return doc


def _remove(doc: Any, pointer: str) -> Any:
    parent, token = _parent(doc, pointer)
    if isinstance(parent, dict):
        if token not in parent:
            raise PatchError(f"nothing to remove at {pointer!r}")
        return parent.pop(token)
    if isinstance(parent, list):
        return parent.pop(_index(parent, token, False))
    raise PatchError(f"can't remove from {type(parent).__name__}")


def apply_patch(doc: Any, operations: list[dict[str, Any]]) -> Any:
    if not isinstance(operations, list):
        raise PatchError("a patch is a list of operations")
    out = copy.deepcopy(doc)
    for number, op in enumerate(operations):
        if not isinstance(op, dict) or "op" not in op or "path" not in op:
            raise PatchError(f"operation {number}: needs 'op' and 'path'")
        kind, path = op["op"], op["path"]
        try:
            if kind == "add":
                out = _add(out, path, copy.deepcopy(op["value"]))
            elif kind == "remove":
                _remove(out, path)
            elif kind == "replace":
                if path == "":
                    out = copy.deepcopy(op["value"])
                else:
                    get(out, path)  # must exist
                    parent, token = _parent(out, path)
                    if isinstance(parent, list):
                        parent[_index(parent, token, False)] = copy.deepcopy(op["value"])
                    else:
                        parent[token] = copy.deepcopy(op["value"])
            elif kind == "move":
                source = op["from"]
                if path.startswith(source + "/"):
                    raise PatchError("can't move a value into itself")
                value = _remove(out, source)
                out = _add(out, path, value)
            elif kind == "copy":
                out = _add(out, path, copy.deepcopy(get(out, op["from"])))
            elif kind == "test":
                if get(out, path) != op["value"]:
                    raise PatchError(f"test failed at {path!r}")
            else:
                raise PatchError(f"unknown op {kind!r}")
        except KeyError as exc:
            raise PatchError(f"operation {number} ({kind}): missing {exc.args[0]!r}") from exc
        except PatchError as exc:
            raise PatchError(f"operation {number} ({kind} {path}): {exc}") from exc
    return out
