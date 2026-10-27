/**
 * Talking about parts of a design: the user picks elements in the preview (or across the
 * board's screens), writes what should change in each, and one request goes to the design
 * chat with every part's selector and HTML, so the model edits those parts and nothing else.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { t } from "../../i18n";
import { PickIcon, XIcon } from "../../components/Icons";
import { tellFrame, type PickedPart } from "./preview";

export interface PickItem {
  /** `<frame id>:<uid>` — unique across the board's screens. */
  key: string;
  frame: string;
  uid: number;
  /** Which screen or document it's in. */
  where: string;
  part: PickedPart;
  note: string;
}

/** The chat message for the picked parts that have a note: what to change in each, where,
 *  and the part itself. */
export function pickMessage(items: PickItem[]): string {
  const lines = [t("عدّل هالأجزاء من التصميم:")];
  items.forEach((item, i) => {
    const { part } = item;
    lines.push(
      "",
      t("{0}. بـ «{1}»: {2}", { 0: i + 1, 1: item.where, 2: item.note.trim() }),
      t("<{0}>{1} — المحدد: {2}", { 0: part.tag, 1: part.text ? ` «${part.text.slice(0, 80)}»` : "", 2: part.selector || part.tag }) +
        (part.section ? t(" (جوّا القسم #{0})", { 0: part.section }) : ""),
      "```html",
      part.html,
      "```",
    );
  });
  lines.push("", t("غيّر هالأجزاء بس وخلّي الباقي متل ما هو، وارجع المستندات اللي تغيّرت كاملة."));
  return lines.join("\n");
}

/**
 * Picking across one or more design frames. `frames` gives the frames by id (the board's
 * screens, or the preview's one page); `where` names a frame for the message.
 */
export function usePicker(frames: () => Map<string, HTMLIFrameElement>, where: (frame: string) => string) {
  const [picking, setPicking] = useState(false);
  const [items, setItems] = useState<PickItem[]>([]);
  const latest = useRef({ frames, where });
  latest.current = { frames, where };

  const each = (fn: (frame: HTMLIFrameElement, id: string) => void) => latest.current.frames().forEach(fn);

  const start = useCallback(() => {
    setPicking(true);
    each((f) => tellFrame(f, { type: "pick", on: true }));
  }, []);
  const pause = useCallback(() => {
    setPicking(false);
    each((f) => tellFrame(f, { type: "pick", on: false }));
  }, []);
  const reset = useCallback(() => {
    setPicking(false);
    setItems([]);
    each((f) => tellFrame(f, { type: "clear" }));
  }, []);

  // what the frames say: a part picked or let go, or Escape pressed inside one
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { source?: string; type?: string; uid?: number; info?: PickedPart } | null;
      if (data?.source !== "rafiq-preview") return;
      const frame = [...latest.current.frames().entries()].find(([, f]) => f.contentWindow === e.source)?.[0];
      if (!frame) return;
      if (data.type === "picked" && data.info && data.uid) {
        const item = { key: `${frame}:${data.uid}`, frame, uid: data.uid, where: latest.current.where(frame), part: data.info, note: "" };
        setItems((all) => [...all, item]);
      }
      if (data.type === "unpicked" && data.uid) setItems((all) => all.filter((i) => i.key !== `${frame}:${data.uid}`));
      if (data.type === "pick-cancel") pause();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [pause]);

  // the frames number their marks the way the list does
  useEffect(() => {
    each((f, id) => tellFrame(f, { type: "marks", marks: items.filter((i) => i.frame === id).map((i) => ({ uid: i.uid, n: items.indexOf(i) + 1 })) }));
  }, [items]);

  // Escape outside the frames stops picking too
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && pause();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking, pause]);

  return {
    picking,
    items,
    start,
    pause,
    reset,
    remove: (key: string) => setItems((all) => all.filter((i) => i.key !== key)),
    /** Points at an item's part in its frame: scrolled into view, its mark pulsing. */
    flash: (item: PickItem) => tellFrame(latest.current.frames().get(item.frame), { type: "flash", uid: item.uid }),
    setNote: (key: string, note: string) => setItems((all) => all.map((i) => (i.key === key ? { ...i, note } : i))),
    /** A frame that (re)loaded forgets its marks: they belonged to the page it had. */
    onFrameLoad: (frame: HTMLIFrameElement, id: string) => {
      setItems((all) => (all.some((i) => i.frame === id) ? all.filter((i) => i.frame !== id) : all));
      if (picking) tellFrame(frame, { type: "pick", on: true });
    },
  };
}

/** Short words for a part: its tag and the start of its text. */
function partLabel(part: PickedPart): string {
  return part.text ? `<${part.tag}> «${part.text.slice(0, 36)}${part.text.length > 36 ? "…" : ""}»` : `<${part.tag}>`;
}

