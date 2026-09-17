/**
 * The workspace picker in the side nav, and the dialog that manages workspaces (name,
 * folder, model, standing instructions, colour). Picking one filters chats, tasks and
 * designs to it and seeds new sessions with its folder and model.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { deleteWorkspace, listModels, saveWorkspace } from "../lib/api";
import type { LlmModel, Workspace, WorkspaceInput } from "../lib/types";
import { easeOutExpo, snappy } from "../lib/motion";
import { fieldDir } from "../lib/bidi";
import { folderName } from "../lib/folders";
import { refreshWorkspaces, setCurrentWorkspace, useWorkspaces, WORKSPACE_COLORS } from "../lib/workspace";
import { FolderPicker } from "./FolderPicker";
import { Button, ErrorText, Field } from "./ui";
import { BriefcaseIcon, ChevronDownIcon, PlusIcon, SettingsIcon, TrashIcon, XIcon } from "./Icons";
import { t } from "../i18n";

function Dot({ color, className = "h-2.5 w-2.5" }: { color: string | null; className?: string }) {
  return <span className={`inline-block shrink-0 rounded-full ${className}`} style={{ background: color ?? "var(--color-ink-muted)" }} />;
}

export function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const { all, current, currentId } = useWorkspaces();
  const [open, setOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const label = current?.name ?? t("كل الشغل");

  return (
    <div ref={ref} className="relative mb-3">
      <button
        onClick={() => setOpen((v) => !v)}
        title={collapsed ? label : undefined}
        aria-label={t("مساحة العمل")}
        aria-expanded={open}
        className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-start text-xs transition-colors hover:bg-[var(--color-surface-2)] ${collapsed ? "justify-center" : ""}`}
        style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
      >
        {current ? <Dot color={current.color} /> : <BriefcaseIcon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--color-ink-muted)" }} />}
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 truncate font-medium" dir="auto">
              {label}
            </span>
            <ChevronDownIcon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--color-ink-muted)" }} />
          </>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ duration: 0.2, ease: easeOutExpo }}
            className="absolute start-0 top-full mt-1 flex w-60 flex-col gap-0.5 rounded-xl border p-1.5 shadow-xl"
            style={{ zIndex: "var(--z-index-modal)" as unknown as number, borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <Row active={currentId === null} onClick={() => (setCurrentWorkspace(null), setOpen(false))}>
              <BriefcaseIcon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--color-ink-muted)" }} />
              <span className="flex-1 truncate">{t("كل الشغل")}</span>
            </Row>
            {all.map((w) => (
              <Row key={w.id} active={currentId === w.id} onClick={() => (setCurrentWorkspace(w.id), setOpen(false))}>
                <Dot color={w.color} />
                <span className="min-w-0 flex-1 truncate" dir="auto">
                  {w.name}
                </span>
                <span className="shrink-0 tabular-nums text-[10px]" style={{ color: "var(--color-ink-muted)" }}>
                  {w.chats + w.tasks + w.designs || ""}
                </span>
              </Row>
            ))}
            <div className="my-1 border-t" style={{ borderColor: "var(--color-border)" }} />
            <Row
              active={false}
              onClick={() => {
                setOpen(false);
                setManage(true);
              }}
            >
              <SettingsIcon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--color-ink-muted)" }} />
              <span className="flex-1">{all.length ? t("إدارة مساحات العمل") : t("أنشئ مساحة عمل")}</span>
            </Row>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>{manage && <WorkspacesDialog onClose={() => setManage(false)} />}</AnimatePresence>
    </div>
  );
}

function Row({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-xs transition-colors hover:bg-[var(--color-surface-2)]"
      style={{ background: active ? "color-mix(in oklch, var(--color-accent) 12%, transparent)" : undefined, color: active ? "var(--color-ink)" : undefined }}
    >
      {children}
    </button>
  );
}

const EMPTY: WorkspaceInput = { name: "", working_dir: null, model_id: null, instructions: null, color: WORKSPACE_COLORS[0] };

export function WorkspacesDialog({ onClose }: { onClose: () => void }) {
  const { all } = useWorkspaces();
  const [models, setModels] = useState<LlmModel[]>([]);
  const [editing, setEditing] = useState<{ id?: string; draft: WorkspaceInput } | null>(all.length ? null : { draft: { ...EMPTY } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listModels()
      .then((m) => setModels(m.filter((x) => x.verify_ok !== false)))
      .catch(() => setModels([]));
  }, []);

  async function save() {
    if (!editing || !editing.draft.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await saveWorkspace({ ...editing.draft, name: editing.draft.name.trim() }, editing.id);
      await refreshWorkspaces();
      if (!editing.id) setCurrentWorkspace(saved.id);
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(w: Workspace) {
    await deleteWorkspace(w.id).catch(() => undefined);
    await refreshWorkspaces();
  }

  return (
    <motion.div
      className="fixed inset-0 flex items-center justify-center p-6"
      style={{ zIndex: "var(--z-index-modal)" as unknown as number, background: "rgba(0,0,0,0.45)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.96, y: 12, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.97, opacity: 0, transition: { duration: 0.15 } }}
        transition={{ duration: 0.28, ease: easeOutExpo }}
        className="flex max-h-[85vh] w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-2xl border p-5 shadow-2xl"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{t("مساحات العمل")}</h2>
            <p className="mt-0.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
              {t("كل مشروع بمجلده ونموذجه وتعليماته. لما تختار مساحة، المحادثات والمهام والتصاميم بتتصفّى عليها والجلسات الجديدة بتبلّش بإعداداتها.")}
            </p>
          </div>
          <button onClick={onClose} aria-label={t("إغلاق")} className="rounded-lg p-1 hover:bg-[var(--color-surface-2)]" style={{ color: "var(--color-ink-muted)" }}>
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {all.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {all.map((w) => (
              <li key={w.id} className="flex items-center gap-3 rounded-lg border px-3 py-2" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
                <Dot color={w.color} className="h-3 w-3" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" dir="auto">
                    {w.name}
                  </p>
                  <p className="truncate text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
                    {w.working_dir ? folderName(w.working_dir) : t("بدون مجلد")}
                    {" · "}
                    {t("{0} محادثة، {1} مهمة، {2} تصميم", { 0: w.chats, 1: w.tasks, 2: w.designs })}
                  </p>
                </div>
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setEditing({ id: w.id, draft: { name: w.name, working_dir: w.working_dir, model_id: w.model_id, instructions: w.instructions, color: w.color } })}>
                  {t("عدّل")}
                </Button>
                <button onClick={() => void remove(w)} aria-label={t("احذف")} title={t("احذف المساحة — الجلسات بتضل بس بدون مساحة")} className="rounded-md p-1.5 hover:bg-[var(--color-surface-2)]" style={{ color: "var(--color-ink-muted)" }}>
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {editing ? (
          <div className="flex flex-col gap-3 rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
            <Field label={t("اسم المساحة")}>
              <input value={editing.draft.name} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, name: e.target.value } })} className="input" placeholder={t("مثلاً: متجر أحمد")} dir={fieldDir(editing.draft.name)} autoFocus />
            </Field>
            <FolderPicker value={editing.draft.working_dir ?? ""} onChange={(v) => setEditing({ ...editing, draft: { ...editing.draft, working_dir: v || null } })} />
            <Field label={t("النموذج الافتراضي (اختياري)")}>
              <select value={editing.draft.model_id ?? ""} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, model_id: e.target.value || null } })} className="input">
                <option value="">{t("اللي بتختاره وقتها")}</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("تعليمات دائمة (اختياري)")} hint={t("بتنضاف لكل محادثة ومهمة بهالمساحة — مثلاً: «المشروع بـ TypeScript، لا تستخدم any، الرد بالعربي».")}>
              <textarea value={editing.draft.instructions ?? ""} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, instructions: e.target.value || null } })} rows={3} className="input resize-none" dir={fieldDir(editing.draft.instructions ?? "")} />
            </Field>
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
                {t("اللون")}
              </span>
              {WORKSPACE_COLORS.map((c) => (
                <motion.button key={c} type="button" whileTap={{ scale: 0.9 }} onClick={() => setEditing({ ...editing, draft: { ...editing.draft, color: c } })} aria-label={c} className="relative h-5 w-5 rounded-full" style={{ background: c }}>
                  {editing.draft.color === c && <motion.span layoutId="ws-color" className="absolute -inset-1 rounded-full border-2" style={{ borderColor: "var(--color-ink)" }} transition={snappy} />}
                </motion.button>
              ))}
            </div>
            <ErrorText message={error} />
            <div className="flex gap-2">
              <Button onClick={() => void save()} disabled={busy || !editing.draft.name.trim()}>
                {editing.id ? t("احفظ") : t("أنشئ المساحة")}
              </Button>
              {all.length > 0 && (
                <Button variant="ghost" onClick={() => setEditing(null)}>
                  {t("إلغاء")}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <Button variant="ghost" onClick={() => setEditing({ draft: { ...EMPTY, color: WORKSPACE_COLORS[all.length % WORKSPACE_COLORS.length] } })}>
            <PlusIcon className="h-4 w-4" />
            {t("مساحة جديدة")}
          </Button>
        )}
      </motion.div>
    </motion.div>
  );
}
