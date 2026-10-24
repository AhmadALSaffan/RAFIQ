/**
 * The dialog that tells the user exactly what to do about a failure they can fix
 * themselves: numbered steps, a small picture of what each step looks like, and the link
 * that gets them there. Opened by `showGuide` (lib/guides.ts) from anywhere a failure lands.
 */

import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "./ui";
import { XIcon } from "./Icons";
import { easeOutExpo } from "../lib/motion";
import { openExternal } from "../lib/links";
import {
  BILLING_PAGES,
  COPILOT_SETTINGS,
  KEY_PAGES,
  OLLAMA_DOWNLOAD,
  onGuide,
  showGuide,
  type GuideRequest,
} from "../lib/guides";
import { t } from "../i18n";

// ── Little pictures of each step ─────────────────────────────────────────────────────

function Cursor({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 56"
      className={`absolute h-6 w-5 ${className}`}
      aria-hidden
    >
      <path
        d="M3 3 L3 41 L12.5 32 L19 47 L25.5 44.2 L19.2 29.8 L32 29.8 Z"
        fill="#121212"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Browser({ url, children }: { url: string; children: ReactNode }) {
  return (
    <div
      className="overflow-hidden rounded-lg border"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-bg)",
      }}
      dir="ltr"
    >
      <div
        className="flex items-center gap-2 border-b px-2 py-1.5"
        style={{ borderColor: "var(--color-border)" }}
      >
        <span className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <i
              key={i}
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--color-border)" }}
            />
          ))}
        </span>
        <span
          className="flex-1 truncate rounded px-2 py-0.5 font-mono text-[10px]"
          style={{
            background: "var(--color-surface-2)",
            color: "var(--color-ink-muted)",
          }}
        >
          {url}
        </span>
      </div>
      <div className="relative p-3 text-[11px]">{children}</div>
    </div>
  );
}

function Highlight({ children }: { children: ReactNode }) {
  return (
    <span
      className="relative inline-flex items-center rounded-md px-2 py-1 font-medium"
      style={{
        boxShadow: "0 0 0 2px var(--color-accent)",
        background: "var(--color-surface)",
      }}
    >
      {children}
    </span>
  );
}

function CopilotMenuArt() {
  return (
    <Browser url="github.com/settings/copilot">
      <div className="flex justify-end">
        <div
          className="w-40 rounded-md border p-1.5"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-surface)",
          }}
        >
          <div className="mb-1 flex items-center gap-1.5 px-1">
            <i
              className="h-4 w-4 rounded-full"
              style={{ background: "var(--color-border)" }}
            />
            <span style={{ color: "var(--color-ink-muted)" }}>your-name</span>
          </div>
          <div
            className="px-1 py-0.5"
            style={{ color: "var(--color-ink-muted)" }}
          >
            Your profile
          </div>
          <div className="relative px-0.5 py-0.5">
            <Highlight>Copilot settings</Highlight>
            <Cursor className="-bottom-4 right-6" />
          </div>
          <div
            className="px-1 py-0.5"
            style={{ color: "var(--color-ink-muted)" }}
          >
            Settings
          </div>
        </div>
      </div>
    </Browser>
  );
}

function CopilotFreeArt() {
  return (
    <Browser url="github.com/settings/copilot">
      <p className="text-xs font-semibold">GitHub Copilot Free</p>
      <div className="my-2 space-y-1">
        <i
          className="block h-1.5 w-11/12 rounded"
          style={{ background: "var(--color-surface-2)" }}
        />
        <i
          className="block h-1.5 w-8/12 rounded"
          style={{ background: "var(--color-surface-2)" }}
        />
      </div>
      <span className="relative inline-flex">
        <span
          className="rounded-md px-2.5 py-1 text-[11px] font-semibold text-white"
          style={{
            background: "#1F883D",
            boxShadow: "0 0 0 2px var(--color-accent)",
          }}
        >
          Start using Copilot Free
        </span>
        <Cursor className="-bottom-4 -right-2" />
      </span>
    </Browser>
  );
}

function RafiqButtonArt({ label }: { label: string }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg border p-4"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-bg)",
      }}
    >
      <span className="relative">
        <span
          className="rounded-lg px-3 py-1.5 text-xs font-medium"
          style={{
            background: "var(--color-inverse)",
            color: "var(--color-on-inverse)",
          }}
        >
          {label}
        </span>
        <Cursor className="-bottom-5 -left-3" />
      </span>
    </div>
  );
}

