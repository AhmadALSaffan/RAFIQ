/**
 * «دليل الاستعمال»: how Rafiq works, for someone who has never used an AI agent. Plain words,
 * an example for every idea, and a button to the place where it happens.
 */

import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { t } from "../i18n";
import { easeOutExpo } from "../lib/motion";
import { Illustration, type Scene } from "../components/Illustration";
import {
  AlertIcon,
  ChatIcon,
  FolderIcon,
  GlobeIcon,
  HelpIcon,
  ModelsIcon,
  MovieIcon,
  PaperclipIcon,
  PlugIcon,
  ShieldIcon,
  SparkIcon,
  TasksIcon,
  TerminalIcon,
  WalletIcon,
} from "../components/Icons";

type Section = {
  id: string;
  title: string;
  Icon: typeof ChatIcon;
  scene?: Scene;
  body: string[];
  points?: string[];
  example?: { label: string; text: string };
  go?: { label: string; to: string };
};

const START = [
  { n: "1", title: t("اربط موديل"), body: t("الموديل هو «العقل». سجّل دخول بحساب GitHub Copilot، أو حط مفتاح من شركة متل Anthropic أو OpenAI."), go: "/models", label: t("افتح النماذج") },
  { n: "2", title: t("اختار مجلد"), body: t("من زر المجلد فوق المحادثة اختار المجلد اللي بدك رفيق يشتغل فيه. ما بيلمس شي براته."), go: "/chat", label: t("افتح محادثة") },
  { n: "3", title: t("اكتب طلبك"), body: t("احكي معه متل ما بتحكي مع شخص: شو بدك، وكيف بدك ياه. هو بيخطط وبينفّذ وبيرجعلك."), go: "/chat", label: t("ابدأ") },
];

