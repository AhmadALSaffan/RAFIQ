"""What Rafiq remembers between chats.

A memory is one short fact the user wants kept: a preference ("جاوب بالإنجليزية بالكود"),
something about a project ("المشروع بيستخدم pnpm"), or a decision. The model proposes them
through a tool and each one goes through the user's permission before it is written, so
nothing is remembered behind their back. Everything the user can see, edit and delete from
Settings.
"""

from sqlalchemy import select

from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import Memory

# Only the newest ones ride along in the prompt; the rest stay in Settings.
PROMPT_LIMIT = 40
MAX_TEXT = 400


async def remembered() -> list[Memory]:
    async with SessionLocal() as session:
        rows = await session.execute(
            select(Memory).where(Memory.enabled.is_(True)).order_by(Memory.created_at.desc()).limit(PROMPT_LIMIT)
        )
        return list(rows.scalars().all())


async def remember(text: str, kind: str = "fact", source_chat_id: str | None = None) -> Memory:
    text = " ".join(text.split())[:MAX_TEXT]
    async with SessionLocal() as session:
        # The same sentence twice is one memory.
        existing = (await session.execute(select(Memory).where(Memory.text == text))).scalar_one_or_none()
        if existing:
            existing.enabled = True
            await session.commit()
            return existing
        row = Memory(text=text, kind=kind if kind in ("preference", "project", "fact") else "fact", source_chat_id=source_chat_id)
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return row


async def memory_note() -> str:
    """The block the system prompt carries — empty when there is nothing remembered."""
    rows = await remembered()
    if not rows:
        return ""
    lines = "\n".join(f"- {row.text}" for row in reversed(rows))
    return "أشياء المستخدم طلب منك تتذكّرها من قبل (طبّقها بدون ما تعيدها عليه):\n" + lines
