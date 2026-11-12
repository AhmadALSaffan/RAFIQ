"""The reply's language is decided from the message, not left to the model (core/language.py)."""

from rafiq_agent.core.language import detect, instruction, reply_language, with_instruction


def test_the_messages_own_letters_decide():
    assert detect("Привет! Расскажи о себе.") == "ru"
    assert detect("مرحبا، عرّف عن حالك") == "ar"
    assert detect("Hello, who are you?") == "latin"
    # A few English words (a product name, code, a path) don't turn Arabic or Russian into English.
    assert detect("شغّل pnpm test بمجلد app") == "ar"
    assert detect("Почему не работает `npm run build` в C:\\code\app?") == "ru"
    assert detect("123 👍") is None


def test_no_letters_falls_back_to_the_interface_and_a_chosen_language_wins():
    assert reply_language("?", "ru") == "ru"
    assert reply_language("👍", None) == "ar"
    assert reply_language("Привет", "ar", chosen="en") == "en"
    # The teacher's case: the app in Russian, a Russian message — never an Arabic reply.
    assert reply_language("Здравствуйте, что ты умеешь?", "ru") == "ru"


def test_the_line_goes_with_the_message_not_into_it():
    assert "Russian" in instruction("ru") and "Arabic" in instruction("ar")
    assert with_instruction("Привет", "ru").startswith("Привет\n\n[Reply in Russian")
    parts = with_instruction([{"type": "text", "text": "hi"}], "latin")
    assert parts[0] == {"type": "text", "text": "hi"} and "same language" in parts[1]["text"]
