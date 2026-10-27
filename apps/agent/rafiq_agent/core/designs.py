"""The design session: the `impeccable init` brief, the prompt built from it, and the
preview extracted from whatever the model writes back."""

import difflib
import re
from pathlib import Path
from typing import Any

from rafiq_agent.i18n import tr
from rafiq_agent.skills.registry import all_skills, skills_index

# `impeccable init` — the questions Rafiq asks before the design chat opens. They mirror
# skills/bundled/impeccable/INIT.md; keep the two in step.
QUESTIONS: list[dict[str, Any]] = [
    {
        "id": "kind",
        "label": "شو بدك تصمّم؟",
        "kind": "choice",
        "options": ["موقع", "تطبيق ويب", "لوحة تحكم", "صفحة هبوط"],
        "required": True,
    },
    {
        "id": "what",
        "label": "شو بيعمل المنتج؟ بجملة وحدة",
        "kind": "text",
        "placeholder": "مثلاً: منصة تخلي المطاعم تستقبل طلبات واتساب وترتبها بمكان واحد",
        "required": True,
    },
    {
        "id": "who",
        "label": "مين المستخدم؟",
        "kind": "text",
        "placeholder": "مثلاً: صاحب مطعم صغير، مو تقني، بيستعمل الموبايل أكتر",
        "required": True,
    },
    {
        "id": "action",
        "label": "شو أهم إجراء بالشاشة الأولى؟",
        "kind": "text",
        "placeholder": "مثلاً: يشوف الطلبات الجديدة ويقبلها",
        "required": True,
    },
    {
        "id": "layout",
        "label": "شكل الصفحة؟",
        "kind": "choice",
        "options": ["طويلة بقصة كاملة", "قصيرة ومركّزة", "شبكة بطاقات", "تحريرية بأعمدة"],
        "required": False,
    },
    {
        "id": "sections",
        "label": "شو لازم يكون فيها؟",
        "kind": "text",
        "placeholder": "مثلاً: أسعار، آراء العملاء، أسئلة شائعة، نموذج تواصل، الشعار",
        "required": False,
    },
    {
        "id": "direction",
        "label": "لغة الواجهة واتجاهها",
        "kind": "choice",
        "options": ["عربي RTL", "إنجليزي LTR", "الاثنين"],
        "required": True,
    },
    {
        "id": "references",
        "label": "في منتجات شكلها بيعجبك؟",
        "kind": "text",
        "placeholder": "أسماء أو روابط — بتوصل الذوق أسرع من الوصف",
        "required": False,
    },
    {
        "id": "constraints",
        "label": "في قيود؟ (تقنية، وقت، إمكانية وصول، أجهزة)",
        "kind": "text",
        "placeholder": "مثلاً: لازم يشتغل على موبايل قديم، وبدون مكتبات خارجية",
        "required": False,
    },
]

