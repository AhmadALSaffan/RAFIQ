/**
 * Suggestions: what people want Rafiq to do next, and what went wrong. The message is
 * written here and leaves the way the user chooses — a GitHub issue ready to post, or an
 * email in their own mail program. Nothing is sent without them.
 */

import { useState } from "react";
import { motion } from "motion/react";
import { PageHeader } from "../components/Page";
import { Button } from "../components/ui";
import { RainbowButton } from "../components/easy/rainbow-button";
import { AlertIcon, ChatIcon, CheckCircleIcon, GitIcon, SparkIcon } from "../components/Icons";
import { FEEDBACK_EMAIL, issueUrl, mailUrl, systemLines, type FeedbackKind } from "../lib/feedback";
import { openExternal, openMail } from "../lib/links";
import { roving } from "../lib/keyboard";
import { listContainer, listItem } from "../lib/motion";
import { locale, t } from "../i18n";

const KINDS: { id: FeedbackKind; label: string; hint: string; Icon: typeof SparkIcon }[] = [
  { id: "idea", label: t("اقتراح ميزة"), hint: t("شي بتتمنى رفيق يعمله"), Icon: SparkIcon },
  { id: "bug", label: t("مشكلة"), hint: t("شي ما اشتغل متل ما لازم"), Icon: AlertIcon },
  { id: "other", label: t("شي تاني"), hint: t("رأي، سؤال، أو كلمة حلوة"), Icon: ChatIcon },
];

export function FeedbackPage() {
  const [kind, setKind] = useState<FeedbackKind>("idea");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [withSystem, setWithSystem] = useState(true);
  const [sent, setSent] = useState<"github" | "email" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = title.trim().length > 2 && details.trim().length > 5;
  const system = systemLines(__APP_VERSION__, navigator.userAgent, locale());
  const draft = { kind, title, details, withSystem };

  async function send(how: "github" | "email") {
    if (!ready) return;
    setError(null);
    try {
      if (how === "github") await openExternal(issueUrl(draft, system));
      else await openMail(mailUrl(draft, system));
      setSent(how);
    } catch {
      setError(how === "email" ? t("ما في برنامج إيميل مضبوط على جهازك. ابعت لـ {0} من أي مكان.", { 0: FEEDBACK_EMAIL }) : t("ما قدرت أفتح المتصفح."));
    }
  }

  const placeholder =
    kind === "bug" ? t("شو عملت، شو كنت متوقّع يصير، وشو صار فعلاً؟") : kind === "idea" ? t("شو الميزة؟ ولشو رح تستعملها؟") : t("اكتب اللي ببالك…");

  return (
    <motion.div variants={listContainer} initial="hidden" animate="show" className="mx-auto max-w-3xl px-5 py-8 lg:px-8">
      <PageHeader title={t("اقتراحاتك")} description={t("رفيق بيكبر من اللي بتطلبوه. اكتب اقتراحك أو المشكلة اللي صادفتك، وابعتها على GitHub أو بالإيميل — كل رسالة بتنقرا.")} scene="chat" />

      <motion.div variants={listItem} ref={roving} role="radiogroup" aria-label={t("نوع الرسالة")} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {KINDS.map((k) => {
          const on = kind === k.id;
          return (
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setKind(k.id)}
              className="flex items-start gap-3 rounded-2xl p-4 text-start transition-colors"
              style={{ background: on ? "var(--color-inverse)" : "var(--color-surface)", color: on ? "var(--color-on-inverse)" : undefined }}
            >
              <k.Icon className="mt-0.5 h-5 w-5 shrink-0" />
              <span>
                <span className="block text-[15px] font-bold" style={{ fontFamily: "var(--font-display)" }}>
                  {k.label}
                </span>
                <span className="block text-xs opacity-70">{k.hint}</span>
              </span>
            </button>
          );
        })}
      </motion.div>

      <motion.div variants={listItem} className="mt-3 flex flex-col gap-3 rounded-2xl p-5" style={{ background: "var(--color-surface)" }}>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t("العنوان")}</span>
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setSent(null);
            }}
            maxLength={120}
            placeholder={kind === "bug" ? t("مثلاً: المربع السريع ما بيفتح") : t("مثلاً: رفيق يقرأ ملفات Excel")}
            className="input w-full"
            dir={title ? "auto" : undefined}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t("التفاصيل")}</span>
          <textarea
            value={details}
            onChange={(e) => {
              setDetails(e.target.value);
              setSent(null);
            }}
            rows={7}
            maxLength={5000}
            placeholder={placeholder}
            className="input w-full resize-y leading-relaxed"
            dir={details ? "auto" : undefined}
          />
        </label>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <input type="checkbox" checked={withSystem} onChange={(e) => setWithSystem(e.target.checked)} className="mt-1 accent-[var(--color-accent)]" />
          <span>
            {t("ضيف معلومات النسخة")}
            <span className="num mt-0.5 block text-xs" style={{ color: "var(--color-ink-muted)" }} dir="ltr">
              {system}
            </span>
            <span className="block text-xs" style={{ color: "var(--color-ink-muted)" }}>
              {t("ما في شي تاني: لا ملفاتك ولا محادثاتك ولا مفاتيحك.")}
            </span>
          </span>
        </label>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <RainbowButton onClick={() => void send("github")} disabled={!ready}>
            <GitIcon className="h-4 w-4" />
            {t("ابعت على GitHub")}
          </RainbowButton>
          <Button variant="soft" onClick={() => void send("email")} disabled={!ready}>
            {t("ابعت بالإيميل")}
          </Button>
          {!ready && (title || details) && (
            <span className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
              {t("اكتب عنوان وكم سطر تفاصيل.")}
            </span>
          )}
        </div>
        <p className="text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
          {t("GitHub بيفتح صفحة الاقتراح جاهزة — بدها حساب GitHub، والاقتراحات هناك عامة. الإيميل بيفتح برنامج الإيميل عندك برسالة جاهزة لـ {0}.", { 0: FEEDBACK_EMAIL })}
        </p>
        {sent && (
          <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 text-sm" style={{ color: "var(--color-success)" }} role="status">
            <CheckCircleIcon className="h-4 w-4" />
            {sent === "github" ? t("فتحتلك الصفحة على GitHub — كبسة «Submit» وبيوصل. شكراً!") : t("فتحتلك الرسالة ببرنامج الإيميل — ابعتها من هناك. شكراً!")}
          </motion.p>
        )}
        {error && (
          <p className="text-sm" style={{ color: "var(--color-danger)" }} role="alert">
            {error}
          </p>
        )}
      </motion.div>
    </motion.div>
  );
}
