/**
 * The first run: someone who just installed Rafiq — and may never have used an AI agent —
 * gets from nothing to a first answer without hunting through pages. Four steps: what Rafiq
 * is (and the language), connect a model, pick a folder, send a first message. Skippable at
 * every step; shown once, and never to someone who already has a model.
 */

import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { LOCALES, locale, setLocale, t } from "../i18n";
import { getSettings, getWorkspace, listModels, updateSettings } from "../lib/api";
import { queueChatSend } from "../lib/handoff";
import { openExternal } from "../lib/links";
import { easeOutExpo } from "../lib/motion";
import { roving } from "../lib/keyboard";
import type { LlmModel, Provider } from "../lib/types";
import { rememberModel } from "../features/chat/constants";
import { NewModelForm } from "../routes/ModelsPage";
import { FolderPicker } from "./FolderPicker";
import { Illustration, type Scene } from "./Illustration";
import { Button } from "./ui";
import { ExternalIcon, FolderIcon, GitIcon, LockIcon, ModelsIcon } from "./Icons";

type Step = 0 | 1 | 2 | 3;
const STEPS: { label: string; scene: Scene }[] = [
  { label: t("أهلا"), scene: "welcome" },
  { label: t("الموديل"), scene: "models" },
  { label: t("المجلد"), scene: "work" },
  { label: t("أول رسالة"), scene: "chat" },
];

const CHOICES: { provider: Provider; title: string; body: string; badge?: string; Icon: typeof GitIcon }[] = [
  { provider: "github_copilot", title: t("عندي حساب GitHub Copilot"), body: t("تسجيل دخول بضغطة، والكلفة ضمن اشتراكك."), badge: t("الأسهل"), Icon: GitIcon },
  { provider: "anthropic", title: t("عندي مفتاح API"), body: t("من Anthropic أو OpenAI أو Google أو غيرهم. بتدفع على قد ما بتستعمل."), Icon: LockIcon },
  { provider: "ollama", title: t("بدي موديل مجاني على جهازي"), body: t("بـ Ollama: ما بيطلع شي من جهازك، بس بدو جهاز قوي."), Icon: ModelsIcon },
];