DESIGN_SYSTEM_PROMPT = (
    "أنت مصمم واجهات ومواقع محترف داخل تطبيق رفيق — مستواك متل استوديو تصميم، مش قالب. شغلك تصمّم "
    "الواجهة **قبل** ما تنكتب أي شفرة للمنتج الحقيقي، وتناقش المستخدم بقراراتك.\n\n"
    "الطريقة:\n"
    "1. تحت بهالرسالة في «دليل التصميم» (الأرقام، قائمة خيارات التكوين، رسم المنتج، الحركة، النصوص) "
    "ومهارة impeccable (العملية وقائمة مكافحة الـ slop). اشتغل منهم مباشرة وما تقرأ ملفات بالبداية؛ "
    "مهارة تانية بـ skill_read بس إذا فعلاً بتلزمك.\n"
    "2. الهوية البصرية بناها المستخدم (بتوصلك تحت بـ «هوية التصميم»): انسخ بلوك الـ :root تبعها كما هو، "
    "حمّل خطوطها، وما تستعمل ولا لون ولا خط غيرها، واتبع أسلوبها. إنت بتقرر ترتيب الأقسام وشكلها والحركات "
    "المميزة — لكل تصميم تكوين خاص فيه، ولا تكرر تسلسل استعملته قبل. قبل الشفرة اكتب الخطة بـ 4–6 أسطر: "
    "كيف رح تطبّق الهوية، الأقسام بالترتيب، والحركات المميزة. (إذا ما في هوية، اكتب وحدة أول: ألوان بالـ hex "
    "وخطين وحركات مميزة.)\n"
    "3. كل رد تصميمي لازم ينتهي بمستند HTML واحد كامل ومكتفي بذاته داخل بلوك ```html — ستايل وسكربت "
    "داخليين، والخطوط من Google Fonts برابط واحد، بمحتوى حقيقي بلغة المنتج، فيه حركة، ويشتغل على عرض 380px.\n"
    "   إذا التصميم فيه أكتر من صفحة بنفس التدفّق، حط كل الصفحات بنفس المستند: كل صفحة بـ "
    '<section id="..."> بمعرّف إنجليزي قصير، والتنقل بينها بروابط href="#id"، مع سكربت صغير '
    "بيعرض الصفحة اللي معرّفها بـ location.hash ويخفي الباقي (الرئيسية بتظهر لما ما يكون في hash). "
    "لا تربط لملفات .html منفصلة.\n"
    "   وإذا فعلاً بدك مستند تاني مستقل (مثلاً لوحة تحكم غير الموقع التسويقي)، اكتبه ببلوك ```html "
    "تاني وسمّيه بسطر أول جوّا البلوك: <!-- file: dashboard --> — رفيق بيعرض كل المستندات "
    "بقائمة فوق المعاينة والمستخدم بيبدّل بينها. لا تعيد إرسال مستند ما تغيّر.\n"
    "4. قبل ما ترسل، مرّ على قائمة «قبل ما ترسلها» بالدليل.\n"
    "5. إذا طلب المستخدم مراجعة أو تحسين («راجع وحسّن»): ابدأ بـ design_review واتبع طريقة المراجعة اللي "
    "بترجع معه، وارجع المستند كامل مصلّح. وإذا طلب يتأكد إن التصميم مش AI slop: ابدأ بـ design_slop_check "
    "وصلّح كل علامة بيلاقيها وكل علامة بالدليل اللي معه، بدون ما تطلع عن الهوية.\n"
    "6. بكل تعديل: غيّر أصغر شي بيحل ملاحظة المستخدم، وقول أي قاعدة بيخدمها التعديل.\n\n"
    "لا تسأل المستخدم أسئلة الـ brief من جديد — وصلتك جاهزة. إذا في شي ناقص، افترض افتراض معقول "
    "وقول شو افترضت."
)


# A mobile app is designed as a board: every screen in a phone frame, side by side, with the
# app's identity sheet first (the app draws the board — features/design/Board.tsx). It has
# its own door and its own brief; websites keep theirs.
BOARD_QUESTIONS: list[dict[str, Any]] = [
    {
        "id": "what",
        "label": "شو بيعمل التطبيق؟ بجملة وحدة",
        "kind": "text",
        "placeholder": "مثلاً: تطبيق تطلب فيه قهوتك من أقرب فرع وتستلمها بدون انتظار",
        "required": True,
    },
    {
        "id": "who",
        "label": "مين المستخدم؟",
        "kind": "text",
        "placeholder": "مثلاً: موظفين مستعجلين الصبح، أغلبهم على آيفون",
        "required": True,
    },
    {
        "id": "screens",
        "label": "شو أهم الشاشات؟",
        "kind": "text",
        "placeholder": "مثلاً: الترحيب، الرئيسية، القائمة، السلة، تتبع الطلب، الحساب",
        "required": False,
    },
    {
        "id": "style",
        "label": "الإحساس العام؟",
        "kind": "choice",
        "options": ["هادي ونظيف", "جريء وملوّن", "فخم وداكن", "مرح وودود"],
        "required": False,
    },
    {
        "id": "direction",
        "label": "لغة الواجهة واتجاهها",
        "kind": "choice",
        "options": ["عربي RTL", "إنجليزي LTR", "الاثنين"],
        "required": True,
    },
    {
        "id": "references",
        "label": "في تطبيقات شكلها بيعجبك؟",
        "kind": "text",
        "placeholder": "أسماء أو روابط — بتوصل الذوق أسرع من الوصف",
        "required": False,
    },
]
# Designs from before the board had its own door asked for it as a kind of design.
BOARD_KIND = "تطبيق موبايل"
BOARD_LAYOUT = "شاشات تطبيق"


