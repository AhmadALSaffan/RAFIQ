"""The agent's user-facing language: Arabic (source), English, Russian.

Mirrors the UI's scheme: keys are the Arabic text, and `locales.py` maps them to English
and Russian. `{0}`, `{1}`… (or `{name}`) are filled at runtime.

The UI sends its language as `Accept-Language` on every request; a middleware stores it in
a context variable for that request, so an error raised anywhere below — an adapter, a
provider client — comes back in the user's language. Work that runs outside a request
(the task queue) uses the language of the most recent request.

Only text a person reads goes through `tr()`. Prompts, tool descriptions and other text
the model reads stay as written — models read any language.
"""

import re
from contextvars import ContextVar

from rafiq_agent.locales import EN, RU

SUPPORTED = ("ar", "en", "ru")
_DICTS: dict[str, dict[str, str]] = {"en": EN, "ru": RU}

_request_locale: ContextVar[str | None] = ContextVar("rafiq_locale", default=None)
_last_seen = "ar"


def parse_accept_language(header: str | None) -> str | None:
    """First supported language in an Accept-Language header, e.g. "ru-RU,ru;q=0.9" → "ru"."""
    for part in (header or "").split(","):
        tag = part.split(";")[0].strip().lower()[:2]
        if tag in SUPPORTED:
            return tag
    return None


def set_request_locale(header: str | None):
    """Called by the middleware for each request. Returns the token to reset with."""
    global _last_seen
    loc = parse_accept_language(header)
    if loc:
        _last_seen = loc
    return _request_locale.set(loc)


def reset_request_locale(token) -> None:
    _request_locale.reset(token)


def current_locale() -> str:
    return _request_locale.get() or _last_seen


_PLACEHOLDER = re.compile(r"\{(\w+)\}")


def tr(text: str, *args: object, **kwargs: object) -> str:
    """Translates Arabic source text into the current language and fills its placeholders."""
    loc = current_locale()
    template = text if loc == "ar" else _DICTS[loc].get(text, text)
    if not args and not kwargs:
        return template

    def fill(match: re.Match[str]) -> str:
        name = match.group(1)
        if name.isdigit() and int(name) < len(args):
            return str(args[int(name)])
        if name in kwargs:
            return str(kwargs[name])
        return match.group(0)

    return _PLACEHOLDER.sub(fill, template)


def all_translations(text: str) -> set[str]:
    """Every language's version of a text — for recognising a stored default (e.g. a title)."""
    return {text, *(d[text] for d in _DICTS.values() if text in d)}
