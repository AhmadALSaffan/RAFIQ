/**
 * Ready-made documents: pick one, fill in what you know (every field is optional), and the
 * model asks for whatever is still missing — in one short list — before it writes the file
 * with the office tools (word_write, slides_write, excel_write).
 */

import { t } from "../i18n";

export interface TemplateField {
  key: string;
  label: string;
  placeholder: string;
  long?: boolean;
}

export interface DocTemplate {
  id: "research" | "cv" | "report" | "invoice" | "deck";
  title: string;
  blurb: string;
  /** What comes out, for the card: "Word", "Excel", "PowerPoint". */
  format: "Word" | "Excel" | "PowerPoint";
  tool: "word_write" | "excel_write" | "slides_write";
  file: string;
  fields: TemplateField[];
  /** What a good one of these has — the model follows it. */
  shape: string;
}

export function docTemplates(): DocTemplate[] {
  return [
    {
      id: "research",
      title: t("بحث جامعي"),
      blurb: t("مقدمة، فصول، خاتمة ومراجع — بالترتيب الأكاديمي"),
      format: "Word",
      tool: "word_write",
      file: t("بحث.docx"),
      fields: [
        { key: "topic", label: t("الموضوع"), placeholder: t("مثلاً: أثر الذكاء الاصطناعي على التعليم") },
        { key: "university", label: t("الجامعة والمادة"), placeholder: t("مثلاً: جامعة الملك سعود — مقرر 101") },
        { key: "student", label: t("اسم الطالب"), placeholder: t("اسمك كما بدك يطلع") },
        { key: "length", label: t("الطول"), placeholder: t("مثلاً: 8 صفحات تقريباً") },
        { key: "notes", label: t("ملاحظات الدكتور"), placeholder: t("أي شروط: عدد المراجع، أسلوب التوثيق…"), long: true },
      ],
      shape: "A title page (title, student, university, course, date), an abstract, an introduction with the problem and aims, 3–5 chapters with headings, a conclusion with findings and recommendations, and a references list in APA style. Formal Modern Standard Arabic.",
    },
    {
      id: "cv",
      title: t("سيرة ذاتية"),
      blurb: t("صفحة وحدة مرتبة، جاهزة للتقديم"),
      format: "Word",
      tool: "word_write",
      file: t("السيرة-الذاتية.docx"),
      fields: [
        { key: "name", label: t("الاسم"), placeholder: t("الاسم الكامل") },
        { key: "role", label: t("الوظيفة اللي بتقدّم عليها"), placeholder: t("مثلاً: مطوّر واجهات") },
        { key: "contact", label: t("التواصل"), placeholder: t("الإيميل، الجوال، المدينة، LinkedIn") },
        { key: "experience", label: t("الخبرات"), placeholder: t("الشركة، المسمى، المدة، وأهم إنجاز بكل وحدة"), long: true },
        { key: "education", label: t("التعليم"), placeholder: t("الشهادة، الجامعة، السنة") },
        { key: "skills", label: t("المهارات"), placeholder: t("مثلاً: React، TypeScript، العمل بفريق") },
      ],
      shape: "One page: name and contact at the top, a two-line professional summary aimed at the role, experience (newest first, 2–3 achievement bullets each, with numbers where possible), education, skills, and languages. Concise; no photo; no tables.",
    },
    {
      id: "report",
      title: t("تقرير شغل"),
      blurb: t("ملخص، إنجازات، أرقام، ومشاكل وخطوات جاية"),
      format: "Word",
      tool: "word_write",
      file: t("تقرير.docx"),
      fields: [
        { key: "period", label: t("الفترة"), placeholder: t("مثلاً: الربع الثالث 2026، أو الأسبوع الماضي") },
        { key: "team", label: t("الفريق أو المشروع"), placeholder: t("مثلاً: فريق المبيعات") },
        { key: "done", label: t("شو انعمل"), placeholder: t("الإنجازات بنقاط"), long: true },
        { key: "numbers", label: t("الأرقام"), placeholder: t("مثلاً: المبيعات 120 ألف، النمو 12%"), long: true },
        { key: "issues", label: t("المشاكل والخطوات الجاية"), placeholder: t("شو وقّفنا، وشو رح نعمل"), long: true },
      ],
      shape: "A title, an executive summary of 3–4 lines, achievements as bullets, the numbers in a table (with change versus the previous period when given), challenges, and next steps with owners and dates when known.",
    },
    {
      id: "invoice",
      title: t("فاتورة"),
      blurb: t("بنود، كميات، أسعار، ضريبة ومجموع — بمعادلات"),
      format: "Excel",
      tool: "excel_write",
      file: t("فاتورة.xlsx"),
      fields: [
        { key: "seller", label: t("من"), placeholder: t("اسمك أو اسم الشركة، والرقم الضريبي إذا في") },
        { key: "buyer", label: t("لمين"), placeholder: t("اسم العميل") },
        { key: "items", label: t("البنود"), placeholder: t("بند لكل سطر: الوصف، الكمية، السعر"), long: true },
        { key: "tax", label: t("الضريبة"), placeholder: t("مثلاً: 15% ضريبة القيمة المضافة") },
        { key: "number", label: t("رقم الفاتورة والتاريخ"), placeholder: t("مثلاً: INV-0012، اليوم") },
      ],
      shape: "One sheet: seller, buyer, invoice number and date at the top; then a table with item, quantity, unit price and a line total as a formula (=B*C); then subtotal, tax and total as formulas. Currency in the column headers.",
    },
    {
      id: "deck",
      title: t("عرض تقديمي"),
      blurb: t("شرائح قصيرة وواضحة لاجتماع أو مشروع"),
      format: "PowerPoint",
      tool: "slides_write",
      file: t("عرض.pptx"),
      fields: [
        { key: "topic", label: t("موضوع العرض"), placeholder: t("مثلاً: خطة إطلاق تطبيقنا") },
        { key: "audience", label: t("لمين"), placeholder: t("مثلاً: الإدارة، العملاء، الفريق") },
        { key: "points", label: t("النقاط الأساسية"), placeholder: t("اللي لازم يطلع بالعرض"), long: true },
        { key: "slides", label: t("عدد الشرائح"), placeholder: t("مثلاً: 8") },
      ],
      shape: "A title slide, then one idea per slide with 3–5 short bullets, a table for any numbers, and a closing slide with the next steps or the ask. No paragraphs on slides.",
    },
  ];
}

/** The first message: what's known, what a good one has, and to ask before writing. */
export function templatePrompt(template: DocTemplate, values: Record<string, string>): string {
  const known = template.fields
    .map((f) => [f.label, (values[f.key] ?? "").trim()] as const)
    .filter(([, v]) => v)
    .map(([label, v]) => `- ${label}: ${v}`);
  const missing = template.fields.filter((f) => !(values[f.key] ?? "").trim()).map((f) => f.label);
  return [
    t("بدي {0} ({1}).", { 0: template.title, 1: template.format }),
    known.length ? `${t("اللي عندي:")}\n${known.join("\n")}` : "",
    missing.length
      ? t("ناقص: {0}. اسألني عن الناقص بقائمة قصيرة وحدة قبل ما تكتب، واقترح قيمة لكل سؤال لأقدر وافق بسرعة.", { 0: missing.join(t("، ")) })
      : t("إذا في شي مهم ناقص اسألني عنه بسؤال واحد، وإلا ابدأ."),
    `Format: ${template.shape}`,
    t("لما يكتمل، اكتبه بأداة {0} باسم «{1}».", { 0: template.tool, 1: template.file }),
  ]
    .filter(Boolean)
    .join("\n\n");
}