function VpnArt() {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg border p-3"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-bg)",
      }}
    >
      <div>
        <p className="text-xs font-semibold" dir="ltr">
          VPN
        </p>
        <p className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
          {t("متصل · ألمانيا")}
        </p>
      </div>
      <span
        className="relative flex h-5 w-9 items-center rounded-full px-0.5"
        style={{ background: "#2E7D4F" }}
        dir="ltr"
      >
        <i className="ms-auto h-4 w-4 rounded-full bg-white" />
      </span>
    </div>
  );
}

function ResendArt() {
  return (
    <div
      className="flex items-center gap-2 rounded-lg border p-2.5"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-bg)",
      }}
    >
      <span
        className="flex-1 truncate text-[11px]"
        style={{ color: "var(--color-ink-muted)" }}
      >
        {t("نفس رسالتك…")}
      </span>
      <span
        className="relative grid h-6 w-6 place-items-center rounded-full text-xs text-white"
        style={{ background: "var(--color-accent)" }}
      >
        ↑
        <Cursor className="-bottom-5 -left-2" />
      </span>
    </div>
  );
}

function ChipsArt({ chips }: { chips: string[] }) {
  return (
    <div
      className="flex flex-wrap gap-1.5 rounded-lg border p-3"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-bg)",
      }}
    >
      {chips.map((c) => (
        <span
          key={c}
          className="rounded-full px-2.5 py-1 text-[11px]"
          style={{ background: "var(--color-surface-2)" }}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

function KeyArt() {
  return (
    <div
      className="space-y-2 rounded-lg border p-3"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-bg)",
      }}
    >
      <p className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
        {t("المفتاح")}
      </p>
      <div className="flex gap-2" dir="ltr">
        <span
          className="flex-1 rounded-md border px-2 py-1 font-mono text-[11px]"
          style={{ borderColor: "var(--color-accent)" }}
        >
          sk-••••••••••••••••
        </span>
        <span
          className="rounded-md px-2.5 py-1 text-[11px] font-medium"
          style={{
            background: "var(--color-inverse)",
            color: "var(--color-on-inverse)",
          }}
        >
          {t("احفظ")}
        </span>
      </div>
    </div>
  );
}

function BalanceArt() {
  return (
    <div
      className="flex items-center justify-between rounded-lg border p-3"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-bg)",
      }}
      dir="ltr"
    >
      <div>
        <p className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
          Balance
        </p>
        <p
          className="text-sm font-semibold"
          style={{ color: "var(--color-danger)" }}
        >
          $0.00
        </p>
      </div>
      <span
        className="relative rounded-md px-2.5 py-1 text-[11px] font-medium"
        style={{
          background: "var(--color-inverse)",
          color: "var(--color-on-inverse)",
          boxShadow: "0 0 0 2px var(--color-accent)",
        }}
      >
        Add credit
        <Cursor className="-bottom-5 -right-1" />
      </span>
    </div>
  );
}

function TerminalArt({ line }: { line: string }) {
  return (
    <div
      className="rounded-lg p-3 font-mono text-[11px]"
      style={{ background: "#141414", color: "#E9E9E6" }}
      dir="ltr"
    >
      <span style={{ color: "#96968E" }}>&gt; </span>
      {line}
      <span
        className="ms-0.5 inline-block h-3 w-1.5 align-middle"
        style={{ background: "#E68835" }}
      />
    </div>
  );
}

function ClockArt() {
  return (
    <div
      className="flex items-center justify-center gap-3 rounded-lg border p-3"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-bg)",
      }}
    >
      <span className="font-mono text-xl font-semibold" dir="ltr">
        0:59
      </span>
      <span className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
        {t("وبعدين جرّب")}
      </span>
    </div>
  );
}

// ── What each guide says ─────────────────────────────────────────────────────────────

interface Step {
  title: string;
  body: string;
  art?: ReactNode;
}

interface GuideContent {
  title: string;
  why: string;
  steps: Step[];
  notes?: string[];
  link?: { label: string; url: string };
}