const SECTIONS: Section[] = [
  {
    id: "what",
    title: t("شو هو رفيق؟"),
    Icon: HelpIcon,
    scene: "welcome",
    body: [
      t("برامج المحادثة العادية بتحكي معك بس. رفيق بيحكي وبيشتغل: بيقرأ ملفاتك، بيكتب ملفات جديدة، بيشغّل برامج، بيتصفّح الإنترنت، وبيصمّم واجهات وفيديوهات — على جهازك."),
      t("فكّر فيه هيك: الموديل هو العقل اللي بيفكّر، ورفيق هو الإيدين والأدوات اللي بتخلّي هالعقل يعمل شي حقيقي. هالنوع من البرامج اسمه «وكيل» (Agent)."),
    ],
  },
  {
    id: "model",
    title: t("شو يعني موديل، ومن وين بجيبه؟"),
    Icon: ModelsIcon,
    scene: "models",
    body: [t("الموديل هو الذكاء الاصطناعي نفسه (متل Claude أو GPT أو Gemini). رفيق ما بيجي معه موديل — إنت بتختار واحد وبتربطه، وفي ثلاث طرق:")],
    points: [
      t("حساب GitHub Copilot: إذا عندك اشتراك، سجّل دخول بضغطة وخلص. أسهل طريقة."),
      t("مفتاح API: بتعمل حساب عند الشركة (Anthropic، OpenAI، Google…) وبتلصق المفتاح. بتدفع على قد ما بتستعمل."),
      t("موديل على جهازك: ببرنامج متل Ollama أو LM Studio. مجاني وما بيطلع شي من جهازك، بس بدو جهاز قوي."),
    ],
    go: { label: t("اربط موديل"), to: "/models" },
  },
  {
    id: "ask",
    title: t("كيف بطلب منه شي؟"),
    Icon: ChatIcon,
    scene: "chat",
    body: [t("اكتب بالعربي أو بأي لغة، متل ما بتشرح لزميل شاطر بس ما بيعرف شي عن شغلك. كل ما وضّحت أكتر، بيطلع الشغل أحسن.")],
    points: [
      t("قول شو بدك بالنتيجة، مش بس الخطوة: «بدي صفحة تعرض منتجاتي» أحسن من «اعمل ملف html»."),
      t("اعطيه أمثلة أو صور: ارفق صورة أو ملف بزر المشبك، أو اسحبه على المحادثة."),
      t("بالشغل الكبير قله «خطط أول وبعدين نفّذ» — بتشوف خطته قبل ما يبلّش."),
      t("إذا ما عجبك شي، قله شو الغلط بالضبط وهو بيصلّحه. ما في داعي تعيد من الأول."),
    ],
    example: { label: t("مثال"), text: t("بمجلد «فواتير» في ملفات PDF. اقرأها وطلّعلي جدول Excel فيه اسم الزبون والمبلغ والتاريخ، ورتّبه حسب التاريخ.") },
    go: { label: t("جرّب هلّق"), to: "/chat" },
  },
  {
    id: "folder",
    title: t("المجلد: وين بيشتغل"),
    Icon: FolderIcon,
    body: [
      t("كل محادثة إلها مجلد. رفيق بيقرأ وبيكتب جوّا هالمجلد بس — هيك بتعرف وين حيكون شغله، وما بيوصل لباقي ملفاتك."),
      t("لتغيّره: اضغط على اسم المجلد فوق المحادثة. إذا ما اخترت، بيشتغل بمجلد خاص فيه."),
    ],
  },
  {
    id: "permissions",
    title: t("هو ما بيعمل شي حسّاس بدون موافقتك"),
    Icon: ShieldIcon,
    body: [t("قبل ما يكتب ملف أو يشغّل أمر أو يعمل أي شي بيغيّر بجهازك، بتطلعلك بطاقة فيها شو بدو يعمل بالضبط، وإنت بتقرر:")],
    points: [
      t("«سماح» وهو بيكمّل الخطوة."),
      t("«رفض» وهو ما بيعملها، وبيشوف شو بيقدر يعمل بدالها أو بيسألك."),
      t("إذا وثقت بنوع معيّن (متل كتابة الملفات)، من الإعدادات ← الصلاحيات خلّيه «سماح تلقائي» وما عاد يسألك عليه."),
    ],
    go: { label: t("الصلاحيات"), to: "/settings?tab=permissions" },
  },
  {
    id: "watch",
    title: t("كيف بعرف شو عم يعمل؟"),
    Icon: TerminalIcon,
    body: [t("وهو شغّال، بيطلع تحت رده سطر بيقلك شو عم يعمل هلّق («عم يقرأ…»، «عم يشغّل…») وقديش صرله.")],
    points: [
      t("كل خطوة بتطلع بالمحادثة كبطاقة: شو الأداة، شو عطاها، وشو رجعتله."),
      t("لما يعمل ملف أو يشغّل أمر، بتنفتح لوحة جانبية: بتفتح الملف وبتشوفه (صفحة ويب بتشتغل، صورة، كود) وبتشوف الأوامر ونتايجها متل الطرفية."),
      t("بدك توقفه؟ زر الإيقاف مكان زر الإرسال."),
    ],
  },
  {
    id: "chat-or-task",
    title: t("محادثة ولا مهمة؟"),
    Icon: TasksIcon,
    scene: "tasks",
    body: [t("المحادثة للأخذ والرد. المهمة لشغلة طويلة بتعطيه ياها وبيخلصها لحاله بالخلفية — وفيك تشغّل كذا مهمة بنفس الوقت وتكمّل شغلك.")],
    points: [t("بالمحادثة اكتب # واسم مهمة لتشير عليها، أو اطلب منه يعمل مهام."), t("المهام المجدولة بتشتغل لحالها بوقت بتحدده (كل يوم الصبح مثلاً).")],
    go: { label: t("المهام"), to: "/tasks" },
  },
  {
    id: "files",
    title: t("الصور والملفات"),
    Icon: PaperclipIcon,
    body: [t("ارفق أي صورة أو PDF أو ملف نصي بزر المشبك أو بالسحب. أو اكتب @ واسم ملف من مجلد المحادثة.")],
    points: [
      t("الموديلات اللي بتشوف صور (Claude، GPT، Gemini) بتشوف الصورة نفسها. ما في شي تنزّله."),
      t("إذا موديلك ما بيشوف صور، اختار «موديل الرؤية» من الإعدادات ← الفيديو وهو بيوصفله الصور."),
    ],
  },
  {
    id: "more",
    title: t("شو كمان بيقدر يعمل؟"),
    Icon: SparkIcon,
    body: [t("غير المحادثة والمهام، في صفحات لشغل محدد:")],
    points: [
      t("التصاميم: بيصمّملك واجهة موقع أو تطبيق وبتشوفها حيّة قبل البرمجة."),
      t("موشن: فيديوهات موشن قرافك من وصف بالكلام، وبتصدّرها MP4."),
      t("الربط (MCP): بتوصله بخدمات متل GitHub وNotion وFigma ليشتغل عليها."),
      t("شغلي: مهامك من Jira وLinear وGitHub بمكان واحد، وبتسلّمه ياها."),
      t("الذاكرة: بيتذكّر شغلات عنك بين المحادثات (بتقدر تشوفها وتمسحها)."),
    ],
    go: { label: t("موشن"), to: "/motion" },
  },
  {
    id: "web",
    title: t("الإنترنت"),
    Icon: GlobeIcon,
    body: [t("بيقدر يقرأ صفحات ويدوّر على الإنترنت ليجيب معلومات محدّثة، ويفتح متصفح يضغط ويعبّي فيه — دايماً بإذنك.")],
  },
  {
    id: "cost",
    title: t("قديش بيكلّف؟"),
    Icon: WalletIcon,
    body: [t("رفيق نفسه مجاني. الكلفة من الموديل: مع Copilot ضمن اشتراكك، مع مفتاح API بتدفع للشركة على قد الاستعمال، والموديل المحلي مجاني.")],
    points: [t("صفحة التكلفة بتوريك قديش صرفت اليوم والشهر، وفيك تحط حد يومي."), t("المحادثات الطويلة بتكلّف أكتر — لخّصها بزر «لخّصها» لما يطلعلك.")],
    go: { label: t("التكلفة"), to: "/settings?tab=usage" },
  },
  {
    id: "integrations",
    title: t("وصّله بخدماتك"),
    Icon: PlugIcon,
    scene: "connect",
    body: [t("من الإعدادات ← MCP بتختار خدمة وبتسجّل دخول بضغطة — بعدها بيقدر يقرأ ويعدّل فيها بإذنك.")],
    go: { label: t("خوادم MCP"), to: "/settings?tab=mcp" },
  },
  {
    id: "trouble",
    title: t("لما شي ما يزبط"),
    Icon: AlertIcon,
    body: [t("أغلب المشاكل إلها حل بسيط:")],
    points: [
      t("وقف بالنص؟ اكتب «كمّل» وهو بيكمّل من وين وقف."),
      t("الرد ضعيف أو غلط؟ جرّب موديل أقوى من قائمة الموديلات تحت مربع الكتابة."),
      t("خطأ بالاتصال أو بالمفتاح؟ افتح النماذج، اضغط بالزر اليمين على الموديل واختار «افحص من جديد»."),
      t("شي تقني ما فهمته؟ الإعدادات ← السجلات فيها كل شي صار، فيك تنسخه وتبعته لحدا يساعدك."),
    ],
    go: { label: t("السجلات"), to: "/settings?tab=logs" },
  },
];

