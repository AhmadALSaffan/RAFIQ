"""Per-project instructions: a `RAFIQ.md` (or `AGENTS.md`) the model reads before it works.

Put one in a project and every chat or task on that folder starts with it — build and test
commands, conventions, things never to touch. Files are gathered from the folder up to the
repository root (or a few levels up), outermost first, so a subfolder's file can refine the
project-wide one.
"""

from pathlib import Path

NAMES = ("RAFIQ.md", "AGENTS.md")
MAX_CHARS = 20_000
MAX_LEVELS = 6


def instruction_files(directory: str | Path | None) -> list[Path]:
    if not directory:
        return []
    folder = Path(directory)
    if not folder.is_dir():
        return []
    found: list[Path] = []
    current = folder.resolve()
    for _ in range(MAX_LEVELS):
        for name in NAMES:
            candidate = current / name
            if candidate.is_file():
                found.append(candidate)
                break  # one file per folder: RAFIQ.md wins over AGENTS.md
        if (current / ".git").exists() or current.parent == current:
            break
        current = current.parent
    return list(reversed(found))


def project_instructions(directory: str | Path | None) -> str | None:
    """The instructions as one block for the system prompt, or None when there are none."""
    blocks: list[str] = []
    budget = MAX_CHARS
    for path in instruction_files(directory):
        try:
            text = path.read_text(encoding="utf-8", errors="replace").strip()
        except OSError:
            continue
        if not text or budget <= 0:
            continue
        text = text[:budget]
        budget -= len(text)
        blocks.append(f"### {path}\n{text}")
    if not blocks:
        return None
    return (
        "تعليمات المشروع (من ملفات RAFIQ.md / AGENTS.md بمجلد العمل). التزم فيها، وإذا تعارضت مع "
        "طلب المستخدم الصريح، طلب المستخدم أولى:\n\n" + "\n\n".join(blocks)
    )