def is_board(brief: dict[str, Any] | None) -> bool:
    """An app board: made from its own door (`type: board`), or — before that — asked for as
    a mobile app, in whichever language the answers were saved in."""
    if not brief:
        return False
    if brief.get("type") == "board":
        return True
    from rafiq_agent.i18n import _DICTS

    def names(text: str) -> set[str]:
        return {text, *(d.get(text, text) for d in _DICTS.values())}

    return str(brief.get("kind") or "") in names(BOARD_KIND) or str(brief.get("layout") or "") in names(BOARD_LAYOUT)


BOARD_NOTE = (
    "هالتصميم **لوحة تطبيق موبايل**: رفيق بيعرض كل شاشة بإطار جوال على لوحة وحدة (متل Figma)، "
    "وأول شي عليها هوية التطبيق. القواعد:\n"
    "0. المستندات بتنكتب بالرد نفسه، كل واحد ببلوك ```html — رفيق بيحفظها وبيرسم اللوحة منها. ما عندك "
    "أدوات ملفات هون، ورفيق بيفحص كل رد: رد بلا مستندات (قبل ما يكون في لوحة)، مستند بلا اسم، مستند فيه "
    "إطار جوال أو شريط حالة أو كذا شاشة، أو أول رد بلا brand — بيرجعلك لتعيده.\n"
    "1. كل شاشة مستند لحاله: بلوك ```html أول سطر فيه <!-- file: <id> --> — id إنجليزي قصير "
    "(onboarding, home, search, product, cart, profile…) — و <title> فيه اسم الشاشة بلغة المنتج.\n"
    "2. أول مستند اسمه brand: لوحة الهوية البصرية للتطبيق، مش شاشة. عرضها 1200px: الشعار (SVG إنت "
    "بتصممه، مش نص)، أيقونة التطبيق، الألوان بأسمائها وقيمها، الخطوط بأحجامها، والمكونات الأساسية "
    "(أزرار بحالاتها، حقل، بطاقة، شريط تنقل، شارة).\n"
    "3. كل شاشة 390×844 بالظبط: html و body بدون هوامش، ارتفاع 100vh، والمحتوى بيعبّي الشاشة. لا ترسم "
    "إطار الجوال ولا شريط الحالة ولا مؤشر الهوم — رفيق بيحطهم. خلّي أول 54px وآخر 34px بدون أزرار.\n"
    "4. نفس الهوية بكل الشاشات: نفس بلوك :root ونفس الخطوط ونفس المكونات (انسخ نفس الـ CSS بكل "
    "مستند)، وشريط التنقل نفسه بكل الشاشات اللي فيها شريط.\n"
    "5. رتّب المستندات بترتيب رحلة المستخدم، من 5 لـ 8 شاشات، بمحتوى حقيقي (أسماء، أسعار، صور من "
    "Unsplash بروابطها). زر بيودّي لشاشة تانية: href=\"<id>.html\" — رفيق بيوصل اللوحة لهالشاشة.\n"
    "6. أول رد: brand وأهم 3 شاشات. بآخر الرد اكتب الشاشات الباقية بسطر، والمستخدم بيقول «كمّل». "
    "بالتعديلات ارجع بس المستندات اللي تغيّرت."
)


# What a board reply is checked for (chat_service sends a refused reply back to be redone).
_FRAME = re.compile(
    r"dynamic[-_ ]?island|\bnotch\b|phone[-_]?frame|device[-_]?frame|iphone[-_]?frame|home[-_]?indicator|>\s*9:41\s*<",
    re.IGNORECASE,
)
_SECTION = re.compile(r"<section\b", re.IGNORECASE)

