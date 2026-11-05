"""Arabic in terminals without right-to-left (rtl.py), and the terminal's drawings."""

import io

from rich.console import Console

from rafiq_agent import rtl, terminal_logo


def test_latin_is_left_alone():
    assert rtl.visual("pnpm test") == "pnpm test"
    assert not rtl.is_rtl("hello مرحبا")


def test_arabic_is_shaped_and_reversed_for_display():
    shown = rtl.visual("رفيق")
    # Display order (right to left becomes left to right on screen) in joined forms.
    assert len(shown) == 4 and shown[-1] in "رﺭﺮ" and shown[0] in "قﻖﻗﻘ"
    assert rtl.is_rtl("رفيق عم يفكّر")


def test_numbers_and_latin_keep_their_order_inside_arabic():
    shown = rtl.visual("نجحت 237 اختبار في pnpm")
    assert "237" in shown and "pnpm" in shown


def test_paragraphs_wrap_before_reordering_and_sit_to_the_right():
    console = Console(width=30, file=io.StringIO(), record=True, color_system=None)
    text = "رفيق بيقرأ ملفاتك وبيكتب ملفات جديدة وبيشغّل برامج\n\n- بند أول\n```\ncode()\n```"
    console.print(rtl.Paragraphs(text))
    lines = [line for line in console.export_text().splitlines() if line.strip()]
    assert len(lines) >= 3  # wrapped into several lines, each its own visual order
    assert lines[0].endswith(lines[0].strip())  # right aligned
    assert any(line.strip().startswith("code()") for line in lines)  # code stays as written
    assert any("•" in line for line in lines)


def test_drawings_are_whole_rectangles():
    for rows in (terminal_logo.PEEP, terminal_logo.MARK):
        assert len({len(r) for r in rows}) == 1
        assert set("".join(rows)) <= set(terminal_logo.PALETTE) | {"."}
    peep = terminal_logo.half_blocks(terminal_logo.PEEP)
    assert peep.plain.count("\n") == len(terminal_logo.PEEP) // 2 - 1


def test_typed_arabic_maps_the_cursor():
    shown, at = rtl.visual_map("مرحبا")
    assert len(shown) == 5 and at == [4, 3, 2, 1, 0, -1]  # end of line: left of the last letter
    shown, at = rtl.visual_map("شغّل pnpm")
    assert "pnpm" in shown and shown.index("pnpm") == 0
    assert at[-1] == at[-2] + 1  # after an English word the cursor carries on to its right
    assert rtl.visual_map("hello") == ("hello", [0, 1, 2, 3, 4, 5])


def test_a_jetbrains_terminal_does_right_to_left_itself(monkeypatch):
    monkeypatch.delenv("RAFIQ_BIDI", raising=False)
    monkeypatch.setenv("TERMINAL_EMULATOR", "JetBrains-JediTerm")
    assert rtl.enabled() is False
    monkeypatch.setenv("RAFIQ_BIDI", "1")
    assert rtl.enabled() is True
