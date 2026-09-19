"""The design session: the `impeccable init` brief, the prompt built from it, and the
preview extracted from whatever the model writes back."""

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
        "options": ["موقع", "تطبيق ويب", "لوحة تحكم", "تطبيق موبايل", "صفحة هبوط"],
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
        "id": "feel",
        "label": "كيف بدك المستخدم يحس؟",
        "kind": "multi",
        "options": ["هادي ومرتب", "جريء وواثق", "مرح وخفيف", "رسمي ومؤسسي", "فخم وأنيق", "سريع وعملي"],
        "required": False,
    },
    {
        "id": "brand",
        "label": "عندك هوية بصرية؟ (لون أساسي، خط، لوقو)",
        "kind": "text",
        "placeholder": "مثلاً: اللون #e68835 وخط Cairo — أو اتركها فاضية وأنا بقترح",
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
    "أنت مصمم منتجات وواجهات محترف داخل تطبيق رفيق. شغلك تصمّم الواجهة **قبل** ما تنكتب أي شفرة "
    "للمنتج الحقيقي، وتناقش المستخدم بقراراتك.\n\n"
    "الطريقة:\n"
    "1. قبل أي تصميم، اقرأ مهارة impeccable بـ skill_read، وبالكتير مهارة وحدة ثانية بتلزمك "
    "(emil-design-eng للحِرفية، animate للحركة، apple-design للمنصات). لا تقرأ أكتر من مهارتين "
    "بالمرة — الوصف المختصر لكل مهارة تحت وبيكفي تعرف شو فيها.\n"
    "2. اشتغل بالترتيب اللي بمهارة impeccable: وظيفة الشاشة، النظام (خط، لون، مسافات، شكل، حركة)، "
    "بعدين الشاشة نفسها، وبعدين قائمة مكافحة الـ slop.\n"
    "3. كل رد تصميمي لازم ينتهي بمستند HTML واحد مكتفي بذاته داخل بلوك ```html — ستايل داخلي، "
    "بدون ملفات خارجية، بمحتوى حقيقي بلغة المنتج، ويشتغل على عرض 380px.\n"
    "   إذا التصميم فيه أكتر من صفحة بنفس التدفّق، حط كل الصفحات بنفس المستند: كل صفحة بـ "
    '<section id="..."> بمعرّف إنجليزي قصير، والتنقل بينها بروابط href="#id"، مع سكربت صغير '
    "بيعرض الصفحة اللي معرّفها بـ location.hash ويخفي الباقي (الرئيسية بتظهر لما ما يكون في hash). "
    "لا تربط لملفات .html منفصلة.\n"
    "   وإذا فعلاً بدك مستند تاني مستقل (مثلاً لوحة تحكم غير الموقع التسويقي)، اكتبه ببلوك ```html "
    "تاني وسمّيه بسطر أول جوّا البلوك: <!-- file: dashboard --> — رفيق بيعرض كل المستندات "
    "بقائمة فوق المعاينة والمستخدم بيبدّل بينها. لا تعيد إرسال مستند ما تغيّر.\n"
    "4. فوق البلوك اكتب بالعربي: وظيفة الشاشة بجملة، القرارات اللي أخذتها وليش، وشو تركته عمداً.\n"
    "5. بكل تعديل: ارجع للمهارات، وقول أي قاعدة بيخدمها التعديل، وغيّر أصغر شي بيحل ملاحظة المستخدم.\n\n"
    "لا تسأل المستخدم أسئلة الـ brief من جديد — وصلتك جاهزة. إذا في شي ناقص، افترض افتراض معقول "
    "وقول شو افترضت."
)


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


def localized_questions() -> list[dict[str, Any]]:
    """QUESTIONS in the user's language (labels, placeholders, options)."""
    out = []
    for question in QUESTIONS:
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
    for question in QUESTIONS:
        value = brief.get(question["id"])
        if isinstance(value, list):
            value = tr("، ").join(value)
        answer = str(value).strip() if value else tr("— (ما حددها المستخدم)")
        lines.append(f"- **{tr(question['label'])}** {answer}")
    lines += [
        "",
        tr(
            "ابدأ: اقرأ مهارة impeccable وأي مهارة ثانية بتلزمك، لخّصلي القرارات، وبعدين اعطيني أول "
            "نسخة من التصميم كمستند HTML كامل."
        ),
    ]
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
    blocks = _HTML_BLOCK.findall(text or "")
    for index, (info, body) in enumerate(blocks):
        html = body.strip()
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
        # Two blocks that ended up with the same name are two versions of one document:
        # the later one wins, as it always did.
        out = [f for f in out if f["name"] != name]
        out.append({"name": name, "html": html})
    return out


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
