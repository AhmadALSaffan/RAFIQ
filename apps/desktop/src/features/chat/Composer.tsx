/**
 * The message box: text, attachments, the `/ @ #` menus, and the model picker beside the
 * send button. It owns only what you're typing — sending is the page's job.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { providerLabel } from "../../lib/api";
import type { LlmModel, TrackerIssue } from "../../lib/types";
import { fieldDir, isolate } from "../../lib/bidi";
import { stripBidi } from "../../lib/bidi";
import { takeChatMessage } from "../../lib/handoff";
import { easeOutExpo, snappy } from "../../lib/motion";
import { READING_WIDTHS, useLayout } from "../../lib/layout";
import { BrandMark } from "../../components/BrandMark";
import { TokenText } from "../../components/TokenText";
import { UploadChips, useUploads } from "../../components/Attachments";
import { ModelsIcon, PaperclipIcon, StopIcon } from "../../components/Icons";
import {
  CommandMenu,
  FileMenu,
  IssueMenu,
  readTrigger,
  replaceTrigger,
  type CommandDef,
  type CommandId,
} from "../../components/ComposerMenus";
import { MicButton } from "./MicButton";

import { t } from "../../i18n";
export function Composer({
  disabled,
  streaming,
  uploads,
  onSend,
  onStop,
  models,
  modelId,
  onModel,
  folder,
  hasIntegrations,
  inChat,
  openModelMenu,
  onCommand,
  onIssueMentioned,
  prefill,
  webSearch,
  onWebSearch,
}: {
  disabled: boolean;
  streaming: boolean;
  uploads: ReturnType<typeof useUploads>;
  onSend: (text: string) => void;
  onStop: () => void;
  models: LlmModel[];
  modelId: string;
  onModel: (id: string) => void;
  folder: string | null;
  hasIntegrations: boolean;
  inChat: boolean;
  openModelMenu: number;
  onCommand: (id: CommandId) => void;
  onIssueMentioned: (issue: TrackerIssue) => void;
  /** Text to drop in the box (a question being edited); `at` makes repeats take effect. */
  prefill?: { text: string; at: number } | null;
  /** This chat's explicit choice for Rafiq's search tool; undefined = decide by the model. */
  webSearch?: boolean;
  /** Absent when there's no chat yet, so there's nothing to save the choice on. */
  onWebSearch?: (on: boolean) => void;
}) {
  const reading = READING_WIDTHS[useLayout().reading];
  const [text, setText] = useState(() => takeChatMessage() ?? "");
  const [caret, setCaret] = useState(0);
  // Escape hides the menu for the token you're in — but a freshly typed trigger
  // (empty query) always reopens it, so "/" or "@" never silently does nothing.
  const [dismissed, setDismissed] = useState<{ kind: string; start: number } | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const menuKeys = useRef<((e: React.KeyboardEvent) => boolean) | null>(null);
  const canSend = (text.trim().length > 0 || uploads.ready.length > 0) && !uploads.busy && !streaming && !disabled;

  const trigger = readTrigger(text, caret);
  const menuOpen =
    Boolean(trigger) &&
    !(trigger!.query.length > 0 && dismissed?.kind === trigger!.kind && dismissed?.start === trigger!.start);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  // A question being edited: its text replaces whatever is in the box, caret at the end.
  useEffect(() => {
    if (!prefill) return;
    setText(prefill.text);
    setCaret(prefill.text.length);
    const el = ref.current;
    if (el) {
      el.focus();
      requestAnimationFrame(() => el.setSelectionRange(prefill.text.length, prefill.text.length));
    }
  }, [prefill]);

  function sync(el: HTMLTextAreaElement) {
    setText(el.value);
    setCaret(el.selectionStart ?? el.value.length);
  }

  function insert(insertion: string) {
    if (!trigger) return;
    const next = replaceTrigger(text, trigger.start, caret, insertion);
    setText(next.text);
    setDismissed(null);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
      setCaret(next.caret);
    });
  }

  function runCommand(cmd: CommandDef) {
    if (cmd.id === "file") return insert("@");
    if (cmd.id === "task") return insert("#");
    insert("");
    if (cmd.id === "attach") return fileInput.current?.click();
    onCommand(cmd.id);
  }

  function submit() {
    if (!canSend) return;
    // The isolate characters are a display concern — the model never sees them.
    onSend(stripBidi(text));
    setText("");
    setCaret(0);
  }

  return (
    <div className="px-6 pb-5 pt-2">
      <motion.div
        layout
        transition={{ duration: 0.25, ease: easeOutExpo }}
        className="relative mx-auto w-full rounded-2xl border p-2 transition-[border-color,box-shadow] focus-within:border-[var(--color-accent)] focus-within:shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-accent)_18%,transparent)]"
        style={{ maxWidth: reading, borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <AnimatePresence>
          {menuOpen && trigger?.kind === "/" && (
            <CommandMenu
              key="cmd"
              query={trigger.query}
              available={(cmd) =>
                cmd.needs === "folder" ? Boolean(folder) : cmd.needs === "integration" ? hasIntegrations : cmd.needs === "chat" ? inChat : true
              }
              onPick={runCommand}
              onClose={() => setDismissed({ kind: trigger.kind, start: trigger.start })}
              registerKeyHandler={(h) => (menuKeys.current = h)}
            />
          )}
          {menuOpen && trigger?.kind === "@" && (
            <FileMenu
              key="file"
              dir={folder}
              query={trigger.query}
              onPick={(file) => insert(`${isolate(`@${file.path}`)} `)}
              onClose={() => setDismissed({ kind: trigger.kind, start: trigger.start })}
              registerKeyHandler={(h) => (menuKeys.current = h)}
            />
          )}
          {menuOpen && trigger?.kind === "#" && (
            <IssueMenu
              key="issue"
              query={trigger.query}
              onPick={(issue) => {
                onIssueMentioned(issue);
                insert(`${isolate(`#${issue.key}`)} `);
              }}
              onClose={() => setDismissed({ kind: trigger.kind, start: trigger.start })}
              registerKeyHandler={(h) => (menuKeys.current = h)}
            />
          )}
        </AnimatePresence>
        <UploadChips items={uploads.items} onRemove={uploads.remove} />
        <div className="relative">
          {/* Paints the text (with @ملف / #مهمة / الأوامر in the brand colour) behind the
              transparent textarea — the two layers must keep identical metrics. */}
          <div
            ref={mirror}
            aria-hidden
            className="composer-mirror pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-2 py-1.5 text-[0.9375rem] leading-relaxed"
            dir={fieldDir(text)}
          >
            <TokenText text={text} />
          </div>
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => sync(e.currentTarget)}
          onClick={(e) => sync(e.currentTarget)}
          onKeyUp={(e) => sync(e.currentTarget)}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault();
              uploads.add(e.clipboardData.files);
            }
          }}
          onKeyDown={(e) => {
            if (menuOpen && menuKeys.current?.(e)) {
              e.preventDefault();
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape" && streaming) {
              onStop();
            }
          }}
          disabled={disabled}
          rows={1}
          placeholder={disabled ? t("أضف نموذج شغّال أولاً") : t("اكتب رسالتك…  /  للأوامر  ·  @ لملف  ·  # لمهمة")}
          title={t("Enter للإرسال · Shift+Enter لسطر جديد")}
          onScroll={(e) => {
            if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop;
          }}
          className="composer-input relative block max-h-[220px] w-full resize-none bg-transparent px-2 py-1.5 text-[0.9375rem] leading-relaxed outline-none"
          dir={fieldDir(text)}
        />
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <motion.button
              type="button"
              whileTap={{ scale: 0.9, rotate: -20 }}
              onClick={() => fileInput.current?.click()}
              disabled={disabled}
              aria-label={t("إرفاق ملفات")}
              title={t("أرفق صور أو ملفات (أو اسحبها لهون، أو الصق صورة)")}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-40"
              style={{ color: "var(--color-ink-muted)" }}
            >
              <PaperclipIcon className="h-4 w-4" />
            </motion.button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) uploads.add(e.target.files);
                e.target.value = "";
              }}
            />
            <MicButton
              disabled={disabled}
              onText={(spoken) => setText((prev) => (prev ? `${prev.replace(/\s*$/, "")} ${spoken}` : spoken))}
            />
            <ModelMenu
              models={models}
              value={modelId}
              onChange={onModel}
              openSignal={openModelMenu}
              webSearch={webSearch}
              onWebSearch={onWebSearch}
            />
          </div>
          <AnimatePresence mode="wait" initial={false}>
            {streaming ? (
              <motion.button
                key="stop"
                initial={{ scale: 0.6, opacity: 0, rotate: -45 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ duration: 0.18 }}
                whileTap={{ scale: 0.9 }}
                onClick={onStop}
                aria-label={t("إيقاف")}
                title={t("إيقاف (Esc)")}
                className="flex h-9 w-9 items-center justify-center rounded-full"
                style={{ background: "var(--color-ink)", color: "var(--color-bg)" }}
              >
                <StopIcon className="h-4 w-4" />
              </motion.button>
            ) : (
              <motion.button
                key="send"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
                whileTap={{ scale: 0.88, y: -2 }}
                onClick={submit}
                disabled={!canSend}
                aria-label={t("إرسال")}
                title={uploads.busy ? t("استنى لتخلص المرفقات") : undefined}
                className="flex h-9 w-9 items-center justify-center rounded-full transition-opacity disabled:opacity-35"
                style={{ background: "var(--color-accent)", color: "var(--color-accent-ink)" }}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5M6 11l6-6 6 6" />
                </svg>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

function ModelMenu({
  models,
  value,
  onChange,
  openSignal,
  webSearch,
  onWebSearch,
}: {
  models: LlmModel[];
  value: string;
  onChange: (id: string) => void;
  openSignal: number;
  webSearch?: boolean;
  onWebSearch?: (on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = models.find((m) => m.id === value);
  // A model that searches the web itself doesn't get Rafiq's tool unless asked to.
  const ownsSearch = Boolean(current?.native_tools?.includes("web_search"));
  const searchOn = webSearch ?? !ownsSearch;

  // /نموذج opens this dropdown from the command menu.
  useEffect(() => {
    if (openSignal > 0) setOpen(true);
  }, [openSignal]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (models.length === 0) return <span />;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors hover:bg-[var(--color-surface-2)]"
        style={{ color: "var(--color-ink-muted)" }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {current ? <BrandMark provider={current.provider} className="h-3.5 w-3.5" /> : <ModelsIcon className="h-3.5 w-3.5" />}
        <span className="max-w-48 truncate" style={{ color: "var(--color-ink)" }}>
          {current?.name ?? t("اختار نموذج")}
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          ▾
        </motion.span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ duration: 0.2, ease: easeOutExpo }}
            className="absolute bottom-full start-0 mb-2 w-64 origin-bottom overflow-hidden rounded-xl border p-1 shadow-lg"
            style={{ zIndex: "var(--z-index-dropdown)" as unknown as number, borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            {models.map((m, i) => (
              <motion.li key={m.id} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03, duration: 0.18 }}>
                <button
                  role="option"
                  aria-selected={m.id === value}
                  onClick={() => {
                    onChange(m.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-start transition-colors hover:bg-[var(--color-surface-2)]"
                  style={{ background: m.id === value ? "var(--color-surface-2)" : undefined }}
                >
                  <BrandMark provider={m.provider} className="h-4 w-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{m.name}</span>
                    <span className="block text-xs" style={{ color: "var(--color-ink-muted)" }}>
                      {providerLabel(m.provider)}
                      {m.supports_tools === false ? t(" · بدون أدوات") : ""}
                    </span>
                  </span>
                </button>
              </motion.li>
            ))}

            {/* Rafiq's own search tool for this chat. A model that searches the web itself
                (Copilot) starts with this off and uses its own; switching it on hands it
                Rafiq's — which is the one that spends the user's search key. */}
            {onWebSearch && (
              <li className="mt-1 border-t pt-1" style={{ borderColor: "var(--color-border)" }}>
                <button
                  role="switch"
                  aria-checked={searchOn}
                  onClick={() => onWebSearch(!searchOn)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-start transition-colors hover:bg-[var(--color-surface-2)]"
                >
                  <span className="min-w-0">
                    <span className="block text-sm">{t("أداة البحث تبع رفيق")}</span>
                    <span className="block text-xs" style={{ color: "var(--color-ink-muted)" }}>
                      {searchOn
                        ? t("بتستخدم مفتاح البحث تبعك")
                        : ownsSearch
                          ? t("مطفية — الموديل بيدوّر بأداته")
                          : t("مطفية لهالمحادثة")}
                    </span>
                  </span>
                  <span
                    className="flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200"
                    style={{
                      background: searchOn ? "var(--color-accent)" : "var(--color-surface-2)",
                      justifyContent: searchOn ? "flex-end" : "flex-start",
                    }}
                  >
                    <motion.span layout transition={snappy} className="h-4 w-4 rounded-full bg-white shadow-sm" />
                  </span>
                </button>
              </li>
            )}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
