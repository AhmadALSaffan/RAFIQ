/**
 * «من نحن»: what Rafiq is, what it actually does, and who built it.
 *
 * Every claim here maps to something shipped in this build — the providers come from the
 * same list the Models page uses, the version from package.json. Nothing is decorative copy.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { PROVIDERS } from "../lib/providers";
import { easeOutExpo, listContainer, listItem, snappy } from "../lib/motion";
import { openExternal } from "../lib/links";
import { usePageMenu } from "../components/ContextMenu";
import { Logo } from "../components/Logo";
import { Wireframe } from "../components/brand";
import { BrandMark } from "../components/BrandMark";
import {
  ChatIcon,
  CopyIcon,
  ExternalIcon,
  InboxIcon,
  ModelsIcon,
  ShieldIcon,
  SparkIcon,
  TasksIcon,
} from "../components/Icons";
import { DrawnCheck } from "../components/ui";
import { UpdateCard } from "../features/updates/UpdateCard";

import { locale, t } from "../i18n";
const DEVELOPER = {
  // The name in the UI's language; the second line shows it in the other script.
  name: t("أحمد عليوي السفان"),
  nameAr: "أحمد عليوي السفان",
  nameEn: "Ahmed Eliwi AL Saffan",
  github: "https://github.com/AhmadALSaffan",
  handle: "AhmadALSaffan",
};

const FEATURES = [
  {
    Icon: ChatIcon,
    title: t("المحادثات"),
    to: "/chat",
    body: t("احكي معه متل ما بتحكي مع زميل. بيقرأ الملفات اللي بتشير عليها بـ @، بياخد صور ومرفقات، وعنده أوامر بـ / لتلخيص المحادثة وضبط الرد."),
  },
  {
    Icon: TasksIcon,
    title: t("المهام"),
    to: "/tasks",
    body: t("اعطيه شغلة وخلّيه يخلصها لحاله بمجلدك: بيقرأ ويكتب ملفات ويشغّل أوامر، وكذا مهمة بنفس الوقت، وبيوقف ياخد إذنك قبل أي خطوة حسّاسة."),
  },
  {
    Icon: SparkIcon,
    title: t("التصاميم"),
    to: "/designs",
    body: t("صمّم الواجهة قبل ما تبرمجها: أسئلة brief، مهارات تصميم مدمجة بتشتغل مع أي نموذج، معاينة حيّة، وزر يبعت التصميم للجلسة اللي رح تبرمجه."),
  },
  {
    Icon: InboxIcon,
    title: t("شغلي"),
    to: "/work",
    body: t("مهامك من Jira و Linear و GitHub و GitLab بمكان واحد. بتغيّر حالتها، بتعلّق عليها، وبتسلّمها لرفيق يشتغل عليها."),
  },
  {
    Icon: ModelsIcon,
    title: t("أي نموذج"),
    to: "/models",
    body: t("مش مربوط بشركة وحدة. حط مفتاحك لأي مزوّد، أو شغّل نموذج محلي على جهازك بـ Ollama."),
  },
  {
    Icon: ShieldIcon,
    title: t("إذنك أولاً"),
    to: "/settings",
    body: t("كل أداة إلها سياسة: اسأل، اسمح، أو امنع. المفاتيح محفوظة بمدير بيانات الاعتماد تبع ويندوز، ومحادثاتك ومهامك على جهازك."),
  },
] as const;

export function AboutPage() {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  function copyLink() {
    void navigator.clipboard.writeText(DEVELOPER.github);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  usePageMenu(() => [
    { id: "github", label: t("افتح صفحة المطوّر على GitHub"), onSelect: () => void openExternal(DEVELOPER.github) },
    { id: "copy-github", label: t("انسخ رابط GitHub"), onSelect: copyLink },
  ]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      {/* Hero — the mark, the name, one sentence, over a wireframe globe. */}
      <section className="relative flex flex-col items-center overflow-hidden rounded-2xl px-6 py-10 text-center" style={{ background: "var(--color-surface)" }}>
        <Wireframe size={260} className="pointer-events-none absolute -bottom-24 -end-16 opacity-25" />
        <motion.div
          initial={{ opacity: 0, scale: 0.8, rotate: -8 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 20 }}
        >
          <Logo className="h-20 w-20" />
        </motion.div>
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: easeOutExpo, delay: 0.08 }}
          className="mt-5 text-[34px] font-extrabold"
        >
          {t("رفيق")}
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: easeOutExpo, delay: 0.14 }}
          className="mt-2 max-w-lg text-base leading-relaxed"
          style={{ color: "var(--color-ink-muted)", textWrap: "balance" }}
        >
          {t("مساعد ذكي على ويندوز، بيحكي عربي وبيشتغل على جهازك — مش بس بيجاوب، بيخلّص الشغل.")}
        </motion.p>
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-4 rounded-full border px-3 py-1 text-xs tabular-nums"
          style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }}
          dir="ltr"
        >
          v{__APP_VERSION__}
        </motion.span>
      </section>

      <section className="mt-8">
        <UpdateCard />
      </section>

      {/* What it is, in plain words. */}
      <section className="mt-12">
        <SectionTitle>{t("شو هو رفيق؟")}</SectionTitle>
        <p className="text-sm leading-7" style={{ color: "var(--color-ink)" }}>
          {t("رفيق تطبيق سطح مكتب بيربطك بنماذج الذكاء الاصطناعي اللي بتختارها، وبيعطيها أدوات حقيقية تشتغل فيها: تقرأ وتكتب ملفات، تشغّل أوامر، وتتابع مهامك من أنظمة التتبّع. الواجهة عربية من الأساس ومن اليمين لليسار، والشغل كله بيصير على جهازك وتحت عينك — ما في خطوة حسّاسة بتصير من غير ما توافق عليها.")}
        </p>
      </section>

      {/* What it does — each item opens the page it describes. */}
      <section className="mt-10">
        <SectionTitle>{t("شو بيعمل")}</SectionTitle>
        <motion.ul
          variants={listContainer}
          initial="hidden"
          animate="show"
          className="grid gap-2 sm:grid-cols-2"
        >
          {FEATURES.map(({ Icon, title, body, to }) => (
            <motion.li key={title} variants={listItem}>
              <motion.button
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.99 }}
                transition={snappy}
                onClick={() => navigate(to)}
                className="group flex h-full w-full items-start gap-3 rounded-2xl px-4 py-3.5 text-start transition-colors hover:bg-[var(--color-surface-2)]"
                style={{ background: "var(--color-surface)" }}
              >
                <span
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors"
                  style={{ background: "var(--color-inverse)", color: "var(--color-on-inverse)" }}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="mt-1 block text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
                    {body}
                  </span>
                </span>
              </motion.button>
            </motion.li>
          ))}
        </motion.ul>
      </section>

      {/* The providers that actually ship — straight from the Models page's list. */}
      <section className="mt-10">
        <SectionTitle>{t("بيشتغل مع")}</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {PROVIDERS.filter((provider) => !provider.experimental).map((provider) => (
            <span
              key={provider.value}
              className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
              style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }}
            >
              <BrandMark provider={provider.value} className="h-3.5 w-3.5" />
              {provider.label}
            </span>
          ))}
        </div>
      </section>

      {/* The developer. */}
      <section className="mt-12">
        <SectionTitle>{t("المطوّر")}</SectionTitle>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: easeOutExpo, delay: 0.1 }}
          className="relative flex items-start gap-4 overflow-hidden rounded-2xl p-5"
          style={{ background: "var(--color-surface)" }}
        >
          <Avatar />
          <div className="relative min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-lg font-semibold" style={{ textWrap: "balance" }}>
              {DEVELOPER.name}
              <SyrianFlag />
            </p>
            <p className="mt-0.5 text-sm" style={{ color: "var(--color-ink-muted)" }}>
              {locale() === "ar" ? <bdi dir="ltr">{DEVELOPER.nameEn}</bdi> : <bdi dir="rtl">{DEVELOPER.nameAr}</bdi>}
            </p>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
              {t("صمّم رفيق وبناه — من الواجهة العربية لمحرّك الوكيل اللي بيشتغل بالخلفية.")}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <motion.button
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.97 }}
                transition={snappy}
                onClick={() => void openExternal(DEVELOPER.github)}
                className="flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-[var(--color-surface-2)]"
                style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }}
              >
                <BrandMark provider="github" className="h-4 w-4" />
                <span dir="ltr">{DEVELOPER.handle}</span>
                <ExternalIcon className="h-3.5 w-3.5 opacity-60" />
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={copyLink}
                aria-label={t("انسخ رابط GitHub")}
                title={t("انسخ الرابط")}
                className="rounded-lg border p-2 transition-colors hover:bg-[var(--color-surface-2)]"
                style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }}
              >
                {copied ? <DrawnCheck className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
              </motion.button>
            </div>
          </div>
        </motion.div>
      </section>

      <footer className="mt-12 flex flex-col items-center gap-1 text-center text-xs" style={{ color: "var(--color-ink-muted)" }}>
        <p>{t("مبني بـ Tauri و React و Python")}</p>
        <p>
          © {new Date().getFullYear()} {DEVELOPER.name}
        </p>
      </footer>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-xs font-semibold tracking-wide" style={{ color: "var(--color-ink-muted)" }}>
      {children}
    </h2>
  );
}

