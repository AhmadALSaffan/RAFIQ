import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { createDesign, deleteDesign, getDesign, initQuestions, listDesigns, listModels, listSkills } from "../lib/api";
import type { AgentSkill, DesignSummary, InitQuestion, LlmModel } from "../lib/types";
import { easeOutExpo, listContainer, listItem, snappy } from "../lib/motion";
import { timeAgo } from "../lib/time";
import { BrandMark } from "../components/BrandMark";
import { Button, EmptyState } from "../components/ui";
import { AlertIcon, FolderIcon, PlusIcon, SparkIcon, TrashIcon, XIcon } from "../components/Icons";
import { FolderChip } from "../components/FolderPicker";
import { useElementMenu, usePageMenu } from "../components/ContextMenu";
import { PageHeader, RefreshButton } from "../components/Page";
import { folderName } from "../lib/folders";
import { fieldDir } from "../lib/bidi";

import { SkillsSection } from "../features/design/SkillsSection";
import { useWorkspaces } from "../lib/workspace";

import { t } from "../i18n";
/** Cheap live thumbnail: the real document, scaled down and inert. */
function Thumb({ html }: { html: string | null }) {
  if (!html) {
    return (
      <div
        className="flex h-36 items-center justify-center rounded-lg border text-xs"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface-2)", color: "var(--color-ink-muted)" }}
      >
        {t("لسا ما في معاينة")}
      </div>
    );
  }
  return (
    <div
      className="relative h-36 overflow-hidden rounded-lg border"
      style={{ borderColor: "var(--color-border)", background: "white" }}
    >
      <iframe
        srcDoc={html}
        title={t("معاينة")}
        tabIndex={-1}
        sandbox="allow-scripts"
        className="pointer-events-none absolute start-0 top-0 origin-top-right"
        style={{ width: "1200px", height: "900px", transform: "scale(0.28)", transformOrigin: "top right", border: 0 }}
      />
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  draft: t("قيد التصميم"),
  ready: t("جاهز"),
  handed_off: t("انبعت للبرمجة"),
};

const STATUS_COLOR: Record<string, string> = {
  draft: "var(--color-accent)",
  ready: "var(--color-success)",
  handed_off: "var(--color-ink-muted)",
};

