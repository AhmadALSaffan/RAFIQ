import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { getMotionProject, patchMotionScene, renameMotionProject, type MotionProject } from "../lib/api";
import { snappy } from "../lib/motion";
import { Button } from "../components/ui";
import { Resizer } from "../components/Resizer";
import { usePageMenu } from "../components/ContextMenu";
import { AlertIcon, MaximizeIcon, MovieIcon, PauseIcon, PlayIcon, VolumeIcon, PencilIcon } from "../components/Icons";
import { ChatPage } from "../features/chat";
import { ScenePlayer, type ScenePlayerHandle } from "../features/motion/ScenePlayer";
import { VersionsPane } from "../features/motion/VersionsPane";
import { ExportPanel } from "../features/motion/ExportPanel";
import { EditorPanel, type PanelTab } from "../features/motion/EditorPanel";
import { FullPreview } from "../features/motion/FullPreview";
import { LintBadge, LintPanel, Timeline, formatTime, type LintIssue, type MotionClip } from "../features/motion/pieces";
import { safeZones, type Issue } from "../features/motion/engine/lint";
import type { MotionEngine } from "../features/motion/engine/engine";
import { applyOps, clipPatch, duplicateLayerOps, findLayer, removeLayerOps, reviewTimes, setField, tracksFromScene, type Op } from "../features/motion/sceneEdit";
import type { Scene } from "../features/motion/engine/types";

import { t } from "../i18n";
import { ownsKey } from "../lib/keyboard";

type View = "stage" | "versions";

function takeKickoff(id: string): string | undefined {
  try {
    const key = `rafiq-motion-kickoff:${id}`;
    const value = sessionStorage.getItem(key);
    if (value) sessionStorage.removeItem(key);
    return value ?? undefined;
  } catch {
    return undefined;
  }
}