export function FirstRun() {
  const location = useLocation();
  const [show, setShow] = useState(false);
  const [models, setModels] = useState<LlmModel[]>([]);

  useEffect(() => {
    let alive = true;
    Promise.all([getSettings(), listModels()])
      .then(([settings, list]) => {
        if (!alive) return;
        setModels(list);
        setShow(!settings.onboarded && list.length === 0);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!show || location.pathname === "/quick") return null;
  return <Welcome models={models} onModels={setModels} onDone={() => setShow(false)} />;
}

async function markDone(): Promise<void> {
  const settings = await getSettings();
  await updateSettings({ ...settings, onboarded: true });
}

function Welcome({ models, onModels, onDone }: { models: LlmModel[]; onModels: (m: LlmModel[]) => void; onDone: () => void }) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(0);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [folder, setFolder] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [message, setMessage] = useState(t("عرّفني على نفسك: شو بتقدر تعمل؟ وأعطيني ٣ أمثلة على شغل بتقدر تعمله إلي."));
  const model = models[models.length - 1];

  useEffect(() => {
    getWorkspace().then(setWorkspace).catch(() => undefined);
  }, []);

  async function skip() {
    await markDone().catch(() => undefined);
    onDone();
  }

  async function start() {
    const text = message.trim();
    if (!text || !model) return;
    rememberModel(model.id);
    queueChatSend(text, model.id, folder || null);
    await markDone().catch(() => undefined);
    onDone();
    navigate("/chat");
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 flex"
      style={{ zIndex: "var(--z-index-modal)" as unknown as number, background: "var(--color-bg)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-run-title"
    >
      {/* The one place the orange gradient is allowed: the welcome. */}
      <aside
        className="relative hidden w-[38%] max-w-md shrink-0 flex-col justify-between overflow-hidden p-10 md:flex"
        style={{ background: "linear-gradient(160deg, #f2a35e 0%, var(--color-accent) 45%, #dd7f30 100%)", color: "var(--color-accent-ink)" }}
      >
        <p className="text-lg font-bold">{t("رفيق")}</p>
        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.35, ease: easeOutExpo }} className="self-center">
            <Illustration scene={STEPS[step].scene} size={260} />
          </motion.div>
        </AnimatePresence>
        <ol className="flex flex-col gap-2" aria-label={t("الخطوات")}>
          {STEPS.map((s, i) => (
            <li key={s.label} className={`flex items-center gap-3 text-sm ${i === step ? "font-bold" : "font-medium"}`} aria-current={i === step ? "step" : undefined}>
              <span className="num flex h-6 w-6 items-center justify-center rounded-full text-xs" style={{ background: i <= step ? "var(--color-accent-ink)" : "transparent", color: i <= step ? "var(--color-accent)" : "var(--color-accent-ink)", border: "1.5px solid var(--color-accent-ink)" }}>
                {i + 1}
              </span>
              {s.label}
            </li>
          ))}
        </ol>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="flex justify-end p-4">
          <button type="button" onClick={() => void skip()} className="rounded-full px-3 py-1.5 text-sm transition-colors hover:bg-[var(--color-surface)]" style={{ color: "var(--color-ink-muted)" }}>
            {t("تخطّى")}
          </button>
        </div>
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 pb-16">
          <AnimatePresence mode="wait">
            <motion.section key={step} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.3, ease: easeOutExpo }}>
              {step === 0 && (
                <>
                  <h1 id="first-run-title" className="text-4xl font-extrabold leading-tight">
                    {t("أهلا برفيق")}
                  </h1>
                  <p className="mt-4 text-lg leading-relaxed">{t("رفيقك اللي بيشتغل معك على جهازك: بيقرأ ملفاتك وبيكتب ملفات جديدة، بيشغّل برامج، بيتصفّح الإنترنت، وبيصمّم — وما بيعمل شي حسّاس بدون إذنك.")}</p>
                  <p className="mt-3 leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
                    {t("خلال دقيقتين رح نجهّزه سوا: نربط «العقل» تبعه، نختار وين بيشتغل، وتبعتله أول رسالة.")}
                  </p>
                  <div ref={roving} role="radiogroup" aria-label={t("اللغة")} className="mt-6 flex w-fit gap-1 rounded-full p-1" style={{ background: "var(--color-surface)" }}>
                    {LOCALES.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        role="radio"
                        aria-checked={locale() === l.id}
                        onClick={() => setLocale(l.id)}
                        className="rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
                        style={{ background: locale() === l.id ? "var(--color-inverse)" : "transparent", color: locale() === l.id ? "var(--color-on-inverse)" : "var(--color-ink-muted)" }}
                      >
                        {l.name}
                      </button>
                    ))}
                  </div>
                  <div className="mt-8 flex gap-2">
                    <Button variant="accent" onClick={() => setStep(1)}>
                      {t("يلا نبلّش")}
                    </Button>
                  </div>
                </>
              )}

              {step === 1 && (
                <>
                  <h1 id="first-run-title" className="text-3xl font-extrabold">
                    {t("اربط موديل")}
                  </h1>
                  <p className="mt-3 leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
                    {t("الموديل هو الذكاء الاصطناعي اللي بيفكّر (متل Claude أو GPT). رفيق هو الإيدين اللي بتخلّيه يشتغل. اختار الطريقة اللي بتناسبك:")}
                  </p>
                  {model ? (
                    <div className="mt-6 flex flex-col gap-4">
                      <p className="rounded-2xl p-4 text-sm" style={{ background: "var(--color-surface)" }}>
                        {t("تمام! «{0}» جاهز.", { 0: model.name })}
                      </p>
                      <div className="flex gap-2">
                        <Button variant="accent" onClick={() => setStep(2)}>
                          {t("التالي")}
                        </Button>
                      </div>
                    </div>
                  ) : provider ? (
                    <div className="mt-6">
                      <NewModelForm
                        initialProvider={provider}
                        onCancel={() => setProvider(null)}
                        onCreated={(m) => {
                          onModels([...models, m]);
                          setStep(2);
                        }}
                      />
                      {provider === "ollama" && (
                        <button type="button" onClick={() => void openExternal("https://ollama.com/download")} className="mt-3 flex items-center gap-1 text-sm underline underline-offset-2" style={{ color: "var(--color-ink-muted)" }}>
                          {t("ما عندك Ollama؟ نزّله من هون")}
                          <ExternalIcon className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ) : (
                    <ul className="mt-6 flex flex-col gap-2">
                      {CHOICES.map((c) => (
                        <li key={c.provider}>
                          <button
                            type="button"
                            onClick={() => setProvider(c.provider)}
                            className="flex w-full items-start gap-3 rounded-2xl p-4 text-start transition-colors hover:bg-[var(--color-surface-2)]"
                            style={{ background: "var(--color-surface)" }}
                          >
                            <c.Icon className="mt-0.5 h-5 w-5 shrink-0" style={{ color: "var(--color-ink-muted)" }} />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2 font-medium">
                                {c.title}
                                {c.badge && (
                                  <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: "var(--color-accent)", color: "var(--color-accent-ink)" }}>
                                    {c.badge}
                                  </span>
                                )}
                              </span>
                              <span className="mt-0.5 block text-sm" style={{ color: "var(--color-ink-muted)" }}>
                                {c.body}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!model && (
                    <p className="mt-4 text-sm" style={{ color: "var(--color-ink-muted)" }}>
                      {t("مش متأكد؟ إذا عندك حساب GitHub مع Copilot، هاد أسهل شي. فيك تضيف غيره بعدين من صفحة النماذج.")}
                    </p>
                  )}
                  <BackLink onClick={() => (provider ? setProvider(null) : setStep(0))} />
                </>
              )}

              {step === 2 && (
                <>
                  <h1 id="first-run-title" className="text-3xl font-extrabold">
                    {t("وين بيشتغل؟")}
                  </h1>
                  <p className="mt-3 leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
                    {t("كل محادثة إلها مجلد. رفيق بيقرأ وبيكتب جوّاه بس، وما بيوصل لباقي ملفاتك. اختار مجلد مشروعك أو ملفاتك — أو خلّيه يشتغل بمجلده الخاص.")}
                  </p>
                  <div className="mt-6 rounded-2xl p-4" style={{ background: "var(--color-surface)" }}>
                    <FolderPicker value={folder} onChange={setFolder} />
                    {!folder && workspace && (
                      <p className="mt-3 flex items-center gap-2 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                        <FolderIcon className="h-3.5 w-3.5 shrink-0" />
                        {t("إذا ما اخترت، بيشتغل هون:")}
                        <bdi className="truncate font-mono" dir="ltr">
                          {workspace}
                        </bdi>
                      </p>
                    )}
                  </div>
                  <div className="mt-8 flex gap-2">
                    <Button variant="accent" onClick={() => setStep(3)}>
                      {t("التالي")}
                    </Button>
                  </div>
                  <BackLink onClick={() => setStep(1)} />
                </>
              )}

              {step === 3 && (
                <>
                  <h1 id="first-run-title" className="text-3xl font-extrabold">
                    {t("ابعتله أول رسالة")}
                  </h1>
                  <p className="mt-3 leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
                    {t("احكي معه متل ما بتحكي مع شخص. جرّب وحدة من هدول أو اكتب اللي ببالك:")}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {[
                      t("عرّفني على نفسك: شو بتقدر تعمل؟ وأعطيني ٣ أمثلة على شغل بتقدر تعمله إلي."),
                      t("شو في بهالمجلد؟ لخّصلي الملفات اللي فيه."),
                      t("اعملي ملف فيه خطة أسبوعية لتعلّم شي جديد."),
                    ].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setMessage(s)}
                        aria-pressed={message === s}
                        className="rounded-full px-3 py-1.5 text-start text-sm transition-colors"
                        style={{ background: message === s ? "var(--color-inverse)" : "var(--color-surface)", color: message === s ? "var(--color-on-inverse)" : "var(--color-ink)" }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={3}
                    aria-label={t("أول رسالة")}
                    className="input mt-4 w-full resize-none text-base"
                    dir="auto"
                  />
                  <div className="mt-6 flex flex-wrap items-center gap-3">
                    <Button variant="accent" onClick={() => void start()} disabled={!message.trim() || !model}>
                      {t("ابعت وبلّش")}
                    </Button>
                    <button type="button" onClick={() => void skip().then(() => navigate("/guide"))} className="text-sm underline underline-offset-2" style={{ color: "var(--color-ink-muted)" }}>
                      {t("اقرأ كيف بيشتغل رفيق أول")}
                    </button>
                  </div>
                  <BackLink onClick={() => setStep(2)} />
                </>
              )}
            </motion.section>
          </AnimatePresence>
        </div>
      </main>
    </motion.div>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mt-6 block text-sm" style={{ color: "var(--color-ink-muted)" }}>
      → {t("رجوع")}
    </button>
  );
}