BOARD_REDO_NONE = (
    "(رسالة من رفيق) ردّك ما فيه ولا مستند، فاللوحة فاضية والمستخدم ما بيشوف شي. اكتب هلأ مستند brand "
    "وأهم الشاشات، كل واحد ببلوك ```html أول سطر فيه <!-- file: <id> -->."
)
BOARD_REDO_NAMES = (
    "(رسالة من رفيق) في مستندات بردّك بلا اسم، فرفيق ما بيعرف أي شاشة هي. أعد الرد وخلّي أول سطر بكل "
    "بلوك ```html: <!-- file: <id> --> (brand، home، menu…)."
)
BOARD_REDO_FRAME = (
    "(رسالة من رفيق) المستند «{0}» فيه إطار جوال أو شريط حالة أو كذا شاشة. رفيق هو اللي بيرسم الإطار "
    "وشريط الحالة واللوحة: كل مستند شاشة وحدة بمحتواها بس (390×844)، وكل شاشة بمستند لحاله. أعد "
    "المستندات اللي فيها هالشي."
)
BOARD_REDO_BRAND = (
    "(رسالة من رفيق) أول لوحة لازم تبلّش بمستند الهوية: <!-- file: brand --> (الشعار، الأيقونة، الألوان، "
    "الخطوط، المكونات). أعد الرد ومعه brand."
)


def board_reply_check(text: str, has_documents: bool) -> str | None:
    """A board chat's answer, checked before it's kept: what to tell the model if it has to
    be redone, or None. The documents are what the board is drawn from, so the rules are
    the ones that keep it drawable."""
    blocks = _HTML_BLOCK.findall(text or "")
    if not blocks:
        # talking it over is fine once the board has screens; before that it's empty
        return None if has_documents else BOARD_REDO_NONE
    names: list[str] = []
    for fence, body in blocks:
        comment = _FILE_COMMENT.search(body)
        name = clean_name(fence.split()[0]) if fence.strip() else clean_name(comment.group(1)) if comment else ""
        if not name:
            return BOARD_REDO_NAMES
        names.append(name)
        sheet = name.lower().startswith(("brand", "identity", "style", "design-system"))
        many = len(_SECTION.findall(body)) >= 3 and "location.hash" in body
        if not sheet and (_FRAME.search(body) or many):
            return BOARD_REDO_FRAME.format(name)
    if not has_documents and not any(n.lower().startswith(("brand", "identity")) for n in names):
        return BOARD_REDO_BRAND
    return None


def design_guide_note() -> str:
    """What a design chat's model reads with every turn: how a studio composes a page
    (DESIGNER.md) and the impeccable process. No finished page rides along — a model shown
    one copies it; the identity comes from the user and the layout from the brief."""
    folder = Path(__file__).resolve().parent.parent / "skills" / "bundled" / "impeccable"
    skill = (folder / "SKILL.md").read_text(encoding="utf-8")
    if skill.startswith("---"):
        skill = skill.split("---", 2)[2]
    guide = (folder / "DESIGNER.md").read_text(encoding="utf-8")
    return "دليل التصميم:\n" + guide.strip() + "\n\nمهارة impeccable (العملية وقائمة مكافحة الـ slop):\n" + skill.strip()


def review_guide() -> str:
    """How to review a design section by section (REVIEW.md)."""
    folder = Path(__file__).resolve().parent.parent / "skills" / "bundled" / "impeccable"
    return (folder / "REVIEW.md").read_text(encoding="utf-8").strip()


def skills_note(full: bool = False) -> str:
    """What the model is told about the skills it has.

    `full` spells out every skill with its description — what a design session wants, and
    what the user gets by turning the token saver off. Otherwise the names are listed and
    the descriptions stay behind `skill_list`, which the model calls when it wants them:
    the catalogue was 5.8k characters on every single message, used or not.
    """
    skills = all_skills()
    if not skills:
        return ""
    if full:
        return f"المهارات المتاحة عندك (اقرأها بـ skill_read قبل ما تبدأ، وارجعلها بكل مراجعة):\n{skills_index()}"
    names = ", ".join(s.name for s in skills)
    return (
        f"المهارات المتاحة عندك: {names}.\n"
        "قبل شغل التصميم أو الواجهات اقرأ المهارة المناسبة بـ skill_read. "
        "و skill_list بيعطيك وصف كل مهارة وملفاتها — استدعيه وقت ما بدك، ما إله كلفة تُذكر."
    )


def localized_questions(board: bool = False) -> list[dict[str, Any]]:
    """The questions (a site's, or an app board's) in the user's language."""
    out = []
    for question in BOARD_QUESTIONS if board else QUESTIONS:
        q = dict(question)
        q["label"] = tr(q["label"])
        if q.get("placeholder"):
            q["placeholder"] = tr(q["placeholder"])
        if q.get("options"):
            q["options"] = [tr(o) for o in q["options"]]
        out.append(q)
    return out


