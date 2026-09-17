"""Builds the marketing site into ../site from the content modules.

    python site-src/build.py

One template for the shell (head, nav, footer), one content module per language. Pages
are written as folders with an index.html so the URLs are clean on Netlify:
/, /features/, /security/, /download/, /faq/ and the same under /en/.
"""

import html
import importlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SITE = ROOT.parent / "site"
REPO = "https://github.com/AhmadALSaffan/RAFIQ"
# The site's public origin once it has one (e.g. "https://rafiq.netlify.app"). Empty = skip
# the canonical link and keep the social image relative.
SITE_URL = ""

# Every provider Rafiq connects to, with its mark. Order matters: it's the order shown.
PROVIDERS = [
    ("anthropic", "Anthropic"), ("openai", "OpenAI"), ("googlegemini", "Google Gemini"),
    ("deepseek", "DeepSeek"), ("mistralai", "Mistral"), ("x", "xAI (Grok)"),
    ("githubcopilot", "GitHub Copilot"), ("openrouter", "OpenRouter"), ("azure", "Azure OpenAI"),
    ("bedrock", "AWS Bedrock"), ("googlecloud", "Google Vertex AI"), ("groq", "Groq"),
    ("cerebras", "Cerebras"), ("fireworks", "Fireworks"), ("together", "Together"),
    ("alibabacloud", "Qwen (DashScope)"), ("kimi", "Kimi (Moonshot)"), ("zai", "GLM (Z.ai)"),
    ("ollama", "Ollama"), ("lmstudio", "LM Studio"), ("vllm", "vLLM / OpenAI-compatible"),
]

DOWNLOAD_ICON = (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
    'stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>'
)


def logos(cls: str = "logos") -> str:
    items = "".join(
        f'<img src="/assets/logos/{slug}.svg" alt="{html.escape(name)}" title="{html.escape(name)}" loading="lazy" />'
        for slug, name in PROVIDERS
    )
    return f'<div class="{cls}">{items}</div>'


def shell(lang: dict, page: dict, body: str) -> str:
    base = lang["base"]
    other = lang["other"]
    path = page["path"]
    alt_href = f"{other['base']}{path}"
    nav = "".join(
        f'<a href="{base}{p["path"]}"{" aria-current=\"page\"" if p["path"] == path else ""}>{html.escape(p["nav"])}</a>'
        for p in lang["pages"]
    )
    canonical = f'  <link rel="canonical" href="{SITE_URL}{base}{path}" />' if SITE_URL else ""
    preload = "".join(
        f'<link rel="preload" href="/assets/fonts/{f}" as="font" type="font/woff2" crossorigin />'
        for f in lang["preload"]
    )
    return f"""<!doctype html>
<html lang="{lang['code']}" dir="{lang['dir']}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{html.escape(page['title'])}</title>
  <meta name="description" content="{html.escape(page['description'])}" />
{canonical}  <link rel="alternate" hreflang="{other['code']}" href="{alt_href}" />
  <link rel="alternate" hreflang="{lang['code']}" href="{base}{path}" />
  <link rel="icon" href="/favicon.ico" sizes="32x32" />
  <link rel="icon" type="image/png" sizes="192x192" href="/assets/icon-192.png" />
  <link rel="apple-touch-icon" href="/assets/icon-192.png" />
  <meta property="og:title" content="{html.escape(page['title'])}" />
  <meta property="og:description" content="{html.escape(page['description'])}" />
  <meta property="og:image" content="{SITE_URL}/assets/screens/chat-plan.webp" />
  <meta property="og:type" content="website" />
  <meta name="theme-color" content="#100f0d" media="(prefers-color-scheme: dark)" />
  <meta name="theme-color" content="#f7f4ee" media="(prefers-color-scheme: light)" />
  {preload}
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>

<header class="nav">
  <div class="wrap">
    <a class="brand" href="{base}" aria-label="{html.escape(lang['brand'])}">
      <img src="/assets/icon-64.png" alt="" width="30" height="30" />
      {html.escape(lang['brand'])}
    </a>
    <nav class="nav-links" aria-label="{html.escape(lang['nav_label'])}">
      {nav}
      <a href="{REPO}" target="_blank" rel="noopener">GitHub</a>
    </nav>
    <div class="nav-actions">
      <a class="lang" href="{alt_href}" hreflang="{other['code']}" lang="{other['code']}">{other['name']}</a>
      <a class="btn btn-primary" href="{REPO}/releases/latest" data-download>{html.escape(lang['download'])}</a>
      <button class="menu-btn" type="button" aria-label="{html.escape(lang['menu'])}" aria-expanded="false" aria-controls="mobile-nav">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      </button>
    </div>
  </div>
  <nav class="mobile-nav" id="mobile-nav" hidden aria-label="{html.escape(lang['nav_label'])}">
    {nav}
    <a href="{REPO}" target="_blank" rel="noopener">GitHub</a>
  </nav>
</header>

<main id="top">
{body}
</main>

<footer>
  <div class="wrap">
    <span>{lang['footer_made']}</span>
    <nav aria-label="{html.escape(lang['links_label'])}">
      <a href="{REPO}" target="_blank" rel="noopener">GitHub</a>
      <a href="{REPO}/releases" target="_blank" rel="noopener">{html.escape(lang['releases'])}</a>
      <a href="{REPO}/issues" target="_blank" rel="noopener">{html.escape(lang['report'])}</a>
      <a href="{alt_href}" hreflang="{other['code']}" lang="{other['code']}">{other['name']}</a>
    </nav>
  </div>
</footer>

<script src="/script.js" defer></script>
</body>
</html>
"""


def build() -> None:
    for name in ("ar", "en"):
        module = importlib.import_module(f"content_{name}")
        lang = module.LANG
        lang["other"] = importlib.import_module(f"content_{'en' if name == 'ar' else 'ar'}").LANG
        for page in lang["pages"]:
            body = page["body"](logos=logos, icon=DOWNLOAD_ICON, repo=REPO, base=lang["base"])
            target = SITE / lang["base"].strip("/") / page["path"].strip("/") / "index.html"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(shell(lang, page, body), encoding="utf-8")
            print("wrote", target.relative_to(SITE))


if __name__ == "__main__":
    import sys

    sys.path.insert(0, str(ROOT))
    for stale in (SITE / "index.html", SITE / "en" / "index.html"):
        if stale.exists() and not (SITE / "features").exists():
            stale.unlink()
    build()