const KEYS: [string, string][] = [
  ["Ctrl + K", t("دوّر على أي شي بالتطبيق")],
  ["Enter", t("ابعت الرسالة")],
  ["Shift + Enter", t("سطر جديد")],
  ["/", t("أوامر المحادثة")],
  ["@", t("أشّر على ملف")],
  ["Ctrl + Shift + Space", t("سؤال سريع من أي مكان")],
  ["Ctrl + + / −", t("كبّر وصغّر النص")],
];

const WORDS: [string, string][] = [
  [t("موديل (Model)"), t("الذكاء الاصطناعي اللي بيفكّر ويكتب.")],
  [t("وكيل (Agent)"), t("موديل عنده أدوات بيقدر يعمل فيها شغل، متل رفيق.")],
  [t("أداة (Tool)"), t("شي بيعمله الوكيل: يقرأ ملف، يشغّل أمر، يدوّر بالإنترنت.")],
  [t("برومبت (Prompt)"), t("الرسالة أو التعليمات اللي بتكتبها للموديل.")],
  [t("توكن (Token)"), t("قطعة صغيرة من الكلام؛ الموديلات بتحسب الكلفة والطول فيها.")],
  [t("مهارة (Skill)"), t("تعليمات جاهزة بتعلّم الموديل شغلة محددة.")],
  ["MCP", t("طريقة لتوصيل الوكيل بخدمات تانية متل GitHub وNotion.")],
];

