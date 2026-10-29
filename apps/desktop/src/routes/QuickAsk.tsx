/**
 * The quick-ask box: what the global shortcut opens, floating over whatever the user is
 * doing. One question, the reply streaming right under it, and a way into the full app.
 *
 * It's a real chat — it shows up in the chat list like any other, and "Open in Rafiq"
 * takes the conversation to the main window. Esc (or the shortcut again) puts the box
 * away; clicking elsewhere does too, as long as there's nothing on it to lose.
 *
 * When text was selected in the program in front, the box opens on it: one press of
 * translate, fix, rephrase, summarise, reply — or the user's own actions — or a question
 * about it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { attachmentUrl, createChat, getSettings, listModels, sendChatMessage, stopChat, uploadAttachment } from "../lib/api";
import type { LlmModel, QuickAction } from "../lib/types";
import { actionMessage, builtinActions, imageActions, questionAbout } from "../lib/quickAsk";
import { ScreenPicker } from "./ScreenPicker";
import { applyEvent, textOf, type Draft } from "../features/chat/draft";
import { MODEL_KEY, savedModel } from "../features/chat/constants";
import { Markdown } from "../components/Markdown";
import { Logo } from "../components/Logo";
import { CopyIcon, ExternalIcon, PlusIcon, StopIcon, XIcon } from "../components/Icons";
import { useTheme } from "../lib/theme";
import { useCurrentWorkspaceId } from "../lib/workspace";
import { messageDir } from "../lib/bidi";
import { easeOutExpo } from "../lib/motion";
import { t } from "../i18n";

type Turn = { question: string; answer: Draft; error?: string; done: boolean };

async function tauri() {
  const { isTauri, invoke } = await import("@tauri-apps/api/core");
  return isTauri() ? invoke : null;
}

/** Put the box away. In the browser build there's no window to hide; nothing happens. */
async function hide() {
  const invoke = await tauri();
  if (invoke) {
    await invoke("restore_quick_ask");
    await invoke("hide_quick_ask");
  }
}

/** Dev builds in a browser: «?snip=demo» stands in for a picture of the screen. */
function demoScreen(): string {
  const c = document.createElement("canvas");
  c.width = 1600;
  c.height = 900;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1e2430";
  g.fillRect(0, 0, 1600, 900);
  g.fillStyle = "#e8eaf0";
  g.font = "48px sans-serif";
  g.fillText("TypeError: Cannot read properties of undefined", 120, 420);
  return c.toDataURL("image/png");
}

