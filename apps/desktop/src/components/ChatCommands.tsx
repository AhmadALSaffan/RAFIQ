import { useState } from "react";
import { motion } from "motion/react";
import type { ChatMessage, ReplyLanguage, ReplyLength, ReplySettings } from "../lib/types";
import { easeOutExpo } from "../lib/motion";
import { COMMANDS } from "./ComposerMenus";
import { Button } from "./ui";
import { XIcon } from "./Icons";

import { t } from "../i18n";
/** Shared modal shell for the composer's dialogs. */
function Dialog({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
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
        className="flex max-h-[80vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-2xl border p-5 shadow-2xl"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label={t("إغلاق")}
            className="rounded-lg p-1 transition-colors hover:bg-[var(--color-surface-2)]"
            style={{ color: "var(--color-ink-muted)" }}
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

/** Segmented picker with the selection sliding between options. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  name,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  name: string;
}) {
  return (
    <div className="flex gap-1 rounded-xl p-1" style={{ background: "var(--color-surface-2)" }}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className="relative flex-1 rounded-lg px-3 py-1.5 text-xs transition-colors"
          style={{ color: option.value === value ? "var(--color-bg)" : "var(--color-ink-muted)" }}
        >
          {option.value === value && (
            <motion.span
              layoutId={`seg-${name}`}
              className="absolute inset-0 rounded-lg"
              style={{ background: "var(--color-accent)" }}
              transition={{ type: "spring", stiffness: 520, damping: 40 }}
            />
          )}
          <span className="relative">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-start justify-between gap-3 text-start">
      <span>
        <span className="block text-sm">{label}</span>
        <span className="block text-xs" style={{ color: "var(--color-ink-muted)" }}>
          {hint}
        </span>
      </span>
      <span
        className="mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors"
        style={{ background: checked ? "var(--color-accent)" : "var(--color-border)" }}
      >
        <motion.span
          layout
          transition={{ type: "spring", stiffness: 600, damping: 38 }}
          className="h-4 w-4 rounded-full"
          style={{ background: "var(--color-bg)", marginInlineStart: checked ? "1rem" : 0 }}
        />
      </span>
    </button>
  );
}

const LENGTHS: { value: ReplyLength; label: string }[] = [
  { value: "short", label: t("مختصر") },
  { value: "balanced", label: t("متوازن") },
  { value: "detailed", label: t("مفصّل") },
];

const LANGUAGES: { value: ReplyLanguage; label: string }[] = [
  { value: "auto", label: t("لغة المستخدم") },
  { value: "ar", label: t("عربي") },
  { value: "en", label: t("إنجليزي") },
  { value: "ru", label: t("روسي") },
];

const EFFORTS: { value: string; label: string }[] = [
  { value: "auto", label: t("تلقائي") },
  { value: "low", label: t("خفيف") },
  { value: "medium", label: t("متوسط") },
  { value: "high", label: t("عميق") },
];

/** `/إعدادات` — how this chat's replies get generated. */
export function ReplyConfigDialog({
  settings,
  onClose,
  onSave,
}: {
  settings: ReplySettings;
  onClose: () => void;
  onSave: (settings: ReplySettings) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ReplySettings>(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<ReplySettings>) => setDraft((d) => ({ ...d, ...patch }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ما قدرت أحفظ الإعدادات"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={t("إعدادات الرد")} subtitle={t("بتنطبق على هالمحادثة بس، ومن أول رسالة جاية.")} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-1.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {t("طول الرد")}
          </p>
          <Segmented name="length" value={draft.length} options={LENGTHS} onChange={(length) => set({ length })} />
          {draft.length === "short" && (
            <p className="mt-1.5 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
              {t("بيحدّ الرد بـ 500 توكن كمان، فبيكلّفك أقل.")}
            </p>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {t("لغة الرد")}
          </p>
          <Segmented name="language" value={draft.language} options={LANGUAGES} onChange={(language) => set({ language })} />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
              {t("الحرارة (دقيق ↔ مبدع)")}
            </p>
            <span className="font-mono text-xs" dir="ltr" style={{ color: "var(--color-ink-muted)" }}>
              {draft.temperature === null ? t("افتراضي المزود") : draft.temperature.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            dir="ltr"
            value={draft.temperature ?? 0.7}
            onChange={(e) => set({ temperature: Number(e.currentTarget.value) })}
            className="w-full accent-[var(--color-accent)]"
          />
          {draft.temperature !== null && (
            <button
              type="button"
              onClick={() => set({ temperature: null })}
              className="mt-1 text-[11px] underline underline-offset-2"
              style={{ color: "var(--color-ink-muted)" }}
            >
              {t("رجّعها لافتراضي المزود")}
            </button>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Toggle
            checked={draft.reasoning}
            onChange={(reasoning) => set({ reasoning })}
            label={t("التفكير (reasoning)")}
            hint={t("لما يكون مطفي، بنطلب من النماذج اللي بتسمح إنها ما تفكّر، وما بنعرض خطوات التفكير أصلاً.")}
          />
          {draft.reasoning && (
            <div>
              <p className="mb-1.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                {t("عمق التفكير (بالنماذج اللي بتدعمه)")}
              </p>
              <Segmented
                name="effort"
                value={draft.reasoning_effort ?? "auto"}
                options={EFFORTS}
                onChange={(value) => set({ reasoning_effort: value === "auto" ? null : (value as "low" | "medium" | "high") })}
              />
            </div>
          )}
        </div>

        <Toggle
          checked={draft.tools}
          onChange={(tools) => set({ tools })}
          label={t("الأدوات (ملفات، shell، مهام، Jira)")}
          hint={t("طفّيها للأسئلة العادية: ما بتنبعت مواصفات الأدوات أصلاً، يعني توكنز أقل بكل رسالة.")}
        />
        <Toggle
          checked={draft.auto_summarize}
          onChange={(auto_summarize) => set({ auto_summarize })}
          label={t("التلخيص التلقائي")}
          hint={t("لما تطول المحادثة (فوق 30 رسالة)، بتنطوي القديمة بملخص بدل ما تنبعت كلها.")}
        />

        {error && (
          <p className="text-xs" style={{ color: "var(--color-danger)" }}>
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("إلغاء")}
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? t("جارِ الحفظ…") : t("احفظ")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

const SHORTCUTS = [
  { keys: "Enter", what: t("إرسال") },
  { keys: "Shift + Enter", what: t("سطر جديد") },
  { keys: "Esc", what: t("إغلاق القائمة، أو إيقاف الرد وهو شغّال") },
  { keys: "↑ / ↓", what: t("تنقل بين خيارات القائمة") },
  { keys: "Tab", what: t("اختيار الخيار المحدد") },
];

/** `/مساعدة` — every command and shortcut in one place. */
export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title={t("الأوامر والاختصارات")} subtitle={t("اكتب / بصندوق الكتابة عشان تطلعلك نفس القائمة.")} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-1.5">
          {COMMANDS.map((cmd) => (
            <li key={cmd.id} className="flex items-start gap-2.5">
              <cmd.Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--color-accent)" }} />
              <span className="min-w-0">
                <span className="text-sm">{cmd.label}</span>
                <span className="block text-xs" style={{ color: "var(--color-ink-muted)" }}>
                  {cmd.hint}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <div>
          <p className="mb-1.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {t("كمان:")} <span className="font-mono">@</span> {t("لملف من مجلد المحادثة، و")}<span className="font-mono">#</span> {t("لمهمة من حسابك المربوط.")}
          </p>
          <ul className="flex flex-col gap-1">
            {SHORTCUTS.map((s) => (
              <li key={s.keys} className="flex items-center justify-between gap-3 text-xs">
                <span style={{ color: "var(--color-ink-muted)" }}>{s.what}</span>
                <kbd
                  className="rounded-md border px-1.5 py-0.5 font-mono text-[11px]"
                  dir="ltr"
                  style={{ borderColor: "var(--color-border)", background: "var(--color-surface-2)" }}
                >
                  {s.keys}
                </kbd>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Dialog>
  );
}

/** The transcript as Markdown, for `/صدّر`. */
export function chatToMarkdown(title: string, messages: ChatMessage[]): string {
  const lines = [`# ${title}`, ""];
  for (const message of messages) {
    lines.push(message.role === "user" ? t("## أنا") : t("## رفيق"), "", message.content || t("_(بدون نص)_"), "");
    for (const attachment of message.attachments ?? []) lines.push(t("- مرفق: {0}", { 0: attachment.name }));
    for (const part of message.parts ?? []) {
      if (part.kind === "tool") lines.push(t("> أداة `{0}`{1}", { 0: part.tool, 1: part.ok === false ? t(" — فشلت") : "" }), "");
      if (part.kind === "task") lines.push(t("> مهمة: {0}", { 0: part.title }), "");
    }
  }
  return lines.join("\n");
}

/**
 * Saves text to disk: the OS save dialog inside the app, a browser download in `vite dev`.
 * Returns the path it wrote to, or null if the user cancelled.
 */
export async function saveTextFile(suggestedName: string, contents: string): Promise<string | null> {
  const { isTauri, invoke } = await import("@tauri-apps/api/core");
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: suggestedName, filters: [{ name: "Markdown", extensions: ["md"] }] });
    if (!path) return null;
    await invoke("save_text_file", { path, contents });
    return path;
  }

  const url = URL.createObjectURL(new Blob([contents], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = suggestedName;
  link.click();
  URL.revokeObjectURL(url);
  return suggestedName;
}