export function GuidePage() {
  const navigate = useNavigate();
  return (
    <div className="mx-auto flex w-full max-w-6xl gap-10 px-6 py-8">
      <nav className="sticky top-6 hidden h-fit w-52 shrink-0 lg:block" aria-label={t("محتوى الدليل")}>
        <p className="mb-2 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
          ( {t("المحتوى")} )
        </p>
        <ul className="flex flex-col gap-0.5 text-sm">
          {[...SECTIONS.map((s) => [s.id, s.title]), ["keys", t("اختصارات")], ["words", t("كلمات رح تشوفها")]].map(([id, title]) => (
            <li key={id}>
              <a href={`#guide-${id}`} onClick={(e) => (e.preventDefault(), document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }))} className="block rounded-lg px-2.5 py-1.5 transition-colors hover:bg-[var(--color-surface)]" style={{ color: "var(--color-ink-muted)" }}>
                {title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <article className="flex min-w-0 flex-1 flex-col gap-6">
        <header className="flex items-center gap-6">
          <Illustration scene="thinking" size={130} />
          <div>
            <h1 className="text-3xl font-bold">{t("كيف بيشتغل رفيق")}</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
              {t("ما بتحتاج تعرف شي عن الذكاء الاصطناعي. هالصفحة بتشرحلك كل شي بكلام بسيط، وكل فكرة معها زر بياخدك لمكانها.")}
            </p>
          </div>
        </header>

        <section aria-labelledby="guide-start" className="rounded-3xl p-6" style={{ background: "var(--color-inverse)", color: "var(--color-on-inverse)" }}>
          <h2 id="guide-start" className="text-lg font-bold">
            {t("ابدأ بثلاث خطوات")}
          </h2>
          <ol className="mt-4 grid gap-3 md:grid-cols-3">
            {START.map((s) => (
              <li key={s.n} className="flex flex-col gap-2 rounded-2xl p-4" style={{ background: "color-mix(in oklch, var(--color-on-inverse) 8%, transparent)" }}>
                <span className="num text-2xl font-bold" style={{ color: "var(--color-accent)" }} aria-hidden="true">
                  {s.n}
                </span>
                <h3 className="font-bold">{s.title}</h3>
                <p className="flex-1 text-sm leading-relaxed opacity-80">{s.body}</p>
                <button type="button" onClick={() => navigate(s.go)} className="self-start rounded-full px-3 py-1.5 text-xs font-medium" style={{ background: "var(--color-on-inverse)", color: "var(--color-inverse)" }}>
                  {s.label}
                </button>
              </li>
            ))}
          </ol>
        </section>

        {SECTIONS.map((s, i) => (
          <motion.section
            key={s.id}
            id={`guide-${s.id}`}
            aria-labelledby={`guide-${s.id}-title`}
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.35, ease: easeOutExpo, delay: i === 0 ? 0.05 : 0 }}
            className="scroll-mt-6 rounded-3xl p-6"
            style={{ background: "var(--color-surface)" }}
          >
            <div className="flex gap-5">
              <div className="min-w-0 flex-1">
                <h2 id={`guide-${s.id}-title`} className="flex items-center gap-2.5 text-lg font-bold">
                  <s.Icon className="h-5 w-5 shrink-0" style={{ color: "var(--color-ink-muted)" }} />
                  {s.title}
                </h2>
                {s.body.map((p, j) => (
                  <p key={j} className="mt-3 max-w-2xl text-[15px] leading-relaxed">
                    {p}
                  </p>
                ))}
                {s.points && (
                  <ul className="mt-3 flex max-w-2xl flex-col gap-2">
                    {s.points.map((p, j) => (
                      <li key={j} className="flex gap-2.5 text-[15px] leading-relaxed">
                        <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--color-accent)" }} aria-hidden="true" />
                        {p}
                      </li>
                    ))}
                  </ul>
                )}
                {s.example && (
                  <figure className="mt-4 max-w-2xl rounded-2xl p-4" style={{ background: "var(--color-surface-2)" }}>
                    <figcaption className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
                      ( {s.example.label} )
                    </figcaption>
                    <p className="mt-1 text-[15px] leading-relaxed">«{s.example.text}»</p>
                  </figure>
                )}
                {s.go && (
                  <button
                    type="button"
                    onClick={() => navigate(s.go!.to)}
                    className="mt-4 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--color-surface-2)]"
                    style={{ border: "1px solid var(--color-border)" }}
                  >
                    {s.go.label} ←
                  </button>
                )}
              </div>
              {s.scene && (
                <div className="hidden shrink-0 md:block">
                  <Illustration scene={s.scene} size={120} />
                </div>
              )}
            </div>
          </motion.section>
        ))}

        <section id="guide-keys" aria-labelledby="guide-keys-title" className="scroll-mt-6 rounded-3xl p-6" style={{ background: "var(--color-surface)" }}>
          <h2 id="guide-keys-title" className="text-lg font-bold">
            {t("اختصارات")}
          </h2>
          <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {KEYS.map(([key, what]) => (
              <div key={key} className="flex items-center justify-between gap-3 border-b py-1.5 text-sm" style={{ borderColor: "var(--color-border)" }}>
                <dt>{what}</dt>
                <dd>
                  <kbd className="rounded-md border px-1.5 py-0.5 font-mono text-xs" dir="ltr" style={{ borderColor: "var(--color-border)" }}>
                    {key}
                  </kbd>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="guide-words" aria-labelledby="guide-words-title" className="scroll-mt-6 rounded-3xl p-6" style={{ background: "var(--color-surface)" }}>
          <h2 id="guide-words-title" className="text-lg font-bold">
            {t("كلمات رح تشوفها")}
          </h2>
          <dl className="mt-3 flex flex-col gap-3">
            {WORDS.map(([word, meaning]) => (
              <div key={word}>
                <dt className="text-sm font-bold">{word}</dt>
                <dd className="text-sm leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
                  {meaning}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <p className="flex items-center gap-2 text-sm" style={{ color: "var(--color-ink-muted)" }}>
          <MovieIcon className="h-4 w-4" />
          {t("بعد ما تخلص الدليل، أحسن طريقة تتعلّم فيها: افتح محادثة واطلب منه شي صغير.")}
        </p>
      </article>
    </div>
  );
}
