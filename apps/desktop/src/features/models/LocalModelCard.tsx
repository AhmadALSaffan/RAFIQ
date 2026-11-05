/**
 * A free model on this computer, with one click (agent core/local_model.py): Rafiq installs
 * Ollama on Windows (the official installer, signature checked), downloads a model that speaks
 * Arabic and uses tools, and adds it to the list. On a Mac the user installs Ollama from its
 * site and Rafiq does the rest.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { freeModelStatus, installOllama, pullFreeModel, type LocalJob, type LocalModelStatus } from "../../lib/api";
import { openExternal } from "../../lib/links";
import { Button, ErrorText } from "../../components/ui";
import { SpinnerIcon } from "../../components/Icons";
import { t } from "../../i18n";

const BUSY = new Set(["downloading", "checking", "installing", "starting", "adding", "pulling manifest", "verifying sha256 digest", "writing manifest"]);

function busy(job: LocalJob | null): boolean {
  return Boolean(job && job.status !== "done" && job.status !== "error");
}

function percent(job: LocalJob | null): number | null {
  return job && job.total > 0 ? Math.min(100, Math.round((job.completed / job.total) * 100)) : null;
}

export function LocalModelCard({ onAdded }: { onAdded: () => void }) {
  const [info, setInfo] = useState<LocalModelStatus | null>(null);
  const [tag, setTag] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  // Set when the user asked for install-then-download: the download starts once Ollama is up.
  const wanted = useRef<string | null>(null);
  const reported = useRef<string | null>(null);
  const added = useRef(onAdded);
  added.current = onAdded;

  const load = useCallback(async () => {
    try {
      const next = await freeModelStatus();
      setInfo(next);
      setTag((current) => current || next.suggested);
      if (wanted.current && next.install?.status === "done" && !busy(next.pull)) {
        const pending = wanted.current;
        wanted.current = null;
        await pullFreeModel(pending);
      }
      if (next.pull?.status === "done" && next.pull.model_id && reported.current !== next.pull.model_id) {
        reported.current = next.pull.model_id;
        added.current();
      }
      if (next.install?.status === "error" || next.pull?.status === "error") wanted.current = null;
    } catch {
      setInfo(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const working = busy(info?.install ?? null) || busy(info?.pull ?? null) || wanted.current !== null;
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => void load(), 1000);
    return () => clearInterval(timer);
  }, [working, load]);

  if (!info) return null;
  const have = info.recommended.filter((m) => info.models.some((name) => name === m.tag || name.startsWith(`${m.tag}`)));
  const job = busy(info.pull) ? info.pull : busy(info.install) ? info.install : null;
  const failed = info.pull?.status === "error" ? info.pull.error : info.install?.status === "error" ? info.install.error : null;
  const done = info.pull?.status === "done";

  async function go() {
    setError(null);
    try {
      if (info?.running || info?.installed) {
        await pullFreeModel(tag);
      } else if (info?.can_install) {
        wanted.current = tag;
        await installOllama();
      } else {
        await openExternal(info!.download_page);
        return;
      }
      await load();
    } catch (e) {
      wanted.current = null;
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const stepLabel: Record<string, string> = {
    downloading: t("عم ينزّل…"),
    checking: t("عم يتأكد من توقيع المثبّت…"),
    installing: t("عم يثبّت Ollama…"),
    starting: t("عم يشغّل Ollama…"),
    adding: t("عم يضيف الموديل لرفيق…"),
  };
  const pct = percent(job);

  return (
    <section className="mb-6 rounded-2xl px-5 py-4" style={{ background: "var(--color-surface)" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <h2 className="text-[15px] font-bold">{t("نموذج مجاني على جهازك")}</h2>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
            {t("بدون مفتاح ولا بطاقة: رفيق بيثبّت Ollama وبينزّل موديل بيحكي عربي وبيستخدم الأدوات، وكله بيشتغل على جهازك.")}
          </p>
        </div>
        {done || have.length > 0 ? (
          <p className="text-xs font-medium" style={{ color: "var(--color-success)" }}>
            {t("عندك موديل محلي جاهز")}
          </p>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2" role="radiogroup" aria-label={t("اختار الموديل")}>
        {info.recommended.map((m) => {
          const selected = tag === m.tag;
          const tight = info.ram_gb < m.min_ram_gb;
          return (
            <button
              key={m.tag}
              role="radio"
              aria-checked={selected}
              disabled={working}
              onClick={() => setTag(m.tag)}
              className="rounded-xl border px-3 py-2 text-start text-xs transition-colors"
              style={{ borderColor: selected ? "var(--color-accent)" : "var(--color-border)", background: selected ? "var(--color-surface-2)" : "transparent" }}
            >
              <span className="block font-medium" dir="ltr">
                {m.name}
              </span>
              <span className="block" style={{ color: tight ? "var(--color-pending)" : "var(--color-ink-muted)" }}>
                {t("{0} GB تنزيل · بده {1} GB ذاكرة", { 0: String(m.size_gb), 1: String(m.min_ram_gb) })}
              </span>
            </button>
          );
        })}
        <Button variant="accent" onClick={() => void go()} disabled={working || !tag} className="ms-auto">
          {working ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : null}
          {info.installed || info.running
            ? t("حمّل الموديل")
            : info.can_install
              ? t("ثبّت وحمّل")
              : t("افتح موقع Ollama")}
        </Button>
      </div>

      {!info.installed && !info.can_install && (
        <p className="mt-2 text-xs" style={{ color: "var(--color-ink-muted)" }}>
          {t("ثبّت Ollama من موقعه وشغّله، وبعدين ارجع لهون واكبس «حمّل الموديل».")}
        </p>
      )}

      {job && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs" style={{ color: "var(--color-ink-muted)" }}>
            <span>{stepLabel[job.status] ?? (BUSY.has(job.status) ? t("عم يحضّر…") : job.status)}</span>
            {pct !== null && <span dir="ltr">{pct}%</span>}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--color-surface-2)" }}>
            <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct ?? 8}%`, background: "var(--color-accent)" }} />
          </div>
        </div>
      )}
      <div className="mt-2">
        <ErrorText message={failed || error} />
      </div>
    </section>
  );
}
