"""The design session's pure pieces: what we pull out of a reply, and what we send on."""

from rafiq_agent.core.designs import (
    brief_message,
    extract_preview,
    handoff_message,
    save_preview,
    strip_preview,
)

REPLY = """## القرارات

خط Cairo ولون واحد.

```html
<!doctype html><title>أ</title><body>واحد</body>
```
"""


def test_extract_preview_takes_the_html_block():
    html = extract_preview(REPLY)
    assert html is not None
    assert html.startswith("<!doctype html>")
    assert "```" not in html


def test_extract_preview_takes_the_last_block_when_revised():
    two = REPLY + "\n```html\n<!doctype html><title>ب</title>\n```\n"
    assert "<title>ب</title>" in (extract_preview(two) or "")


def test_extract_preview_without_a_block():
    assert extract_preview("ما في تصميم بعد") is None


def test_strip_preview_keeps_the_prose_only():
    spec = strip_preview(REPLY)
    assert "القرارات" in spec
    assert "doctype" not in spec


def test_brief_message_lists_every_question_and_flags_blanks():
    text = brief_message({"what": "منصة طلبات", "kind": "تطبيق ويب"})
    assert "منصة طلبات" in text
    assert "ما حددها المستخدم" in text  # the unanswered ones are called out, not dropped


def test_handoff_carries_spec_and_html_and_asks_for_the_skill():
    message = handoff_message("لوحة الطلبات", "القرارات هون", "<!doctype html>")
    assert "لوحة الطلبات" in message
    assert "القرارات هون" in message
    assert "<!doctype html>" in message
    assert "skill_read" in message


def test_save_preview_writes_into_the_chosen_folder(tmp_path):
    path = save_preview(str(tmp_path), "لوحة الطلبات", "<!doctype html>")
    assert path is not None
    written = tmp_path / "لوحة-الطلبات.html"
    assert written.read_text(encoding="utf-8") == "<!doctype html>"


def test_save_preview_is_a_no_op_without_a_folder():
    assert save_preview(None, "أي شي", "<html>") is None


def test_save_preview_ignores_a_folder_that_is_gone(tmp_path):
    assert save_preview(str(tmp_path / "missing"), "أي شي", "<html>") is None