def brief_message(brief: dict[str, Any]) -> str:
    """The first user message of a design chat: the answers, as the model will read them.

    It's shown in the chat as the user's own message, so it's in the user's language."""
    lines = [tr("هاي معلومات المشروع من `impeccable init`:"), ""]
    for question in BOARD_QUESTIONS if brief.get("type") == "board" else QUESTIONS:
        value = brief.get(question["id"])
        if isinstance(value, list):
            value = tr("، ").join(value)
        answer = str(value).strip() if value else tr("— (ما حددها المستخدم)")
        lines.append(f"- **{tr(question['label'])}** {answer}")
    from rafiq_agent.core.art_direction import DIRECTIONS

    if brief.get("art") in DIRECTIONS:
        lines.append(f"- **{tr('الاتجاه الفني (اختاره رفيق ليختلف عن تصاميمك السابقة):')}** {tr(DIRECTIONS[brief['art']]['name'])}")
    if is_board(brief):
        start = tr(
            "ابدأ: اكتبلي خطة التطبيق (الشاشات بترتيب رحلة المستخدم والهوية)، وبعدين اعطيني لوحة "
            "الهوية وأهم الشاشات، كل شاشة بمستند لحاله."
        )
    else:
        start = tr(
            "ابدأ: اكتبلي خطة الصفحة بروح الهوية اللي بنيتها (الأقسام والحركات المميزة)، وبعدين "
            "اعطيني أول نسخة من التصميم كمستند HTML كامل."
        )
        if brief.get("art") in DIRECTIONS:
            start = tr(
                "ابدأ: اكتبلي خطة الصفحة بروح الهوية اللي بنيتها وعلى الاتجاه الفني (الهيرو، الأقسام والحركات "
                "المميزة)، وبعدين اعطيني أول نسخة من التصميم كمستند HTML كامل."
            )
    lines += ["", start]
    return "\n".join(lines)


# ```html  ·  ```html dashboard.html  — the word after the fence names the document.
_HTML_BLOCK = re.compile(r"```html[ \t]*([^\n]*)\n(.*?)```", re.DOTALL | re.IGNORECASE)
# A name the model may put at the top of the document instead: <!-- file: dashboard.html -->
_FILE_COMMENT = re.compile(r"<!--\s*(?:rafiq:)?file\s*[:=]?\s*([^\s>-][^\n>]*?)\s*-->", re.IGNORECASE)
_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.DOTALL | re.IGNORECASE)
_NAME_BAD = re.compile(r"[^\w\u0600-\u06FF -]+", re.UNICODE)


def clean_name(raw: str) -> str:
    """A document name fit for a tab and a file on disk."""
    name = (raw or "").strip().strip("\"'`")
    if name.lower().endswith((".html", ".htm")):
        name = name.rsplit(".", 1)[0]
    return _NAME_BAD.sub("", name).strip(" -")[:40]


def extract_preview(text: str) -> str | None:
    """The last ```html block in a reply — the document the preview opens on."""
    blocks = _HTML_BLOCK.findall(text or "")
    return blocks[-1][1].strip() if blocks else None


def extract_previews(text: str, fallback: str) -> list[dict[str, str]]:
    """Every HTML document in one reply, in order, each with a name.

    A model that keeps a design in one document just gets one entry (named after the
    design). One that answers with a second screen gets a second entry, and the preview
    offers both — which is the whole point: nothing the model wrote disappears because a
    later block replaced it.
    """
    out: list[dict[str, str]] = []
    for _, name, html in _named_blocks(text, fallback):
        # Two blocks that ended up with the same name are two versions of one document:
        # the later one wins, as it always did.
        out = [f for f in out if f["name"] != name]
        out.append({"name": name, "html": html})
    return out


def _named_blocks(text: str, fallback: str) -> list[tuple[re.Match[str], str, str]]:
    """Each non-empty HTML block in a reply, with the document name it belongs to."""
    out = []
    blocks = list(_HTML_BLOCK.finditer(text or ""))
    for index, match in enumerate(blocks):
        info, html = match.group(1), match.group(2).strip()
        if not html:
            continue
        comment = _FILE_COMMENT.search(html[:400])
        title = _TITLE.search(html[:2000])
        name = (
            clean_name(info)
            or clean_name(comment.group(1) if comment else "")
            or (clean_name(title.group(1)) if len(blocks) > 1 and title else "")
            or (clean_name(fallback) if index == 0 else "")
            or f"{clean_name(fallback) or 'design'}-{index + 1}"
        )
        out.append((match, name, html))
    return out


