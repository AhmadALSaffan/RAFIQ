/**
 * An agent's Knowledge section (on its card in Models): the local folders it answers from,
 * how far each is indexed, and — said plainly — where their text goes. Only this agent can
 * search these folders; removing one stops its next search (agent core/agent_knowledge.py).
 */

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { AppSettings, KnowledgeBase, KnowledgeSource, LlmModel, Provider } from "../../lib/types";
import {
  attachKnowledgeFolder,
  detachKnowledgeFolder,
  getKnowledgeBase,
  getSettings,
  providerLabel,
  refreshKnowledgeFolder,
  updateSettings,
} from "../../lib/api";
import { pickFolder } from "../../lib/folders";
import { AlertIcon, ChevronDownIcon, FolderIcon, LockIcon, RefreshIcon, SpinnerIcon, TrashIcon } from "../../components/Icons";
import { Button } from "../../components/ui";
import { intlLocale, t } from "../../i18n";
import { easeOutExpo } from "../../lib/motion";

const BUSY = new Set(["queued", "indexing"]);

export function AgentKnowledge({ agent, agents }: { agent: LlmModel; agents: LlmModel[] }) {
  const [open, setOpen] = useState(false);
  const [base, setBase] = useState<KnowledgeBase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  const load = useCallback(() => {
    getKnowledgeBase(agent.id)
      .then((next) => {
        setBase(next);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [agent.id]);

  useEffect(load, [load]);
  // Watch the folders while one is being indexed.
  const busy = base?.sources.some((s) => BUSY.has(s.status)) ?? false;
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(load, 1500);
    return () => window.clearInterval(timer);
  }, [busy, load]);

  async function run(action: () => Promise<KnowledgeBase>) {
    try {
      setBase(await action());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function attach(path: string | null) {
    if (!path?.trim()) return;
    setTyped("");
    await run(() => attachKnowledgeFolder(agent.id, path.trim()));
  }

  const count = base?.sources.length ?? 0;
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md py-0.5 text-xs font-medium transition-colors hover:text-[var(--color-ink)]"
        style={{ color: "var(--color-ink-muted)" }}
      >
        <FolderIcon className="h-3.5 w-3.5" />
        {t("المعرفة")}
        <span className="num">{count > 0 ? t("· {0} مجلد", { 0: count }) : ""}</span>
        {busy && <SpinnerIcon className="h-3 w-3 animate-spin" />}
        <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: easeOutExpo }}
            className="overflow-hidden"
          >
            <div className="mt-2 flex flex-col gap-2 rounded-xl p-3" style={{ background: "var(--color-surface-2)" }}>
              <p className="text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
                {t("ضيف مجلدات من جهازك، وهالوكيل بيجاوب منها مع مصدر كل معلومة. ولا وكيل تاني بيقدر يقرأها إلا إذا ضفتها إله.")}{" "}
                {base && t("الصيغ: {0}.", { 0: base.formats.join(" ") })}
              </p>
              {base && base.sources.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {base.sources.map((source) => (
                    <SourceRow
                      key={source.id}
                      source={source}
                      onRefresh={() => void run(() => refreshKnowledgeFolder(agent.id, source.id))}
                      onRemove={() => void run(() => detachKnowledgeFolder(agent.id, source.id))}
                    />
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => void pickFolder().then(attach)}>
                  {t("ضيف مجلد")}
                </Button>
                <form
                  className="flex min-w-48 flex-1 items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void attach(typed);
                  }}
                >
                  <input
                    value={typed}
                    onChange={(e) => setTyped(e.currentTarget.value)}
                    placeholder={t("أو الصق مسار مجلد")}
                    aria-label={t("مسار المجلد")}
                    dir="ltr"
                    className="input h-8 min-w-0 flex-1 py-0 text-xs"
                  />
                  {typed.trim() && (
                    <Button variant="ghost" type="submit" className="px-2.5 py-1 text-xs">
                      {t("ضيف")}
                    </Button>
                  )}
                </form>
              </div>
              {error && (
                <p className="text-xs" style={{ color: "var(--color-danger)" }} role="alert">
                  {error === "folder not found" ? t("ما لقيت هالمجلد.") : error}
                </p>
              )}
              {base && <WhereTextGoes base={base} agents={agents} onSaved={load} />}
              {base && (
                <p className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
                  {t("الفهرس محفوظ على جهازك بـ")}{" "}
                  <span className="font-mono" dir="ltr">
                    {base.index_path}
                  </span>
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SourceRow({ source, onRefresh, onRemove }: { source: KnowledgeSource; onRefresh: () => void; onRemove: () => void }) {
  const busy = BUSY.has(source.status);
  const n = (v: number) => v.toLocaleString(intlLocale());
  return (
    <li className="flex items-start gap-2 rounded-lg px-2.5 py-2 text-xs" style={{ background: "var(--color-surface)" }}>
      <FolderIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--color-ink-muted)" }} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{source.name}</p>
        <p className="truncate font-mono text-[11px]" dir="ltr" title={source.path} style={{ color: "var(--color-ink-muted)" }}>
          {source.path}
        </p>
        <p className="mt-0.5" role="status" style={{ color: source.status === "error" ? "var(--color-danger)" : "var(--color-ink-muted)" }}>
          {busy
            ? source.status === "queued"
              ? t("بالدور للفهرسة…")
              : t("عم يفهرس…")
            : source.status === "error"
              ? t("ما قدر يفهرس: {0}", { 0: source.error === "folder not found" ? t("المجلد مش موجود") : (source.error ?? "") })
              : t("{0} ملف · {1} مقطع", { 0: n(source.files), 1: n(source.chunks) })}
          {!busy && source.status === "ready" && source.embedded > 0 && <span>{t(" · بالمعنى")}</span>}
        </p>
        {source.status === "ready" && source.error && (
          <p className="mt-0.5 flex items-center gap-1" style={{ color: "var(--color-pending)" }}>
            <AlertIcon className="h-3 w-3 shrink-0" />
            {t("البحث بالمعنى ما اشتغل، فهو بيدوّر بالكلمات بس: {0}", { 0: source.error.replace(/^embeddings: /, "") })}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={busy}
        aria-label={t("حدّث الفهرس")}
        title={t("حدّث الفهرس: الملفات اللي تغيّرت بتنقرأ من جديد، واللي انحذفت بتطلع منه")}
        className="rounded p-1 transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-40"
        style={{ color: "var(--color-ink-muted)" }}
      >
        <RefreshIcon className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("شيل المجلد من هالوكيل")}
        title={t("شيل المجلد من هالوكيل")}
        className="rounded p-1 transition-colors hover:bg-[var(--color-surface-2)]"
        style={{ color: "var(--color-ink-muted)" }}
      >
        <TrashIcon className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

/** Where the files' text may go: the embedding provider while indexing, the chat provider
 * when answering. Embeddings are one choice for every agent (they share one index). */
function WhereTextGoes({ base, agents, onSaved }: { base: KnowledgeBase; agents: LlmModel[]; onSaved: () => void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [model, setModel] = useState("");
  useEffect(() => {
    getSettings()
      .then((s) => {
        setSettings(s);
        setModel(s.rag_embedding_model ?? "");
      })
      .catch(() => setSettings(null));
  }, []);

  async function save(next: Partial<AppSettings>) {
    if (!settings) return;
    const saved = await updateSettings({ ...settings, ...next });
    setSettings(saved);
    onSaved();
  }

  const e = base.embedding;
  const value = e.mode === "agent" ? `agent:${settings?.rag_embedding_agent_id ?? ""}` : e.mode;
  const provider = (p: string | null) => (p ? providerLabel(p as Provider) : "");
  const sends = e.mode === "agent" && !e.local;
  return (
    <div className="flex flex-col gap-1.5 border-t pt-2 text-xs" style={{ borderColor: "var(--color-border)" }}>
      <p className="flex items-start gap-1.5" style={{ color: sends ? "var(--color-pending)" : "var(--color-ink-muted)" }}>
        {sends ? <AlertIcon className="mt-0.5 h-3 w-3 shrink-0" /> : <LockIcon className="mt-0.5 h-3 w-3 shrink-0" />}
        <span>
          {e.mode === "off"
            ? t("الفهرسة على جهازك بس، بالكلمات: ولا نص من ملفاتك بيطلع منه.")
            : e.mode === "ollama"
              ? t("المعنى بينحسب على جهازك بـ Ollama ({0}): ولا نص بيطلع منه.", { 0: e.model ?? "" })
              : e.local
                ? t("المعنى بينحسب على جهازك بـ {0} ({1}): ولا نص بيطلع منه.", { 0: e.agent_name ?? "", 1: e.model ?? "" })
                : t("وقت الفهرسة، نص الملفات بينبعت لـ {0} ({1}) ليحسب المعنى، وكل سؤال كمان وقت البحث.", { 0: provider(e.provider), 1: e.model ?? "" })}
        </span>
      </p>
      <p className="flex items-start gap-1.5" style={{ color: base.chat_local ? "var(--color-ink-muted)" : "var(--color-pending)" }}>
        {base.chat_local ? <LockIcon className="mt-0.5 h-3 w-3 shrink-0" /> : <AlertIcon className="mt-0.5 h-3 w-3 shrink-0" />}
        <span>
          {base.chat_local
            ? t("المقاطع اللي بيلاقيها بتضل على جهازك: هالوكيل محلي.")
            : t("لما يجاوب، المقاطع اللي بيلاقيها بتنبعت لـ {0} مع سؤالك ليكتب الرد.", { 0: provider(base.chat_provider) })}
        </span>
      </p>
      {settings && (
        <label className="mt-1 flex flex-wrap items-center gap-2" style={{ color: "var(--color-ink-muted)" }}>
          <span className="shrink-0">{t("البحث بالمعنى (لكل الوكلاء):")}</span>
          <select
            value={value}
            onChange={(ev) => {
              const v = ev.currentTarget.value;
              if (v.startsWith("agent:")) void save({ rag_embedding: "agent", rag_embedding_agent_id: v.slice(6), rag_embedding_model: null });
              else void save({ rag_embedding: v as "off" | "ollama", rag_embedding_agent_id: null, rag_embedding_model: null });
            }}
            className="input h-8 min-w-32 max-w-60 py-0 text-xs"
          >
            <option value="off">{t("بلا (كلمات بس)")}</option>
            <option value="ollama">{t("Ollama على جهازك (bge-m3)")}</option>
            {agents
              .filter((a) => a.provider !== "github_copilot")
              .map((a) => (
                <option key={a.id} value={`agent:${a.id}`}>
                  {t("عن طريق {0}", { 0: a.name })}
                </option>
              ))}
          </select>
          {e.mode !== "off" && (
            <input
              value={model}
              onChange={(ev) => setModel(ev.currentTarget.value)}
              onBlur={() => model !== (settings.rag_embedding_model ?? "") && void save({ rag_embedding_model: model.trim() || null })}
              placeholder={e.model ?? ""}
              aria-label={t("موديل المعنى")}
              dir="ltr"
              className="input h-8 w-44 py-0 font-mono text-xs"
            />
          )}
        </label>
      )}
    </div>
  );
}