function contentFor({ kind, provider }: GuideRequest): GuideContent {
  const who = provider || t("المزوّد");
  const isLmStudio = provider === "LM Studio";
  switch (kind) {
    case "copilot_not_enabled":
      return {
        title: t("فعّل GitHub Copilot على حسابك"),
        why: t(
          "تسجيل الدخول نجح، بس GitHub رفض طلب Copilot لأنه مش مفعّل على حسابك. التفعيل مجاني وبياخد دقيقة.",
        ),
        steps: [
          {
            title: t("افتح إعدادات Copilot بحسابك"),
            body: t(
              "الزر تحت بيفتحلك الصفحة مباشرة. أو من GitHub: صورتك فوق ← Copilot settings.",
            ),
            art: <CopilotMenuArt />,
          },
          {
            title: t("اكبس «Start using Copilot Free»"),
            body: t(
              "هي الخطة المجانية: فيها موديلات منيحة وحد شهري بيكفي للاستعمال العادي. وإذا عندك Copilot Pro، بيكون مفعّل أصلاً.",
            ),
            art: <CopilotFreeArt />,
          },
          {
            title: t("ارجع لرفيق وجرّب من جديد"),
            body: t(
              "ما في داعي تسجّل دخول مرة تانية. اختار الموديل وابعت رسالتك.",
            ),
            art: <RafiqButtonArt label={t("جرّب من جديد")} />,
          },
        ],
        notes: [
          t(
            "حسابك تابع لشركة أو جامعة؟ Copilot بيفعّله المسؤول عن الحساب، فاطلب منه.",
          ),
          t("فعّلته وضل نفس الشي؟ ممكن Copilot مش متاح ببلدك: شغّل VPN وجرّب."),
          t("حاولت تسجّل دخول كذا مرة ورا بعض؟ GitHub أحياناً بيرفض لدقايق. استنى شوي وجرّب، بدون ما تسجّل من جديد."),
        ],
        link: { label: t("افتح إعدادات Copilot"), url: COPILOT_SETTINGS },
      };
    case "region_blocked":
      return {
        title: t("{0} مش متاح من بلدك", { 0: who }),
        why: t(
          "{0} رفض الطلب لأنه ما بيقدّم الخدمة بمنطقتك. هاد مش خطأ برفيق ولا بمفتاحك.",
          { 0: who },
        ),
        steps: [
          {
            title: t("شغّل VPN على جهازك"),
            body: t(
              "أي VPN بيمشي. اختار بلد متل ألمانيا أو هولندا أو أمريكا، وخلّيه شغّال طول ما عم تستعمل هالموديل.",
            ),
            art: <VpnArt />,
          },
          {
            title: t("ارجع ابعت رسالتك"),
            body: t("نفس الرسالة، بدون ما تغيّر شي."),
            art: <ResendArt />,
          },
          {
            title: t("ما بدك VPN؟ في بدائل"),
            body: t(
              "موديل محلي متل Ollama بيشتغل على جهازك بدون نت، أو موديل متاح ببلدك متل DeepSeek أو GitHub Copilot.",
            ),
            art: (
              <ChipsArt
                chips={["Ollama · " + t("محلي"), "DeepSeek", "GitHub Copilot"]}
              />
            ),
          },
        ],
      };
    case "bad_key": {
      const page = provider ? KEY_PAGES[provider] : undefined;
      return {
        title: t("المفتاح ما عاد يشتغل"),
        why: t("{0} رفض المفتاح: يا إنه غلط، يا انلغى، يا انتهت صلاحيته.", {
          0: who,
        }),
        steps: [
          {
            title: t("اعمل مفتاح جديد عند {0}", { 0: who }),
            body: t(
              "من لوحة حسابك عند المزوّد، بصفحة API keys. انسخه كامل، بدون مسافات.",
            ),
            art: page ? (
              <Browser url={page.replace("https://", "")}>
                <Highlight>+ Create new key</Highlight>
              </Browser>
            ) : undefined,
          },
          {
            title: t("حطه برفيق"),
            body: t("النماذج ← الموديل ← تعديل ← الصق المفتاح الجديد واحفظ."),
            art: <KeyArt />,
          },
          {
            title: t("جرّب من جديد"),
            body: t("رفيق بيتأكد من المفتاح لحاله لما تحفظه."),
          },
        ],
        link: page ? { label: t("افتح صفحة المفاتيح"), url: page } : undefined,
      };
    }
    case "no_credit": {
      const page = provider ? BILLING_PAGES[provider] : undefined;
      return {
        title: t("رصيدك عند {0} خلص", { 0: who }),
        why: t(
          "الطلب وصل، بس حسابك عند {0} ما فيه رصيد. رفيق ما بياخد ولا قرش: الدفع بيروح للمزوّد مباشرة.",
          { 0: who },
        ),
        steps: [
          {
            title: t("اشحن رصيد"),
            body: t("من صفحة الفوترة عند المزوّد. أغلبهم بيقبلوا من 5 دولار."),
            art: <BalanceArt />,
          },
          {
            title: t("أو بدّل لموديل مجاني"),
            body: t(
              "GitHub Copilot فيه خطة مجانية، والموديلات المحلية ما بتكلّف شي.",
            ),
            art: (
              <ChipsArt
                chips={[
                  "GitHub Copilot Free",
                  "Ollama · " + t("محلي"),
                  "LM Studio · " + t("محلي"),
                ]}
              />
            ),
          },
          {
            title: t("اعرف وين راح الرصيد"),
            body: t(
              "الإعدادات ← التكلفة: فيها كل طلب وكم كلّف، وبتقدر تحط حد يومي.",
            ),
          },
        ],
        link: page ? { label: t("اشحن الرصيد"), url: page } : undefined,
      };
    }
    case "rate_limited":
      return {
        title: t("شوي شوي على {0}", { 0: who }),
        why: t(
          "انبعت لـ {0} طلبات كتير بوقت قصير، وطلب نستنى شوي. ما في شي خربان.",
          { 0: who },
        ),
        steps: [
          {
            title: t("استنى دقيقة وجرّب"),
            body: t("الحد بيرجع لحاله خلال ثواني أو دقيقة."),
            art: <ClockArt />,
          },
          {
            title: t("خلّي إله موديل احتياطي"),
            body: t(
              "النماذج ← الموديل ← «احتياطي»: إذا علق، بيكمّل التاني تلقائياً.",
            ),
          },
          {
            title: t("قلّل الشغل بنفس الوقت"),
            body: t(
              "الإعدادات ← المهام والنماذج ← حدود المزوّد: كم طلب بيروح بنفس اللحظة.",
            ),
          },
        ],
      };
    case "chatgpt_usage_limit":
      return {
        title: t("وصلت لحد استخدام ChatGPT"),
        why: t(
          "OpenAI وقّفت طلبات رفيق على خطتك لهلق: يا خلص الاستخدام المسموح للخطة، يا الحد اللي حاطّه لرفيق بالذات. حسابك سليم وما في شي خربان.",
        ),
        steps: [
          {
            title: t("شوف شو اللي خلص"),
            body: t("صفحة الاستخدام بـ ChatGPT بتقلك إذا خلص حد الخطة أو حد رفيق، وإيمتى بيرجع."),
            art: <ClockArt />,
          },
          {
            title: t("كمّل بموديل تاني هلق"),
            body: t("غيّر الموديل من القائمة تحت بالمحادثة، أو خلّي إله موديل احتياطي: النماذج ← الموديل ← «احتياطي»."),
          },
          {
            title: t("شوف حدّ رفيق بـ ChatGPT"),
            body: t("إذا الحد اللي حاطّه لرفيق هو اللي خلص، بتقدر ترفعه من إعدادات ChatGPT ← الاستخدام."),
          },
        ],
        link: { label: t("افتح صفحة الاستخدام"), url: "https://chatgpt.com/settings/usage" },
      };
    case "local_server_down":
      return {
        title: t("{0} مش شغّال", { 0: who }),
        why: t(
          "الموديل المحلي بيشتغل من برنامج على جهازك، والبرنامج لازم يكون مفتوح.",
        ),
        steps: [
          {
            title: t("شغّل {0}", { 0: who }),
            body: isLmStudio
              ? t("افتح LM Studio، ومن صفحة Developer اكبس Start Server.")
              : t("افتحه من قائمة ابدأ، أو اكتب الأمر هاد بالـ Terminal:"),
            art: isLmStudio ? undefined : <TerminalArt line="ollama serve" />,
          },
          {
            title: t("مش منزّله؟"),
            body: t(
              "نزّله من موقعه، وبعدين نزّل موديل منه (متل llama3 أو qwen).",
            ),
          },
          {
            title: t("جرّب من جديد"),
            body: t("رفيق بيلاقيه لحاله أول ما يشتغل."),
          },
        ],
        link: isLmStudio
          ? undefined
          : { label: t("نزّل Ollama"), url: OLLAMA_DOWNLOAD },
      };
    case "cant_reach":
      return {
        title: t("ما قدرت أوصل لـ {0}", { 0: who }),
        why: t(
          "الطلب ما وصل للمزوّد أبداً: يا النت مقطوع، يا الموقع محجوب عندك.",
        ),
        steps: [
          {
            title: t("تأكد من النت"),
            body: t("افتح أي موقع. إذا ما فتح، المشكلة بالاتصال."),
          },
          {
            title: t("ممكن يكون محجوب ببلدك أو بشبكتك"),
            body: t(
              "شغّل VPN وجرّب. بعض المزوّدين محجوبين كمان بشبكات الشركات والجامعات.",
            ),
            art: <VpnArt />,
          },
          {
            title: t("بتستعمل Base URL خاص؟"),
            body: t("تأكد إنه العنوان صحيح بصفحة النماذج، وإنه السيرفر شغّال."),
          },
        ],
      };
    case "model_not_found":
      return {
        title: t("هالموديل مش موجود عند {0}", { 0: who }),
        why: t("يا إنه اسم الموديل تغيّر، يا إنه حسابك ما بيوصله."),
        steps: [
          {
            title: t("اختار موديل من القائمة"),
            body: t(
              "النماذج ← أضف نموذج: رفيق بيجيبلك الموديلات المتاحة لحسابك بالضبط، فما بتغلط بالاسم.",
            ),
          },
          {
            title: t("إذا موديل جديد"),
            body: t(
              "بعض المزوّدين بيفعّلوا الموديلات الجديدة تدريجياً، أو بدهم تفعيلها من لوحة حسابك.",
            ),
          },
        ],
      };
  }
}

