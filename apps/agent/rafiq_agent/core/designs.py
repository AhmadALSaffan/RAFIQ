"""The design session: the `impeccable init` brief, the prompt built from it, and the
preview extracted from whatever the model writes back."""

import re
from pathlib import Path
from typing import Any

from rafiq_agent.skills.registry import skills_index

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
    "4. فوق البلوك اكتب بالعربي: وظيفة الشاشة بجملة، القرارات اللي أخذتها وليش، وشو تركته عمداً.\n"
    "5. بكل تعديل: ارجع للمهارات، وقول أي قاعدة بيخدمها التعديل، وغيّر أصغر شي بيحل ملاحظة المستخدم.\n\n"
    "لا تسأل المستخدم أسئلة الـ brief من جديد — وصلتك جاهزة. إذا في شي ناقص، افترض افتراض معقول "
    "وقول شو افترضت."
)


def skills_note() -> str:
    return f"المهارات المتاحة عندك (اقرأها بـ skill_read قبل ما تبدأ، وارجعلها بكل مراجعة):\n{skills_index()}"


def brief_message(brief: dict[str, Any]) -> str:
    """The first user message of a design chat: the answers, as the model will read them."""
    lines = ["هاي معلومات المشروع من `impeccable init`:", ""]
    for question in QUESTIONS:
        value = brief.get(question["id"])
        if isinstance(value, list):
            value = "، ".join(value)
        lines.append(f"- **{question['label']}** {str(value).strip() if value else '— (ما حددها المستخدم)'}")
    lines += [
        "",
        "ابدأ: اقرأ مهارة impeccable وأي مهارة ثانية بتلزمك، لخّصلي القرارات، وبعدين اعطيني أول "
        "نسخة من التصميم كمستند HTML كامل.",
    ]
    return "\n".join(lines)


_HTML_BLOCK = re.compile(r"```html\s*\n(.*?)```", re.DOTALL | re.IGNORECASE)


def extract_preview(text: str) -> str | None:
    """The last ```html block in a reply — that's the document the preview renders."""
    blocks = _HTML_BLOCK.findall(text or "")
    return blocks[-1].strip() if blocks else None


def strip_preview(text: str) -> str:
    """The reply without its HTML block: the written decisions, i.e. the spec."""
    return _HTML_BLOCK.sub("", text or "").strip()


def handoff_message(title: str, spec: str | None, html: str | None) -> str:
    """What gets sent to the session that will actually build the thing."""
    parts = [
        f"# التصميم الجاهز: {title}",
        "",
        "هاد تصميم متفق عليه من صفحة التصاميم. ابنيه بالشفرة زي ما هو: نفس التسلسل، نفس الـ tokens "
        "(الألوان، الخطوط، المسافات، الحواف)، ونفس الحركة. إذا اضطريت تغيّر شي، قول ليش.",
        "",
    ]
    if spec:
        parts += ["## القرارات", "", spec, ""]
    if html:
        parts += ["## الواجهة المعتمدة (HTML مرجعي)", "", "```html", html, "```", ""]
    parts += [
        "## المطلوب",
        "",
        "1. اقرأ مهارة impeccable بـ skill_read قبل ما تبدأ، وطبّق قواعدها على الشفرة.",
        "2. حوّل التصميم لمكوّنات حقيقية بالمشروع الحالي (مو ملف HTML واحد).",
        "3. خلّي الحالات كلها موجودة: فاضي، تحميل، خطأ، وبيانات كتيرة.",
    ]
    return "\n".join(parts)


_SLUG_BAD = re.compile(r"[^\w؀-ۿ-]+", re.UNICODE)


def save_preview(working_dir: str | None, title: str, html: str) -> str | None:
    """Writes the latest preview into the folder the user picked. Returns the path."""
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