export function QuickAsk() {
  useTheme(); // the saved light/dark, applied to this window too
  const workspaceId = useCurrentWorkspaceId();
  const [models, setModels] = useState<LlmModel[]>([]);
  const [modelId, setModelId] = useState("");
  const [text, setText] = useState("");
  const [chatId, setChatId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  // "Ask about my screen": the picture being cut, then the part attached to the question.
  const [shot, setShot] = useState<string | null>(null);
  const [image, setImage] = useState<{ id: string; url: string } | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const streamingRef = useRef(false);
  const [mine, setMine] = useState<QuickAction[]>([]);
  const box = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const usable = useMemo(() => models.filter((m) => m.verify_ok !== false), [models]);
  const actions = useMemo(() => (image ? imageActions() : [...builtinActions(), ...mine]), [image, mine]);

  useEffect(() => {
    listModels()
      .then((list) => {
        setModels(list);
        const ok = list.filter((m) => m.verify_ok !== false);
        const remembered = savedModel();
        setModelId((ok.find((m) => m.id === remembered) ?? ok[0])?.id ?? "");
      })
      .catch(() => setModels([]));
  }, []);

  const reset = useCallback(() => {
    setChatId(null);
    setTurns([]);
    setText("");
    setSelection(null);
    setImage(null);
    box.current?.focus();
  }, []);

  // Every time the box comes back it's ready to type into; clicking away hides it when
  // there's nothing on it yet (a reply stays until the user decides it's done).
  const idle = turns.length === 0 && !streaming && !shot && !image;
  const idleRef = useRef(idle);
  idleRef.current = idle;

  // What was selected when the shortcut was pressed, handed over once by the native side.
  // New text starts a new question; no text keeps what's on the box (a reply in progress
  // stays), but an unused selection from last time doesn't linger.
  useEffect(() => {
    let off: (() => void) | undefined;
    const pick = async () => {
      getSettings()
        .then((s) => setMine(s.quick_actions ?? []))
        .catch(() => undefined);
      const invoke = await tauri();
      // Dev builds in a browser: «?selection=…» stands in for text selected elsewhere.
      const preview = import.meta.env.DEV ? new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("selection") : null;
      if (!invoke && !preview) return;
      const picked = invoke ? await invoke<string | null>("take_quick_selection").catch(() => null) : preview;
      if (picked) {
        if (!streamingRef.current) {
          setChatId(null);
          setTurns([]);
          setText("");
          setSelection(picked);
        }
      } else if (idleRef.current) {
        setSelection(null);
      }
      box.current?.focus();
    };
    void pick();
    void (async () => {
      const { isTauri } = await import("@tauri-apps/api/core");
      if (!isTauri()) return;
      const { listen } = await import("@tauri-apps/api/event");
      off = await listen("rafiq://quick-opened", () => void pick());
    })();
    return () => off?.();
  }, []);
  // The screen shortcut: the native side took the picture and spread the box over that
  // screen; the picker takes it from here.
  useEffect(() => {
    let off: (() => void) | undefined;
    const take = async () => {
      const invoke = await tauri();
      const url = invoke ? await invoke<string | null>("take_screen_shot").catch(() => null) : demoScreen();
      if (!url || streamingRef.current) return;
      setChatId(null);
      setTurns([]);
      setText("");
      setSelection(null);
      setImage(null);
      setImageError(null);
      setShot(url);
    };
    if (import.meta.env.DEV && new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("snip")) void take();
    void (async () => {
      const { isTauri } = await import("@tauri-apps/api/core");
      if (!isTauri()) return;
      const { listen } = await import("@tauri-apps/api/event");
      off = await listen("rafiq://quick-snip", () => void take());
    })();
    return () => off?.();
  }, []);

  useEffect(() => {
    let off: (() => void) | undefined;
    void (async () => {
      const { isTauri } = await import("@tauri-apps/api/core");
      if (!isTauri()) return;
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      // The first time the box opens it's still loading when Windows decides who gets the
      // keyboard; take it now, so the user can type straight away.
      await win.setFocus().catch(() => undefined);
      box.current?.focus();
      off = await win.onFocusChanged(({ payload: focused }) => {
        if (focused) {
          box.current?.focus();
          return;
        }
        // The window also reports losing focus when the keyboard merely moves into the
        // page inside it. Only a page that has really lost the keyboard means the user
        // clicked elsewhere — so look again a moment later, from the page's side.
        window.setTimeout(() => {
          if (idleRef.current && !document.hasFocus()) void hide();
        }, 200);
      });
    })();
    return () => off?.();
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  // Esc puts the box away wherever the keyboard is inside it, not only in the text box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        void hide();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function ask() {
    const question = text.trim();
    if (!question) return;
    // The first question about a selection carries it; later ones are in the same chat.
    const about = selection && turns.length === 0 ? selection : null;
    void send(question, about ? questionAbout(question, about) : question);
  }

  /** The part of the screen the user picked: the box shrinks back and carries it. */
  async function picked(png: Blob) {
    setShot(null);
    const invoke = await tauri();
    if (invoke) await invoke("restore_quick_ask");
    box.current?.focus();
    try {
      const file = new File([png], `screen-${Date.now()}.png`, { type: "image/png" });
      const uploaded = await uploadAttachment(file);
      setImage({ id: uploaded.id, url: await attachmentUrl(uploaded.id) });
    } catch (e) {
      setImageError(e instanceof Error ? e.message : String(e));
    }
  }

  /** An action on the selected text, or on what's typed when nothing was selected. */
  function act(action: QuickAction) {
    if (image) {
      void send(action.label, action.prompt);
      return;
    }
    const target = selection ?? text.trim();
    if (!target) return;
    void send(action.label, actionMessage(action.prompt, target));
  }

  async function send(question: string, message: string) {
    if (streaming || !modelId) return;
    setText("");
    setStreaming(true);
    streamingRef.current = true;
    setTurns((prev) => [...prev, { question, answer: { parts: [], reasoning: "" }, done: false }]);
    const update = (fn: (turn: Turn) => Turn) =>
      setTurns((prev) => prev.map((turn, i) => (i === prev.length - 1 ? fn(turn) : turn)));
    try {
      let id = chatId;
      if (!id) {
        id = (await createChat(modelId, null, workspaceId)).id;
        setChatId(id);
      }
      // The picture goes with the first question only; later ones are in the same chat.
      const attached = image && turns.length === 0 ? [image.id] : [];
      await sendChatMessage(id, message, modelId, attached, (ev) => {
        if (ev.type === "error") update((turn) => ({ ...turn, error: ev.message }));
        else update((turn) => ({ ...turn, answer: applyEvent(turn.answer, ev) }));
      });
    } catch (e) {
      update((turn) => ({ ...turn, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      update((turn) => ({ ...turn, done: true }));
      setStreaming(false);
      streamingRef.current = false;
      box.current?.focus();
    }
  }

  async function openInRafiq() {
    if (!chatId) return;
    const invoke = await tauri();
    if (invoke) await invoke("open_in_main", { route: `/chat/${chatId}` });
    else window.location.hash = `#/chat/${chatId}`;
    reset();
  }

  /** Settings → General, where the user's own actions are kept. */
  async function openSettings() {
    const invoke = await tauri();
    if (invoke) await invoke("open_in_main", { route: "/settings?tab=general" });
    else window.location.hash = "#/settings?tab=general";
  }

  async function copyLast() {
    const last = turns[turns.length - 1];
    if (!last) return;
    await navigator.clipboard.writeText(textOf(last.answer.parts)).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  function pickModel(id: string) {
    setModelId(id);
    try {
      localStorage.setItem(MODEL_KEY, id);
    } catch {
      // a convenience only
    }
  }

  const muted = { color: "var(--color-ink-muted)" };

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-2xl border" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
      {shot && (
        <ScreenPicker
          src={shot}
          onPick={(png) => void picked(png)}
          onCancel={() => {
            setShot(null);
            void hide();
          }}
        />
      )}
      {/* The window has no frame: this strip is what the user drags it by. */}
      <header data-tauri-drag-region className="flex shrink-0 items-center gap-2 px-4 pb-1 pt-3 select-none">
        <Logo className="pointer-events-none h-5 w-5" />
        <span data-tauri-drag-region className="flex-1 text-xs font-medium" style={muted}>
          {t("سؤال سريع")}
        </span>
        {usable.length > 1 && (
          <select
            value={modelId}
            onChange={(e) => pickModel(e.target.value)}
            aria-label={t("النموذج")}
            className="max-w-44 truncate rounded-md border bg-transparent px-1.5 py-0.5 text-[11px]"
            style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }}
          >
            {usable.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        <kbd className="rounded border px-1.5 text-[10px]" style={{ borderColor: "var(--color-border)", ...muted }} dir="ltr">
          Esc
        </kbd>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        {usable.length === 0 && models.length > 0 && (
          <p className="py-6 text-center text-sm" style={muted}>
            {t("ما في نموذج شغّال — أضف واحد من صفحة النماذج.")}
          </p>
        )}
        {selection && (
          <div className="mb-1 mt-1 rounded-xl border px-3 py-2" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
            <div className="mb-1 flex items-center gap-2">
              <span className="flex-1 text-[11px] font-medium" style={muted}>
                {t("النص المحدد · {0} حرف", { 0: String(selection.length) })}
              </span>
              <button
                onClick={() => {
                  setSelection(null);
                  box.current?.focus();
                }}
                disabled={streaming}
                aria-label={t("شيل النص المحدد")}
                className="rounded p-0.5 transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-40"
                style={muted}
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed" dir="auto" style={{ color: "var(--color-ink)" }}>
              {selection}
            </p>
          </div>
        )}
        {(image || imageError) && (
          <div className="mb-1 mt-1 flex items-start gap-3 rounded-xl border px-3 py-2" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
            {image && (
              <img
                src={image.url}
                alt={t("الجزء اللي حددته من الشاشة")}
                className="max-h-28 max-w-[60%] rounded-md border object-contain"
                style={{ borderColor: "var(--color-border)" }}
              />
            )}
            <p className="min-w-0 flex-1 text-[11px] font-medium" style={imageError ? { color: "var(--color-danger)" } : muted} role={imageError ? "alert" : undefined}>
              {imageError ?? t("صورة من شاشتك: اسأل عنها أو اختار أمر")}
            </p>
            <button
              onClick={() => {
                setImage(null);
                setImageError(null);
                box.current?.focus();
              }}
              disabled={streaming}
              aria-label={t("شيل الصورة")}
              className="rounded p-0.5 transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-40"
              style={muted}
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {turns.length === 0 && !selection && !image && usable.length > 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 pb-4 text-center">
            <p className="text-sm" style={{ color: "var(--color-ink)" }}>
              {t("اسأل، وخلّي شغلك مفتوح.")}
            </p>
            <p className="text-[11px]" style={muted}>
              {t("Enter للإرسال · Shift+Enter لسطر جديد · Esc للإخفاء")}
            </p>
          </div>
        )}
        <AnimatePresence initial={false}>
          {turns.map((turn, i) => {
            const answer = textOf(turn.answer.parts);
            const working = !turn.done && !answer && !turn.error;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: easeOutExpo }}
                className="py-2"
              >
                <p className="mb-2 text-sm font-medium" dir="auto" style={{ color: "var(--color-ink)" }}>
                  {turn.question}
                </p>
                {working && (
                  <motion.p
                    className="text-xs"
                    style={muted}
                    animate={{ opacity: [1, 0.4, 1] }}
                    transition={{ duration: 1.2, repeat: Infinity }}
                  >
                    {t("عم يفكّر…")}
                  </motion.p>
                )}
                {answer && (
                  <div className="text-sm leading-relaxed" dir="auto">
                    <Markdown text={answer} />
                  </div>
                )}
                {turn.error && (
                  <p className="mt-1 text-xs" style={{ color: "var(--color-danger)" }} role="alert">
                    {turn.error}
                  </p>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
        <div ref={bottom} />
      </div>

      {/* One press on the selected text — or on what's typed, when nothing was selected. */}
      {((image && turns.length === 0) || selection || (turns.length === 0 && text.trim())) && !streaming && modelId && (
        <div className="mx-2 mb-1.5 flex shrink-0 flex-wrap gap-1.5 px-1" role="group" aria-label={t("أوامر سريعة")}>
          {actions.map((action) => (
            <button
              key={action.id}
              onClick={() => act(action)}
              title={action.prompt}
              className="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--color-surface-2)]"
              style={{ borderColor: "var(--color-border)", color: "var(--color-ink)" }}
              dir="auto"
            >
              {action.label}
            </button>
          ))}
          {!image && (
          <button
            onClick={() => void openSettings()}
            className="rounded-full border border-dashed px-2.5 py-1 text-[11px] transition-colors hover:bg-[var(--color-surface-2)]"
            style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }}
          >
            {t("+ أمر خاص فيك")}
          </button>
          )}
        </div>
      )}

      <div className="m-2 mt-0 shrink-0 rounded-xl px-3 pb-2.5 pt-2" style={{ background: "var(--color-surface-2)" }}>
        {turns.length > 0 && (
          <div className="mb-2 flex items-center gap-1">
            <QuickButton onClick={() => void openInRafiq()} disabled={!chatId}>
              <ExternalIcon className="h-3.5 w-3.5" />
              {t("افتح برفيق")}
            </QuickButton>
            <QuickButton onClick={() => void copyLast()} disabled={streaming}>
              <CopyIcon className="h-3.5 w-3.5" />
              {copied ? t("انتسخ") : t("انسخ الرد")}
            </QuickButton>
            <QuickButton onClick={reset} disabled={streaming}>
              <PlusIcon className="h-3.5 w-3.5" />
              {t("سؤال جديد")}
            </QuickButton>
            {streaming && chatId && (
              <QuickButton onClick={() => void stopChat(chatId)}>
                <StopIcon className="h-3.5 w-3.5" />
                {t("وقّف")}
              </QuickButton>
            )}
          </div>
        )}
        <textarea
          ref={box}
          autoFocus
          value={text}
          rows={turns.length ? 1 : 2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              ask();
            }
          }}
          placeholder={turns.length ? t("كمّل السؤال…") : image ? t("اسأل عن الصورة…") : selection ? t("اسأل عن النص المحدد…") : t("اسأل رفيق أي شي…")}
          aria-label={t("اسأل رفيق أي شي…")}
          disabled={!modelId}
          className="max-h-32 w-full resize-none bg-transparent px-1 text-[0.9375rem] outline-none"
          style={{ color: "var(--color-ink)" }}
          dir={messageDir(text)}
        />
      </div>
    </div>
  );
}

function QuickButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-40"
      style={{ color: "var(--color-ink-muted)" }}
    >
      {children}
    </button>
  );
}