OLD_VERSION = "[نسخة أقدم من المستند «{0}» ({1} حرف) — النسخة الأحدث موجودة تحت]"


def keep_newest_versions(replies: list[str], fallback: str) -> list[str]:
    """A design chat's replies, with only the newest copy of each HTML document whole.

    Every design reply carries its document in full, so ten rounds of edits used to send ten
    copies of the page with every message — the bulk of the request, and the reason a long
    design chat outgrew a small model. The newest copy is what the next edit starts from;
    the older ones become a line saying they were there.
    """
    seen: set[str] = set()
    out = list(replies)
    for i in range(len(out) - 1, -1, -1):
        blocks = _named_blocks(out[i], fallback)
        if not blocks:
            continue
        text = out[i]
        # Replace from the end so earlier match positions stay valid.
        for match, name, html in reversed(blocks):
            if name in seen:
                text = text[: match.start()] + OLD_VERSION.format(name, len(html)) + text[match.end() :]
            else:
                seen.add(name)
        out[i] = text
    return out


CURRENT_MENTION = "[المستند «{0}» — نسخته الحالية مرفقة بآخر رسالة]"


def mention_documents(text: str, fallback: str) -> str:
    """A design reply with each HTML document reduced to its name. The documents' current
    versions travel once, with the newest message (`current_documents`)."""
    blocks = _named_blocks(text, fallback)
    for match, name, _ in reversed(blocks):
        text = text[: match.start()] + CURRENT_MENTION.format(name) + text[match.end() :]
    return text


def current_documents(files: list[dict[str, Any]]) -> str:
    """The design as it stands, for the newest message: what the next edit starts from."""
    docs = [f for f in files if f.get("html")]
    if not docs:
        return ""
    body = "\n\n".join(f"```html {f['name']}\n{f['html']}\n```" for f in docs)
    return (
        "(من رفيق) هاد التصميم بشكله الحالي. عدّل عليه هو، وأرسل بس المستندات اللي تغيّرت، "
        f"كل مستند ببلوك ```html باسمه:\n\n{body}"
    )


def without_html(text: str) -> str:
    """A reply with each HTML document reduced to a mention — for summaries."""
    return _HTML_BLOCK.sub(lambda m: f"[مستند HTML، {len(m.group(2).strip())} حرف]", text or "")


def strip_preview(text: str) -> str:
    """The reply without its HTML block: the written decisions, i.e. the spec."""
    return _HTML_BLOCK.sub("", text or "").strip()


def handoff_message(title: str, spec: str | None, html: str | None) -> str:
    """What gets sent to the session that will actually build the thing."""
    parts = [
        tr("# التصميم الجاهز: {0}", title),
        "",
        tr(
            "هاد تصميم متفق عليه من صفحة التصاميم. ابنيه بالشفرة زي ما هو: نفس التسلسل، نفس الـ tokens "
            "(الألوان، الخطوط، المسافات، الحواف)، ونفس الحركة. إذا اضطريت تغيّر شي، قول ليش."
        ),
        "",
    ]
    if spec:
        parts += [tr("## القرارات"), "", spec, ""]
    if html:
        parts += [tr("## الواجهة المعتمدة (HTML مرجعي)"), "", "```html", html, "```", ""]
    parts += [
        tr("## المطلوب"),
        "",
        tr("1. اقرأ مهارة impeccable بـ skill_read قبل ما تبدأ، وطبّق قواعدها على الشفرة."),
        tr("2. حوّل التصميم لمكوّنات حقيقية بالمشروع الحالي (مو ملف HTML واحد)."),
        tr("3. خلّي الحالات كلها موجودة: فاضي، تحميل، خطأ، وبيانات كتيرة."),
    ]
    return "\n".join(parts)


_SLUG_BAD = re.compile(r"[^\w؀-ۿ-]+", re.UNICODE)