// ── The dialog ───────────────────────────────────────────────────────────────────────

export function GuideDialog() {
  const [request, setRequest] = useState<GuideRequest | null>(null);

  useEffect(() => {
    const off = onGuide(setRequest);
    // Development only: open a guide from the console to see it (`__showGuide({kind:…})`).
    if (import.meta.env.DEV)
      (window as unknown as { __showGuide?: typeof showGuide }).__showGuide =
        showGuide;
    return off;
  }, []);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setRequest(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request]);

  const content = request ? contentFor(request) : null;
  const close = () => setRequest(null);

  return (
    <AnimatePresence>
      {request && content && (
        <motion.div
          key="guide"
          className="fixed inset-0 flex items-center justify-center p-6"
          style={{
            zIndex: "var(--z-index-modal)" as unknown as number,
            background: "rgba(0,0,0,0.45)",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={close}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="guide-title"
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.96, y: 12, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.97, opacity: 0, transition: { duration: 0.15 } }}
            transition={{ duration: 0.28, ease: easeOutExpo }}
            className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border shadow-2xl"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-surface)",
            }}
          >
            <div className="flex items-start justify-between gap-3 px-6 pt-5">
              <div>
                <h2 id="guide-title" className="text-lg font-semibold">
                  {content.title}
                </h2>
                <p
                  className="mt-1 text-sm leading-6"
                  style={{ color: "var(--color-ink-muted)" }}
                >
                  {content.why}
                </p>
              </div>
              <button
                onClick={close}
                aria-label={t("إغلاق")}
                className="rounded-full p-1 transition-colors hover:bg-[var(--color-surface-2)]"
                style={{ color: "var(--color-ink-muted)" }}
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 overflow-y-auto pb-1">
              <ol className="flex flex-col gap-4 px-6 pb-2">
                {content.steps.map((step, i) => (
                  <li
                    key={step.title}
                    className="grid grid-cols-[28px_1fr] gap-3"
                  >
                    <span
                      className="grid h-7 w-7 place-items-center rounded-full text-xs font-semibold"
                      style={{
                        background: "var(--color-inverse)",
                        color: "var(--color-on-inverse)",
                      }}
                    >
                      {i + 1}
                    </span>
                    <div className="flex flex-col gap-2">
                      <p className="text-sm font-semibold">{step.title}</p>
                      <p
                        className="text-xs leading-6"
                        style={{ color: "var(--color-ink-muted)" }}
                      >
                        {step.body}
                      </p>
                      {step.art}
                    </div>
                  </li>
                ))}
              </ol>

              {content.notes && (
                <ul
                  className="mx-6 mt-2 flex flex-col gap-1.5 rounded-xl px-4 py-3 text-xs leading-6"
                  style={{ background: "var(--color-surface-2)" }}
                >
                  {content.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
            </div>

            <div
              className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t px-6 py-4"
              style={{ borderColor: "var(--color-border)" }}
            >
              <Button variant="ghost" onClick={close}>
                {t("سكّر")}
              </Button>
              {request.onRetry && (
                <Button
                  variant={content.link ? "soft" : "primary"}
                  onClick={() => {
                    close();
                    request.onRetry?.();
                  }}
                >
                  {t("جرّب من جديد")}
                </Button>
              )}
              {content.link && (
                <Button
                  variant="accent"
                  onClick={() => void openExternal(content.link!.url)}
                >
                  {content.link.label}
                </Button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