export function DesignsPage() {
  const navigate = useNavigate();
  // `?new=1` (from Ctrl+K) opens the new-design wizard; the flag then leaves the URL.
  const [params, setParams] = useSearchParams();
  const askedNew = params.get("new") === "1";
  const [designs, setDesigns] = useState<DesignSummary[]>([]);
  const [previews, setPreviews] = useState<Record<string, string | null>>({});
  const [models, setModels] = useState<LlmModel[]>([]);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizard, setWizard] = useState(false);
  useEffect(() => {
    if (!askedNew) return;
    setWizard(true);
    setParams((p) => {
      p.delete("new");
      return p;
    }, { replace: true });
  }, [askedNew, setParams]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { currentId: workspaceId } = useWorkspaces();

  const loadDesigns = useCallback(async () => {
    setRefreshing(true);
    try {
      const list = await listDesigns(workspaceId);
      setDesigns(list);
      setError(null);
      const withPreview = await Promise.all(
        list.filter((d) => d.has_preview).slice(0, 12).map((d) => getDesign(d.id).catch(() => null)),
      );
      setPreviews(Object.fromEntries(withPreview.filter(Boolean).map((d) => [d!.id, d!.preview_html])));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ما قدرت أجيب التصاميم"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [workspaceId]);

  const loadSkills = useCallback(() => {
    listSkills().then(setSkills).catch(() => setSkills([]));
  }, []);

  useEffect(() => {
    listModels().then(setModels).catch(() => setModels([]));
    loadSkills();
    void loadDesigns();
  }, [loadDesigns, loadSkills]);

  const usable = models.filter((m) => m.verify_ok !== false);
  const menu = useElementMenu();

  usePageMenu(() => [
    { id: "new-design", label: t("تصميم جديد"), onSelect: () => setWizard(true), disabled: usable.length === 0 },
    { id: "refresh", label: t("حدّث القائمة"), onSelect: () => void loadDesigns() },
  ]);

  async function remove(id: string) {
    setDesigns((prev) => prev.filter((d) => d.id !== id));
    await deleteDesign(id).catch(() => undefined);
  }

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        title={t("التصاميم")}
        description={t("صمّم الواجهة قبل ما تبرمجها: رفيق بيسألك أسئلة الـ brief، بيقرأ مهارات التصميم المدمجة، بيعطيك معاينة حيّة تناقشه فيها، ولما تجهز بتبعتها للجلسة اللي رح تبرمجها.")}
        actions={
          <>
            <RefreshButton spinning={refreshing} onClick={() => void loadDesigns()} />
            <Button onClick={() => setWizard(true)} disabled={usable.length === 0}>
              <PlusIcon className="h-4 w-4" />
              {t("تصميم جديد")}
            </Button>
          </>
        }
      />

      {usable.length === 0 && !loading && (
        <p className="mb-4 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }}>
          <AlertIcon className="h-4 w-4 shrink-0" />
          {t("أضف نموذج شغّال أولاً من صفحة النماذج.")}
        </p>
      )}

      {error && (
        <p className="mb-4 rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
          {error}
        </p>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="shimmer h-56 rounded-xl" />
          ))}
        </div>
      ) : designs.length === 0 ? (
        <EmptyState
          icon={<SparkIcon className="h-8 w-8" />}
          text={t("ما في تصاميم بعد. اضغط «تصميم جديد» وجاوب على تسع أسئلة — بعدها بتفتحلك جلسة تصميم فيها شات ومعاينة حيّة.")}
          action={
            usable.length > 0 ? <Button onClick={() => setWizard(true)}>{t("تصميم جديد")}</Button> : undefined
          }
        />
      ) : (
        <motion.div variants={listContainer} initial="hidden" animate="show" className="grid gap-4 sm:grid-cols-2">
          <AnimatePresence initial={false}>
          {designs.map((design) => (
            <motion.div
              key={design.id}
              variants={listItem}
              exit="exit"
              layout="position"
              whileHover={{ y: -3 }}
              transition={snappy}
              className="group relative flex cursor-pointer flex-col gap-3 overflow-hidden rounded-xl border p-3"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
              onClick={() => navigate(`/designs/${design.id}`)}
              onContextMenu={menu(() => [
                { id: "open", label: t("افتح التصميم"), onSelect: () => navigate(`/designs/${design.id}`) },
                {
                  id: "copy-html",
                  label: t("انسخ كود الواجهة"),
                  disabled: !previews[design.id],
                  onSelect: () => void navigator.clipboard.writeText(previews[design.id] ?? ""),
                },
                { id: "delete", label: t("احذف التصميم"), onSelect: () => void remove(design.id), danger: true },
              ])}
            >
              <span
                className="absolute inset-x-0 top-0 h-0.5"
                style={{ background: STATUS_COLOR[design.status] ?? "var(--color-border)" }}
                aria-hidden
              />
              <Thumb html={previews[design.id] ?? null} />
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" dir="auto">
                    {design.title}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                    {models.find((m) => m.id === design.model_id) && (
                      <BrandMark provider={models.find((m) => m.id === design.model_id)!.provider} className="h-3 w-3" />
                    )}
                    {timeAgo(design.updated_at)}
                  </p>
                </div>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[11px]"
                  style={{
                    background: design.status === "ready" ? "color-mix(in oklch, var(--color-success) 14%, transparent)" : "var(--color-surface-2)",
                    color: design.status === "ready" ? "var(--color-success)" : "var(--color-ink-muted)",
                  }}
                >
                  {STATUS_LABEL[design.status] ?? design.status}
                </span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void remove(design.id);
                }}
                aria-label={t("احذف التصميم")}
                title={t("احذف التصميم")}
                className="absolute end-2 top-2 rounded-md p-1.5 opacity-0 transition-opacity group-hover:opacity-100"
                style={{ background: "var(--color-surface-2)", color: "var(--color-ink-muted)" }}
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          ))}
          </AnimatePresence>
        </motion.div>
      )}

      <SkillsSection skills={skills} onChange={loadSkills} />

      <AnimatePresence>
        {wizard && (
          <InitWizard
            models={usable}
            onClose={() => setWizard(false)}
            onDone={(id) => navigate(`/designs/${id}`)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** `/impeccable init` — the brief, asked once, before the design chat opens. */
function InitWizard({ models, onClose, onDone }: { models: LlmModel[]; onClose: () => void; onDone: (id: string) => void }) {
  const [questions, setQuestions] = useState<InitQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const { current: workspace, currentId: workspaceId } = useWorkspaces();
  const [modelId, setModelId] = useState(models.find((m) => m.id === workspace?.model_id)?.id ?? models[0]?.id ?? "");
  const [folder, setFolder] = useState<string | null>(workspace?.working_dir ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null = whatever suits the model; the switch below makes it an explicit yes or no.
  const [webSearch, setWebSearch] = useState<boolean | null>(null);

  useEffect(() => {
    initQuestions().then(setQuestions).catch(() => setError(t("ما قدرت أجيب الأسئلة")));
  }, []);

  // A model that searches the web itself doesn't get Rafiq's tool unless asked to.
  const ownsSearch = Boolean(models.find((m) => m.id === modelId)?.native_tools?.includes("web_search"));
  const searchOn = webSearch ?? !ownsSearch;

  const missing = questions.filter((q) => q.required && !answers[q.id]).map((q) => q.id);
  const answered = questions.filter((q) => answers[q.id]).length;

  function set(id: string, value: string | string[]) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  function toggle(id: string, option: string) {
    const current = (answers[id] as string[] | undefined) ?? [];
    set(id, current.includes(option) ? current.filter((o) => o !== option) : [...current, option]);
  }

  async function start() {
    if (missing.length || !modelId) return;
    setBusy(true);
    setError(null);
    try {
      const design = await createDesign(modelId, answers, folder, undefined, webSearch, workspaceId);
      onDone(design.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ما قدرت أبدأ التصميم"));
      setBusy(false);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 flex items-center justify-center p-6"
      style={{ zIndex: "var(--z-index-modal)" as unknown as number, background: "rgba(0,0,0,0.5)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.96, y: 14, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.97, opacity: 0, transition: { duration: 0.15 } }}
        transition={{ duration: 0.3, ease: easeOutExpo }}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border shadow-2xl"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <header className="flex items-start justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "var(--color-border)" }}>
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <span className="font-mono text-xs" style={{ color: "var(--color-accent)" }} dir="ltr">
                /impeccable init
              </span>
              {t("جمع معلومات المشروع")}
            </h2>
            <p className="mt-0.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
              {t("تسع أسئلة. اللي بتتركه فاضي رفيق بيفترضه وبيقلّك شو افترض.")}
            </p>
          </div>
          <button onClick={onClose} aria-label={t("إغلاق")} className="rounded-lg p-1 hover:bg-[var(--color-surface-2)]" style={{ color: "var(--color-ink-muted)" }}>
            <XIcon className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-5">
            {questions.map((question, i) => (
              <div key={question.id}>
                <label className="mb-1.5 flex items-baseline gap-2 text-sm">
                  <span className="font-mono text-[11px] tabular-nums" style={{ color: "var(--color-ink-muted)" }}>
                    {i + 1}
                  </span>
                  {question.label}
                  {!question.required && (
                    <span className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
                      {t("(اختياري)")}
                    </span>
                  )}
                </label>

                {question.kind === "text" && (
                  <input
                    value={(answers[question.id] as string) ?? ""}
                    onChange={(e) => set(question.id, e.currentTarget.value)}
                    placeholder={question.placeholder}
                    className="input w-full"
                    dir={fieldDir(answers[question.id] as string)}
                  />
                )}

                {question.kind !== "text" && (
                  <div className="flex flex-wrap gap-1.5">
                    {question.options?.map((option) => {
                      const selected =
                        question.kind === "multi"
                          ? ((answers[question.id] as string[] | undefined) ?? []).includes(option)
                          : answers[question.id] === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => (question.kind === "multi" ? toggle(question.id, option) : set(question.id, option))}
                          className="rounded-full border px-3 py-1.5 text-xs transition-colors"
                          style={{
                            borderColor: selected ? "var(--color-accent)" : "var(--color-border)",
                            background: selected ? "color-mix(in oklch, var(--color-accent) 14%, transparent)" : "transparent",
                            color: selected ? "var(--color-ink)" : "var(--color-ink-muted)",
                          }}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t px-5 py-3" style={{ borderColor: "var(--color-border)" }}>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm">
              <FolderIcon className="h-4 w-4 shrink-0" style={{ color: "var(--color-ink-muted)" }} />
              {t("مجلد التصميم")}
            </p>
            <p className="mt-0.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
              {folder
                ? t("كل نسخة من التصميم بتنحفظ بـ {0} كملف HTML، والنموذج بيقدر يقرأ ملفات المجلد.", { 0: folderName(folder) })
                : t("اختياري — لو حددته، التصميم بينحفظ عندك تلقائياً والنموذج بيقدر يشوف ملفات المشروع.")}
            </p>
          </div>
          <FolderChip value={folder} onChange={(path) => setFolder(path)} />
        </div>

        {/* The design chat sends its first message by itself, so this has to be decided
            here — after it starts there is no moment to switch the tool off in time. */}
        <div className="flex items-center justify-between gap-3 border-t px-5 py-3" style={{ borderColor: "var(--color-border)" }}>
          <div className="min-w-0">
            <p className="text-sm">{t("أداة البحث تبع رفيق")}</p>
            <p className="mt-0.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
              {searchOn
                ? t("النموذج بيقدر يدوّر على الويب بمفتاح البحث تبعك.")
                : ownsSearch
                  ? t("مطفية — النموذج بيدوّر بأداته هو.")
                  : t("مطفية — النموذج ما رح يدوّر على الويب بهالتصميم.")}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={searchOn}
            aria-label={t("أداة البحث تبع رفيق")}
            onClick={() => setWebSearch(!searchOn)}
            className="flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200"
            style={{
              background: searchOn ? "var(--color-accent)" : "var(--color-surface-2)",
              justifyContent: searchOn ? "flex-end" : "flex-start",
            }}
          >
            <motion.span layout transition={snappy} className="h-5 w-5 rounded-full bg-white shadow-sm" />
          </button>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t px-5 py-3" style={{ borderColor: "var(--color-border)" }}>
          <div className="flex items-center gap-2">
            <select value={modelId} onChange={(e) => setModelId(e.currentTarget.value)} className="input w-44">
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <span className="text-xs tabular-nums" style={{ color: "var(--color-ink-muted)" }}>
              {answered}/{questions.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {error && (
              <span className="text-xs" style={{ color: "var(--color-danger)" }}>
                {error}
              </span>
            )}
            <Button onClick={start} disabled={busy || missing.length > 0 || !modelId}>
              {busy ? t("جارِ البدء…") : t("ابدأ التصميم")}
            </Button>
          </div>
        </footer>
      </motion.div>
    </motion.div>
  );
}
