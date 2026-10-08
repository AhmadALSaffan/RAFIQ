"""Icon names the engine can draw, so a model can search them without the app open. The
list is generated from the icon packages the app ships (apps/desktop/scripts/icon-names.mjs):
Tabler, Phosphor, Lucide, Material Design, Remix, Iconoir, Heroicons and simple-icons in one
colour; Fluent Emoji, Logos and Circle Flags in their own colours."""

from functools import lru_cache
from pathlib import Path

NAMES_FILE = Path(__file__).resolve().parent / "icon_names.txt"
# Search order: the sets that look best in motion graphics first.
SET_ORDER = ["tabler", "ph", "lucide", "mdi", "ri", "iconoir", "heroicons", "si", "fluent-emoji-flat", "logos", "circle-flags"]
COLOUR_SETS = {"fluent-emoji-flat", "logos", "circle-flags"}


@lru_cache(maxsize=1)
def names() -> list[str]:
    return [line.strip() for line in NAMES_FILE.read_text(encoding="utf-8").splitlines() if line.strip()]


@lru_cache(maxsize=1)
def _known() -> frozenset[str]:
    return frozenset(names())


def exists(name: str) -> bool:
    return name in _known()


def is_colour(name: str) -> bool:
    return name.split(":", 1)[0] in COLOUR_SETS


def search(query: str, limit: int = 40, prefix: str | None = None) -> list[str]:
    """Exact names first, then names starting with the query, then names containing every
    word — across all sets (in SET_ORDER) or one."""
    words = [w for w in query.lower().replace("_", "-").replace(" ", "-").split("-") if w]
    joined = "-".join(words)
    rank = {p: i for i, p in enumerate(SET_ORDER)}
    scored = []
    for name in names():
        set_name, slug = name.split(":", 1)
        if prefix and set_name != prefix:
            continue
        if words and not all(w in slug for w in words):
            continue
        quality = 3 if not words else 0 if slug == joined else 1 if slug.startswith(joined) else 2
        scored.append((quality, rank.get(set_name, 99), len(slug), name))
    return [n for *_, n in sorted(scored)[:limit]]