/** The hint while picking, before anything is picked. */
export function PickHint({ board = false }: { board?: boolean }) {
  return (
    <motion.p
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="pointer-events-none rounded-full px-3 py-1.5 text-xs shadow-lg"
      style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", color: "var(--color-ink)" }}
      role="status"
    >
      {board ? t("اضغط على الأجزاء اللي بدك تعدّلها بالشاشات — كبسة تانية بتشيلها، Esc بيوقف") : t("اضغط على الأجزاء اللي بدك تعدّلها — كبسة تانية بتشيلها، Esc بيوقف")}
    </motion.p>
  );
}

export function PickComposer({ picker, onSend }: { picker: ReturnType<typeof usePicker>; onSend: (text: string) => void }) {
  const { items, picking } = picker;
  const ready = items.filter((i) => i.note.trim());
  const fields = useRef(new Map<string, HTMLTextAreaElement>());
  const count = useRef(0);

  // a newly picked part takes the keyboard, so picking and writing flow together
  useEffect(() => {
    if (items.length > count.current) fields.current.get(items[items.length - 1].key)?.focus({ preventScroll: true });
    count.current = items.length;
  }, [items]);

  const send = () => {
    if (!ready.length) return;
    onSend(pickMessage(ready));
    picker.reset();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ type: "spring", visualDuration: 0.3, bounce: 0.15 }}
      className="flex max-h-[min(420px,60vh)] w-[min(480px,calc(100%-24px))] flex-col rounded-2xl p-2.5 shadow-xl"
      style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center gap-2 px-1 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
        <PickIcon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--color-accent)" }} />
        <span className="min-w-0 flex-1 truncate font-semibold" style={{ color: "var(--color-ink)" }}>
          {t("{0} جزء محدد", { 0: items.length })}
        </span>
        <button
          type="button"
          onClick={picking ? picker.pause : picker.start}
          className="shrink-0 rounded-full px-2 py-0.5 hover:bg-[var(--color-surface-2)]"
          style={picking ? { color: "var(--color-accent)" } : undefined}
        >
          {picking ? t("وقّف التحديد") : t("حدد كمان")}
        </button>
        <button type="button" onClick={picker.reset} aria-label={t("إلغاء")} title={t("إلغاء")} className="shrink-0 rounded-full p-1 hover:bg-[var(--color-surface-2)]">
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      <ol className="-mx-1 flex min-h-0 flex-col gap-1.5 overflow-y-auto px-1">
        {items.map((item, i) => (
          <motion.li
            key={item.key}
            layout
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-2"
            onPointerEnter={() => picker.flash(item)}
            onFocus={() => picker.flash(item)}
          >
            <span
              className="num mt-2 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-bold"
              style={{ background: "var(--color-accent)", color: "var(--color-accent-ink)" }}
            >
              {i + 1}
            </span>
            <div className="min-w-0 flex-1 rounded-xl px-2.5 py-1.5" style={{ background: "var(--color-surface-2)" }}>
              <div className="flex items-center gap-1 text-[11px]" style={{ color: "var(--color-ink-muted)" }} title={item.part.selector}>
                <span className="min-w-0 flex-1 truncate" dir="auto">
                  {item.where} · <span className="num">{partLabel(item.part)}</span>
                </span>
                <button type="button" onClick={() => picker.remove(item.key)} aria-label={t("شيله")} title={t("شيله")} className="shrink-0 rounded-full p-0.5 hover:bg-[var(--color-surface)]">
                  <XIcon className="h-3 w-3" />
                </button>
              </div>
              <textarea
                ref={(el) => {
                  if (el) fields.current.set(item.key, el);
                  else fields.current.delete(item.key);
                }}
                value={item.note}
                onChange={(e) => picker.setNote(item.key, e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                  if (e.key === "Escape") picker.reset();
                }}
                rows={1}
                dir="auto"
                placeholder={t("شو بدك تغيّر هون؟")}
                className="mt-0.5 w-full resize-none bg-transparent text-sm outline-none [field-sizing:content]"
                style={{ color: "var(--color-ink)" }}
              />
            </div>
          </motion.li>
        ))}
      </ol>

      <div className="mt-2 flex items-center justify-between gap-2 px-1">
        <span className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
          {ready.length < items.length ? t("الأجزاء بلا ملاحظة ما بتنبعت") : ""}
        </span>
        <button
          type="button"
          onClick={send}
          disabled={!ready.length}
          className="h-8 shrink-0 rounded-full px-4 text-xs font-semibold transition-opacity disabled:opacity-40"
          style={{ background: "var(--color-accent)", color: "var(--color-accent-ink)" }}
        >
          {t("ابعت")}
        </button>
      </div>
    </motion.div>
  );
}
