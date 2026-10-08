import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  createMotionProject,
  deleteMotionProject,
  getMotionProject,
  listModels,
  listMotionProjects,
  type MotionProject,
  type MotionProjectSummary,
  type NewMotionProject,
} from "../lib/api";
import type { LlmModel } from "../lib/types";
import { easeOutExpo, listContainer, listItem, snappy } from "../lib/motion";
import { timeAgo } from "../lib/time";
import { fieldDir } from "../lib/bidi";
import { Button, EmptyState } from "../components/ui";
import { AlertIcon, PlusIcon, XIcon } from "../components/Icons";
import { useElementMenu, usePageMenu } from "../components/ContextMenu";
import { PageHeader, RefreshButton } from "../components/Page";
import { BracketLabel } from "../components/brand";
import { useWorkspaces } from "../lib/workspace";
import { ScenePlayer } from "../features/motion/ScenePlayer";
import { formatTime } from "../features/motion/pieces";

import { t } from "../i18n";

/** A live thumbnail: the scene itself, still at a third of the way in, playing on hover. */
function Thumb({ id }: { id: string }) {
  const [project, setProject] = useState<MotionProject | null>(null);
  const [hover, setHover] = useState(false);
  const [time, setTime] = useState(0);
  useEffect(() => {
    let alive = true;
    getMotionProject(id)
      .then((p) => {
        if (!alive) return;
        setProject(p);
        setTime(p.scene.composition.duration / 3);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id]);
  return (
    <div
      className="relative h-48 overflow-hidden rounded-xl"
      style={{ background: "var(--color-surface-2)" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {project && (
        <ScenePlayer
          scene={project.scene}
          kit={project.kit}
          time={time}
          playing={hover}
          loop
          maxSide={320}
          onTime={setTime}
          className="absolute inset-2"
        />
      )}
    </div>
  );
}

const ASPECTS: { id: NewMotionProject["aspect"]; label: string }[] = [
  { id: "9:16", label: t("ريل 9:16") },
  { id: "1:1", label: t("مربع 1:1") },
  { id: "4:5", label: t("بوست 4:5") },
  { id: "16:9", label: t("عريض 16:9") },
];

const KITS = [
  { id: "", label: t("هوية مساحة العمل") },
  { id: "dark", label: t("داكن") },
  { id: "light", label: t("فاتح") },
  { id: "neon", label: t("نيون") },
  { id: "warm", label: t("دافئ") },
];

function NewProjectDialog({ models, onClose, onCreated }: { models: LlmModel[]; onClose: () => void; onCreated: (p: MotionProject, prompt: string) => void }) {
  const { currentId: workspaceId } = useWorkspaces();
  const [title, setTitle] = useState("");
  const [aspect, setAspect] = useState<NewMotionProject["aspect"]>("9:16");
  const [fps, setFps] = useState(30);
  const [duration, setDuration] = useState(12);
  const [kit, setKit] = useState("");
  const [modelId, setModelId] = useState(models[0]?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const project = await createMotionProject({
        model_id: modelId,
        title: title.trim() || undefined,
        aspect,
        fps,
        duration,
        brand: kit || null,
        workspace_id: workspaceId,
      });
      onCreated(project, prompt.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const chip = (on: boolean) => ({
    borderColor: on ? "var(--color-inverse)" : "var(--color-border)",
    background: on ? "var(--color-inverse)" : "transparent",
    color: on ? "var(--color-on-inverse)" : "var(--color-ink)",
  });

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,.45)" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.25, ease: easeOutExpo }}
        className="flex w-full max-w-lg flex-col gap-4 rounded-3xl p-6 shadow-2xl"
        style={{ background: "var(--color-surface)" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t("مشروع موشن جديد")}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-extrabold">{t("مشروع موشن جديد")}</h2>
          <button onClick={onClose} aria-label={t("إغلاق")} className="rounded-full p-1.5 hover:bg-[var(--color-surface-2)]">
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <label className="flex flex-col gap-1.5">
          <BracketLabel>{t("الاسم")}</BracketLabel>
          <input value={title} onChange={(e) => setTitle(e.target.value)} dir={fieldDir(title)} placeholder={t("مثلاً: ريل إطلاق القهوة")} className="rounded-xl border px-3 py-2 text-sm outline-none" style={{ borderColor: "var(--color-border)", background: "var(--color-surface-2)" }} />
        </label>
        <div className="flex flex-col gap-1.5">
          <BracketLabel>{t("النسبة")}</BracketLabel>
          <div className="flex flex-wrap gap-1.5">
            {ASPECTS.map((a) => (
              <button key={a.id} onClick={() => setAspect(a.id)} className="rounded-full border px-3 py-1.5 text-xs" style={chip(aspect === a.id)}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <BracketLabel>fps</BracketLabel>
            <div className="flex gap-1.5">
              {[24, 30, 60].map((n) => (
                <button key={n} onClick={() => setFps(n)} className="num rounded-full border px-3 py-1.5 text-xs" style={chip(fps === n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-1.5">
            <BracketLabel>{t("المدة (ثواني)")}</BracketLabel>
            <input type="number" min={1} max={7200} value={duration} onChange={(e) => setDuration(Math.max(1, Number(e.target.value) || 1))} className="num rounded-xl border px-3 py-1.5 text-sm outline-none" style={{ borderColor: "var(--color-border)", background: "var(--color-surface-2)" }} dir="ltr" />
          </label>
        </div>
        <div className="flex flex-col gap-1.5">
          <BracketLabel>{t("الهوية")}</BracketLabel>
          <div className="flex flex-wrap gap-1.5">
            {KITS.map((k) => (
              <button key={k.id} onClick={() => setKit(k.id)} className="rounded-full border px-3 py-1.5 text-xs" style={chip(kit === k.id)}>
                {k.label}
              </button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1.5">
          <BracketLabel>{t("النموذج")}</BracketLabel>
          <select value={modelId} onChange={(e) => setModelId(e.target.value)} className="rounded-xl border px-3 py-2 text-sm outline-none" style={{ borderColor: "var(--color-border)", background: "var(--color-surface-2)" }}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <BracketLabel>{t("شو بدك تعمل؟ (اختياري)")}</BracketLabel>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} dir={fieldDir(prompt)} rows={3} placeholder={t("مثلاً: ريل 12 ثانية لقهوة مختصة، سعر 25 ريال، وزر «اطلب اليوم» بالآخر")} className="resize-none rounded-xl border px-3 py-2 text-sm outline-none" style={{ borderColor: "var(--color-border)", background: "var(--color-surface-2)" }} />
        </label>
        {error && (
          <p className="text-sm" style={{ color: "var(--color-danger)" }}>
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("إلغاء")}
          </Button>
          <Button variant="accent" onClick={() => void create()} disabled={busy || !modelId}>
            {t("ابدأ")}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function MotionPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [projects, setProjects] = useState<MotionProjectSummary[]>([]);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { currentId: workspaceId } = useWorkspaces();
  const menu = useElementMenu();

  useEffect(() => {
    if (params.get("new") !== "1") return;
    setDialog(true);
    setParams((p) => {
      p.delete("new");
      return p;
    }, { replace: true });
  }, [params, setParams]);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setProjects(await listMotionProjects(workspaceId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ما قدرت أجيب المشاريع"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    listModels().then(setModels).catch(() => setModels([]));
    void load();
  }, [load]);

  const usable = models.filter((m) => m.verify_ok !== false);

  usePageMenu(() => [
    { id: "new", label: t("مشروع موشن جديد"), onSelect: () => setDialog(true), disabled: !usable.length },
    { id: "refresh", label: t("حدّث القائمة"), onSelect: () => void load() },
  ]);

  async function remove(id: string) {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    await deleteMotionProject(id).catch(() => undefined);
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <PageHeader
        title={t("موشن")}
        scene="motion"
        description={t("فيديوهات وموشن قرافك بالشات: الموديل بيكتب المشهد، والإنجن بيرسمه ويفحصه ويصدّره على كرت الشاشة. بتعدّل بالشات أو بالـ timeline، وكل تعديل نسخة.")}
        actions={
          <>
            <RefreshButton spinning={refreshing} onClick={() => void load()} />
            <Button variant="accent" onClick={() => setDialog(true)} disabled={!usable.length}>
              <PlusIcon className="h-4 w-4" />
              {t("مشروع جديد")}
            </Button>
          </>
        }
      />

      {!usable.length && !loading && (
        <p className="mb-4 flex items-center gap-2 rounded-2xl px-4 py-3 text-sm" style={{ background: "var(--color-surface)", color: "var(--color-ink-muted)" }}>
          <AlertIcon className="h-4 w-4 shrink-0" />
          {t("أضف نموذج شغّال أولاً من صفحة النماذج.")}
        </p>
      )}
      {error && (
        <p className="mb-4 rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
          {error}
        </p>
      )}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="shimmer h-64 rounded-2xl" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          scene="motion"
          text={t("ما في مشاريع موشن بعد. ابدأ مشروع جديد واحكي للموديل شو بدك — ريل، إنترو، شرح، أو عدّل فيديو عندك.")}
          action={usable.length ? <Button onClick={() => setDialog(true)}>{t("مشروع جديد")}</Button> : undefined}
        />
      ) : (
        <motion.div variants={listContainer} initial="hidden" animate="show" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence initial={false}>
            {projects.map((p) => (
              <motion.div
                key={p.id}
                variants={listItem}
                exit="exit"
                layout="position"
                whileHover={{ y: -3 }}
                transition={snappy}
                className="flex cursor-pointer flex-col gap-3 rounded-2xl p-3"
                style={{ background: "var(--color-surface)" }}
                onClick={() => navigate(`/motion/${p.id}`)}
                onContextMenu={menu(() => [
                  { id: "open", label: t("افتح المشروع"), onSelect: () => navigate(`/motion/${p.id}`) },
                  { id: "delete", label: t("احذف المشروع"), onSelect: () => void remove(p.id), danger: true },
                ])}
              >
                <Thumb id={p.id} />
                <div className="flex items-start justify-between gap-2 px-1">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-bold" style={{ fontFamily: "var(--font-display)" }} dir="auto">
                      {p.title}
                    </p>
                    <p className="num mt-0.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                      {/* isolated left to right, or the RTL line flips 1920×1080 into 1080×1920 */}
                      <span dir="ltr">
                        {p.width}×{p.height} · {p.fps}fps · {formatTime(p.duration, false)} · v{p.version}
                      </span>
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px]" style={{ color: p.last_render?.status === "done" ? "var(--color-success)" : "var(--color-ink-muted)" }}>
                    {p.last_render?.status === "done" ? t("مصدَّر") : timeAgo(p.updated_at)}
                  </span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <AnimatePresence>
        {dialog && (
          <NewProjectDialog
            models={usable}
            onClose={() => setDialog(false)}
            onCreated={(project, prompt) => {
              if (prompt) {
                try {
                  sessionStorage.setItem(`rafiq-motion-kickoff:${project.id}`, prompt);
                } catch {
                  /* the prompt just won't be sent for you */
                }
              }
              navigate(`/motion/${project.id}`);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