export function MotionWorkspace() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<MotionProject | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [view, setView] = useState<View>("stage");
  const [panel, setPanel] = useState<PanelTab>("add");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sound, setSound] = useState(true);
  const [selected, setSelectedRaw] = useState<string | null>(null);
  const [zoom, setZoom] = useState(80);
  const [chatWidth, setChatWidth] = useState(380);
  const [panelWidth, setPanelWidth] = useState(380);
  const [timelineHeight, setTimelineHeight] = useState(260);
  const [safe, setSafe] = useState(true);
  const [grid, setGrid] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [linting, setLinting] = useState(false);
  const [lintOpen, setLintOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [fullOpen, setFullOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [kickoff] = useState(() => takeKickoff(id));
  const [request, setRequest] = useState<{ id: number; text: string } | null>(null);
  const [moving, setMoving] = useState<{ id: string; x0: number; y0: number; dx: number; dy: number } | null>(null);
  const player = useRef<ScenePlayerHandle>(null);
  const pending = useRef(0);
  const dragTimer = useRef<number | null>(null);

  /** Selecting brings up the tab that edits it — unless the user is working a list. */
  const setSelected = useCallback((next: string | null) => {
    setSelectedRaw(next);
    if (!next) return;
    setPanel((tab) => (next.startsWith("audio:") ? (tab === "layers" ? tab : "audio") : tab === "layers" || tab === "motion" || tab === "props" ? tab : "props"));
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await getMotionProject(id);
      setProject(next);
      // Never overwrite an edit that's still on its way.
      if (!pending.current) setScene(next.scene);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ما لقيت المشروع"));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // The model changes the scene from the chat; follow it.
  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (document.hidden || pending.current) return;
      const next = await getMotionProject(id).catch(() => null);
      if (next && project && next.version !== project.version) {
        setProject(next);
        setScene(next.scene);
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [id, project]);

  const commit = useCallback(
    async (ops: Op[], summary: string) => {
      if (!project || !scene || !ops.length) return;
      pending.current += 1;
      setSaveError(null);
      setScene(applyOps(scene, ops));
      try {
        const out = await patchMotionScene(project.id, ops, summary);
        setScene(out.scene);
        setProject((p) => (p ? { ...p, scene: out.scene, version: out.version } : p));
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
        setScene(project.scene);
      } finally {
        pending.current -= 1;
      }
    },
    [project, scene],
  );

  // Checks run in the engine after every change (debounced through the player's reload).
  const lintToken = useRef(0);
  const onEngineReady = useCallback(async (engine: MotionEngine) => {
    const token = ++lintToken.current;
    setLinting(true);
    try {
      const { fullLint } = await import("../features/motion/hostHandlers");
      const found = await fullLint(engine);
      if (token === lintToken.current) setIssues(found);
    } finally {
      if (token === lintToken.current) setLinting(false);
    }
  }, []);

  const tracks = useMemo(() => (scene ? tracksFromScene(scene) : []), [scene]);
  const selectedLayer = scene && selected && !selected.startsWith("audio:") ? findLayer(scene, selected) : null;

  // Keyboard: Space plays, Delete removes, Ctrl+D duplicates, arrows nudge a unit (Shift: 4), F opens the full preview.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!scene || ownsKey(e.target, e.key) || fullOpen || exportOpen) return;
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key.toLowerCase() === "f" && !e.ctrlKey && !e.metaKey) {
        setPlaying(false);
        setFullOpen(true);
      } else if (e.key === "Escape") {
        setSelectedRaw(null);
      } else if (selectedLayer && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        void commit(removeLayerOps(scene, selectedLayer.id), t("حذفت {id}", { id: selectedLayer.id }));
        setSelectedRaw(null);
      } else if (selectedLayer && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const dup = duplicateLayerOps(scene, selectedLayer.id);
        if (dup) {
          void commit(dup.ops, t("كرّرت {id}", { id: selectedLayer.id }));
          setSelected(dup.id);
        }
      } else if (selectedLayer && !selectedLayer.locked && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const by = e.shiftKey ? 4 : 1;
        const rtl = (scene.composition.direction ?? "rtl") === "rtl";
        // x runs toward the reading end: left in RTL
        const dx = e.key === "ArrowRight" ? (rtl ? -by : by) : e.key === "ArrowLeft" ? (rtl ? by : -by) : 0;
        const dy = e.key === "ArrowDown" ? by : e.key === "ArrowUp" ? -by : 0;
        const layout = selectedLayer.layout ?? {};
        void commit(setField(scene, selectedLayer.id, "layout", { ...layout, x: (layout.x ?? 0) + dx, y: (layout.y ?? 0) + dy }), t("حرّكت {id}", { id: selectedLayer.id }));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [scene, selectedLayer, commit, fullOpen, exportOpen, setSelected]);

  usePageMenu(() => [
    { id: "export", label: t("تصدير"), onSelect: () => setExportOpen(true) },
    { id: "full", label: t("معاينة كاملة"), onSelect: () => setFullOpen(true) },
    { id: "review", label: t("خلّي الموديل يراجع"), onSelect: () => review() },
    { id: "versions", label: t("النسخ"), onSelect: () => setView("versions") },
    { id: "layers", label: t("الطبقات"), onSelect: () => setPanel("layers") },
    { id: "all", label: t("كل المشاريع"), onSelect: () => navigate("/motion") },
  ]);

  function review() {
    const times = scene ? reviewTimes(scene).map((x) => x.toFixed(2)).join(t("، ")) : "";
    setRequest({
      id: Date.now(),
      text: t("راجع الفيديو جولة وحدة: افحصه بـ motion_lint، وشوف هالفريمات بـ motion_render_frames: {times} (إذا ما بتشوف صور بيرجعلك وصفها مكتوب). صلّح اللي بيلزم بـ patches صغيرة، افحص من جديد، وقلّي شو غيّرت.", { times }),
    });
  }

  if (error) {
    return (
      <div className="mx-auto max-w-xl px-8 py-16 text-center">
        <AlertIcon className="mx-auto h-6 w-6" style={{ color: "var(--color-danger)" }} />
        <p className="mt-3 text-sm">{error}</p>
        <Button variant="ghost" className="mt-4" onClick={() => navigate("/motion")}>
          {t("رجوع للمشاريع")}
        </Button>
      </div>
    );
  }
  if (!project || !scene) {
    return (
      <div className="flex h-full flex-col gap-3 p-6">
        <div className="shimmer h-10 rounded-lg" />
        <div className="shimmer min-h-0 flex-1 rounded-xl" />
      </div>
    );
  }

  const comp = scene.composition;
  const rtl = (comp.direction ?? "rtl") === "rtl";
  const unit = (8 * Math.min(comp.width, comp.height)) / 1080;
  const lintIssues: LintIssue[] = issues.map((i) => ({ code: i.code, message: `${i.message}${i.fix ? ` — ${i.fix}` : ""}`, time: i.t ?? 0, layer: i.layer ?? undefined, severity: i.severity }));
  const zones = safeZones(scene);

  /** Live while dragging on the stage; one version when the hand lets go. */
  function moveTo(layerId: string, dxPx: number, dyPx: number, done: boolean) {
    if (!project) return;
    const base = findLayer(project.scene, layerId);
    if (!base) return;
    const layout = base.layout ?? {};
    const ux = Math.round((rtl ? -dxPx : dxPx) / unit);
    const uy = Math.round(dyPx / unit);
    const ops = setField(project.scene, layerId, "layout", { ...layout, x: (layout.x ?? 0) + ux, y: (layout.y ?? 0) + uy });
    if (done) {
      if (ux || uy) void commit(ops, t("حرّكت {id}", { id: layerId }));
    } else setScene(applyOps(project.scene, ops));
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 px-5 pb-1 pt-3">
        <button onClick={() => navigate("/motion")} className="shrink-0 rounded-full px-2.5 py-1 text-xs transition-colors hover:bg-[var(--color-surface)]" style={{ color: "var(--color-ink-muted)" }}>
          {t("موشن ›")}
        </button>
        {renaming ? (
          <input
            autoFocus
            defaultValue={project.title}
            onBlur={async (e) => {
              const title = e.currentTarget.value.trim();
              const cancelled = e.currentTarget.dataset.cancel === "1";
              setRenaming(false);
              if (!cancelled && title && title !== project.title) setProject(await renameMotionProject(project.id, title));
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") e.currentTarget.dataset.cancel = "1"; // leave it as it was
              if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
            }}
            className="min-w-0 flex-1 rounded-[10px] border px-2 py-1 text-sm outline-none"
            style={{ borderColor: "var(--color-ink-muted)", background: "var(--color-surface)", color: "var(--color-ink)" }}
            dir="auto"
          />
        ) : (
          <div className="group/title flex min-w-0 flex-1 items-center gap-1">
            <h1 onDoubleClick={() => setRenaming(true)} title={t("دبل كليك لإعادة التسمية")} className="min-w-0 cursor-text truncate text-[17px] font-bold" dir="auto">
              {project.title}
              <span className="num ms-2 text-xs font-normal" style={{ color: "var(--color-ink-muted)" }}>
                v{project.version}
              </span>
            </h1>
            <button
              type="button"
              onClick={() => setRenaming(true)}
              aria-label={t("إعادة تسمية")}
              title={t("إعادة تسمية")}
              className="shrink-0 rounded-full p-1.5 opacity-0 transition-opacity hover:bg-[var(--color-surface)] focus-visible:opacity-100 group-hover/title:opacity-100"
              style={{ color: "var(--color-ink-muted)" }}
            >
              <PencilIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="flex shrink-0 items-center gap-1 rounded-full p-1" style={{ background: "var(--color-surface)" }}>
          {(["stage", "versions"] as View[]).map((key) => (
            <button key={key} onClick={() => setView(key)} className="relative rounded-full px-3 py-1 text-xs" style={{ color: view === key ? "var(--color-on-inverse)" : "var(--color-ink-muted)" }}>
              {view === key && <motion.span layoutId="motion-tab" className="absolute inset-0 rounded-full" style={{ background: "var(--color-inverse)" }} transition={snappy} />}
              <span className="relative">{key === "stage" ? t("المحرّر") : t("النسخ")}</span>
            </button>
          ))}
        </div>
        <LintBadge issues={lintIssues} open={lintOpen} onToggle={() => setLintOpen((o) => !o)} />
        <Button variant="ghost" onClick={review}>
          {t("خلّي الموديل يراجع")}
        </Button>
        <Button
          variant="soft"
          onClick={() => {
            setPlaying(false);
            setFullOpen(true);
          }}
          title={t("معاينة كاملة (F)")}
        >
          <MaximizeIcon className="h-4 w-4" />
          {t("معاينة كاملة")}
        </Button>
        <Button variant="accent" onClick={() => setExportOpen(true)}>
          <MovieIcon className="h-4 w-4" />
          {t("تصدير")}
        </Button>
      </header>
      {saveError && (
        <p className="mx-5 my-1 rounded-xl px-3 py-1.5 text-xs" style={{ background: "var(--color-surface)", color: "var(--color-danger)" }}>
          {t("ما انحفظ التعديل: {e}", { e: saveError })}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 shrink-0 flex-col" style={{ width: chatWidth }}>
          <ChatPage chatId={project.chat_id} embedded autoSend={kickoff} onReplyDone={load} sendRequest={request} />
        </div>
        <Resizer value={chatWidth} min={300} max={640} onChange={setChatWidth} onDoubleClick={() => setChatWidth(380)} label={t("عرض الشات")} />

        <div className="m-2 ms-0 flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-2xl" style={{ background: "var(--color-surface)" }}>
          {view === "versions" ? (
            <div className="min-w-0 flex-1">
              <VersionsPane
                project={project}
                onRestored={(p) => {
                  setProject(p);
                  setScene(p.scene);
                }}
              />
            </div>
          ) : (
            <>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="relative min-h-0 flex-1 p-3" style={{ background: "var(--color-surface-2)" }}>
                  <ScenePlayer
                    ref={player}
                    scene={scene}
                    kit={project.kit}
                    time={time}
                    playing={playing}
                    sound={sound}
                    onTime={setTime}
                    onEnded={() => setPlaying(false)}
                    onReady={(engine) => void onEngineReady(engine)}
                    onError={(m) => setSaveError(m)}
                    className="h-full w-full"
                    onCanvasClick={(x, y) => {
                      const frame = player.current?.engine()?.frame(time);
                      const hit = [...(frame?.items ?? [])].reverse().find((i) => !i.layer.locked && x >= i.bounds.x && x <= i.bounds.x + i.bounds.w && y >= i.bounds.y && y <= i.bounds.y + i.bounds.h);
                      setSelected(hit?.id ?? null);
                      if (!hit) setSelectedRaw(null);
                    }}
                    overlay={(w, h) => {
                      const k = w / comp.width;
                      const sel = selected && !selected.startsWith("audio:") ? player.current?.engine()?.frame(time).items.find((i) => i.id === selected) : null;
                      const locked = sel?.layer.locked;
                      return (
                        <div className="pointer-events-none absolute inset-0">
                          {safe &&
                            zones.map((z, i) => (
                              <div key={i} className="absolute" style={{ left: z.x * k, top: z.y * k, width: z.w * k, height: z.h * k, background: "rgba(230,136,53,.10)" }} />
                            ))}
                          {grid && (
                            <div className="absolute inset-0" style={{ backgroundImage: "linear-gradient(to right, rgba(255,255,255,.10) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.10) 1px, transparent 1px)", backgroundSize: `${unit * 4 * k}px ${unit * 4 * k}px`, width: w, height: h }} />
                          )}
                          {sel && (
                            <div
                              className={`absolute rounded ${locked ? "" : "pointer-events-auto cursor-move"}`}
                              title={locked ? t("مقفولة") : t("اسحب لتحرّكها")}
                              style={{
                                left: sel.bounds.x * k - 2 + (moving?.id === sel.id ? moving.dx : 0),
                                top: sel.bounds.y * k - 2 + (moving?.id === sel.id ? moving.dy : 0),
                                width: sel.bounds.w * k + 4,
                                height: sel.bounds.h * k + 4,
                                outline: `1.5px ${locked ? "dotted" : "dashed"} var(--color-accent)`,
                              }}
                              onPointerDown={(e) => {
                                if (locked) return;
                                e.preventDefault();
                                e.stopPropagation();
                                e.currentTarget.setPointerCapture(e.pointerId);
                                setPlaying(false);
                                setMoving({ id: sel.id, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 });
                              }}
                              onPointerMove={(e) => {
                                if (!moving || moving.id !== sel.id) return;
                                const dx = e.clientX - moving.x0;
                                const dy = e.clientY - moving.y0;
                                setMoving({ ...moving, dx, dy });
                              }}
                              onPointerUp={(e) => {
                                if (!moving || moving.id !== sel.id) return;
                                moveTo(sel.id, (e.clientX - moving.x0) / k, (e.clientY - moving.y0) / k, true);
                                setMoving(null);
                              }}
                            />
                          )}
                        </div>
                      );
                    }}
                  />
                </div>
                {/* Transport */}
                <div className="flex items-center gap-2 border-t px-3 py-2" style={{ borderColor: "var(--color-border)" }}>
                  <button onClick={() => setPlaying((p) => !p)} aria-label={playing ? t("إيقاف") : t("تشغيل")} title={t("تشغيل (Space)")} className="rounded-full p-2" style={{ background: "var(--color-inverse)", color: "var(--color-on-inverse)" }}>
                    {playing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
                  </button>
                  <span className="num w-28 text-xs" dir="ltr">
                    {formatTime(time)} / {formatTime(comp.duration)}
                  </span>
                  <span className="num text-[11px]" style={{ color: "var(--color-ink-muted)" }} dir="ltr">
                    {comp.width}×{comp.height} · {comp.fps}fps
                  </span>
                  <div className="flex-1" />
                  {linting && <span className="text-[10px]" style={{ color: "var(--color-ink-muted)" }}>{t("عم يفحص…")}</span>}
                  <button onClick={() => setSound((s) => !s)} aria-label={t("الصوت")} title={t("الصوت")} className="rounded-full p-1.5" style={{ color: sound ? "var(--color-ink)" : "var(--color-ink-muted)", opacity: sound ? 1 : 0.5 }}>
                    <VolumeIcon className="h-4 w-4" />
                  </button>
                  <button onClick={() => setSafe((s) => !s)} className="rounded-full border px-2 py-1 text-[10px]" style={{ borderColor: safe ? "var(--color-inverse)" : "var(--color-border)" }}>
                    {t("المنطقة الآمنة")}
                  </button>
                  <button onClick={() => setGrid((g) => !g)} className="rounded-full border px-2 py-1 text-[10px]" style={{ borderColor: grid ? "var(--color-inverse)" : "var(--color-border)" }}>
                    {t("الشبكة")}
                  </button>
                </div>
                {/* drag to give the timeline more room */}
                <div
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label={t("ارتفاع الـ timeline")}
                  className="h-1.5 shrink-0 cursor-row-resize transition-colors hover:bg-[var(--color-border)]"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    const y0 = e.clientY;
                    const h0 = timelineHeight;
                    const move = (ev: PointerEvent) => setTimelineHeight(Math.min(window.innerHeight * 0.7, Math.max(120, h0 - (ev.clientY - y0))));
                    window.addEventListener("pointermove", move);
                    window.addEventListener("pointerup", () => window.removeEventListener("pointermove", move), { once: true });
                  }}
                  onDoubleClick={() => setTimelineHeight(260)}
                />
                <div className="shrink-0 overflow-hidden border-t" style={{ height: timelineHeight, borderColor: "var(--color-border)" }}>
                  <Timeline
                    tracks={tracks}
                    duration={comp.duration}
                    time={time}
                    onSeek={(s) => {
                      setPlaying(false);
                      setTime(s);
                    }}
                    selected={selected}
                    onSelect={(clip) => setSelected(clip)}
                    onToggleHidden={(trackId) => {
                      const layer = findLayer(scene, trackId);
                      if (layer) void commit(setField(scene, trackId, "hidden", layer.hidden ? undefined : true), layer.hidden ? t("أظهرت {id}", { id: trackId }) : t("أخفيت {id}", { id: trackId }));
                    }}
                    onClipChange={(trackId: string, clip: MotionClip) => {
                      // live while dragging; one version when the hand lets go
                      const preview = clipPatch(project.scene, trackId, clip.start, clip.end);
                      setScene(applyOps(project.scene, preview.ops));
                      if (dragTimer.current) window.clearTimeout(dragTimer.current);
                      pending.current = Math.max(pending.current, 1);
                      dragTimer.current = window.setTimeout(() => {
                        pending.current = Math.max(0, pending.current - 1);
                        void commit(preview.ops, preview.summary);
                      }, 450);
                    }}
                    zoom={zoom}
                    onZoom={setZoom}
                  />
                </div>
              </div>
              <Resizer value={panelWidth} min={300} max={560} onChange={(w) => setPanelWidth(w)} onDoubleClick={() => setPanelWidth(380)} label={t("عرض لوحة الأدوات")} />
              <aside className="flex min-h-0 shrink-0 flex-col border-s" style={{ width: panelWidth, borderColor: "var(--color-border)" }}>
                <EditorPanel
                  tab={panel}
                  onTab={setPanel}
                  scene={scene}
                  kit={project.kit}
                  projectId={project.id}
                  time={time}
                  selected={selected}
                  onSelect={setSelected}
                  onChange={(ops, summary) => void commit(ops, summary)}
                />
              </aside>
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {lintOpen && (
          <div className="fixed end-6 top-28 z-40 w-96">
            <LintPanel
              issues={lintIssues}
              onClose={() => setLintOpen(false)}
              onJump={(issue) => {
                setPlaying(false);
                setTime(issue.time);
                if (issue.layer) setSelected(issue.layer);
                setView("stage");
              }}
            />
          </div>
        )}
        {exportOpen && <ExportPanel projectId={project.id} scene={scene} kit={project.kit} issues={issues} onClose={() => setExportOpen(false)} />}
        {fullOpen && (
          <FullPreview
            scene={scene}
            kit={project.kit}
            start={time}
            onClose={(at) => {
              setFullOpen(false);
              setTime(at);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