/**
 * The developer's GitHub picture. It needs the network, so it falls back to the name's
 * first letter on a tinted disc when offline — the card never shows a broken image.
 */
function Avatar() {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full text-2xl font-bold ring-2"
      style={{
        background: "var(--color-surface-2)",
        color: "var(--color-ink)",
        ["--tw-ring-color" as string]: "var(--color-border)",
      }}
    >
      {failed ? (
        t("أ")
      ) : (
        <img
          src={`${DEVELOPER.github}.png?size=160`}
          alt={DEVELOPER.name}
          className="h-full w-full object-cover"
          draggable={false}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

/** The green Syrian flag: green, white and black, three red stars. */
function SyrianFlag() {
  return (
    <svg viewBox="0 0 900 600" className="h-[0.95em] w-auto shrink-0 rounded-[3px] shadow-sm" role="img" aria-label={t("علم سوريا")}>
      <title>{t("علم سوريا")}</title>
      <rect width="900" height="200" fill="#007a3d" />
      <rect y="200" width="900" height="200" fill="#ffffff" />
      <rect y="400" width="900" height="200" fill="#000000" />
      <polygon points="250.0,234.0 264.8,279.6 312.8,279.6 274.0,307.8 288.8,353.4 250.0,325.2 211.2,353.4 226.0,307.8 187.2,279.6 235.2,279.6" fill="#ce1126" />
      <polygon points="450.0,234.0 464.8,279.6 512.8,279.6 474.0,307.8 488.8,353.4 450.0,325.2 411.2,353.4 426.0,307.8 387.2,279.6 435.2,279.6" fill="#ce1126" />
      <polygon points="650.0,234.0 664.8,279.6 712.8,279.6 674.0,307.8 688.8,353.4 650.0,325.2 611.2,353.4 626.0,307.8 587.2,279.6 635.2,279.6" fill="#ce1126" />
    </svg>
  );
}