def save_preview(working_dir: str | None, title: str, html: str) -> str | None:
    """Writes one document into the folder the user picked. Returns the path."""
    if not working_dir or not html:
        return None
    folder = Path(working_dir)
    if not folder.is_dir():
        return None
    slug = _SLUG_BAD.sub("-", title.strip()).strip("-") or "design"
    target = folder / f"{slug[:60]}.html"
    try:
        target.write_text(html, encoding="utf-8")
    except OSError:
        return None
    return str(target)


def merge_files(saved: list[dict[str, Any]] | None, fresh: list[dict[str, str]]) -> list[dict[str, Any]]:
    """The design's documents after this reply: a document with a name we already have is
    replaced in place (so its tab keeps its position), a new one goes at the end."""
    files = [dict(f) for f in saved or []]
    for item in fresh:
        for existing in files:
            if existing.get("name") == item["name"]:
                existing["html"] = item["html"]
                break
        else:
            files.append({"name": item["name"], "html": item["html"]})
    return files[:20]


# ── History ───────────────────────────────────────────────────────────────────────────
#
# Every reply that wrote a document is still in the design's conversation, so its history
# needs no storage of its own: replaying the replies in order gives each document's
# versions — for designs made before history existed, too.


def versions(messages: list[Any], title: str) -> list[dict[str, Any]]:
    """Every version of every document, oldest first. `messages` are the design chat's
    messages in order; each assistant reply that carried HTML adds a version of each
    document it wrote. A version's id is `<message id>.<block index>`."""
    out: list[dict[str, Any]] = []
    counts: dict[str, int] = {}
    previous: dict[str, str] = {}
    for message in messages:
        if getattr(message, "role", "") != "assistant" or not getattr(message, "content", ""):
            continue
        summary = _first_line(strip_preview(message.content))
        for index, doc in enumerate(extract_previews(message.content, title)):
            name, html = doc["name"], doc["html"]
            if previous.get(name) == html:
                continue  # rewritten word for word: not a new version
            counts[name] = counts.get(name, 0) + 1
            added, removed = line_changes(previous.get(name, ""), html)
            out.append({
                "id": f"{message.id}.{index}",
                "document": name,
                "number": counts[name],
                "message_id": message.id,
                "created_at": message.created_at,
                "lines": html.count("\n") + 1,
                "added": added,
                "removed": removed,
                "summary": summary,
                "html": html,
            })
            previous[name] = html
    return out


def _first_line(text: str, limit: int = 140) -> str:
    for line in (text or "").splitlines():
        line = line.strip().lstrip("#>*- ").strip()
        if line:
            return line if len(line) <= limit else line[: limit - 1].rstrip() + "…"
    return ""


def _lines(html: str) -> list[str]:
    return html.replace("\r\n", "\n").split("\n") if html else []


def line_changes(old: str, new: str) -> tuple[int, int]:
    """(lines added, lines removed) going from `old` to `new`."""
    added = removed = 0
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, _lines(old), _lines(new), autojunk=False).get_opcodes():
        if tag in ("replace", "delete"):
            removed += i2 - i1
        if tag in ("replace", "insert"):
            added += j2 - j1
    return added, removed


def diff(old: str, new: str, context: int = 3) -> list[dict[str, Any]]:
    """The changes from `old` to `new` as runs of lines: "same", "del" and "add", with
    long unchanged stretches folded into a "skip" that says how many lines it hides."""
    a, b = _lines(old), _lines(new)
    runs: list[dict[str, Any]] = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag == "equal":
            same = a[i1:i2]
            first, last = not runs, i2 == len(a)
            if len(same) > context * 2 + 1 or (first and len(same) > context) or (last and len(same) > context):
                head = [] if first else same[:context]
                tail = [] if last else same[-context:]
                if head:
                    runs.append({"kind": "same", "lines": head, "start": i1 + 1})
                runs.append({"kind": "skip", "count": len(same) - len(head) - len(tail)})
                if tail:
                    runs.append({"kind": "same", "lines": tail, "start": i2 - len(tail) + 1})
            else:
                runs.append({"kind": "same", "lines": same, "start": i1 + 1})
            continue
        if tag in ("replace", "delete"):
            runs.append({"kind": "del", "lines": a[i1:i2], "start": i1 + 1})
        if tag in ("replace", "insert"):
            runs.append({"kind": "add", "lines": b[j1:j2], "start": j1 + 1})
    return runs
