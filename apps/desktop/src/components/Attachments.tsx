import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { attachmentUrl, uploadAttachment } from "../lib/api";
import type { Attachment } from "../lib/types";
import { easeOutExpo, snappy } from "../lib/motion";
import { AlertIcon, FileIcon, XIcon } from "./Icons";

import { t } from "../i18n";
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export interface UploadItem {
  key: string;
  file: File;
  preview?: string;
  progress: number;
  status: "uploading" | "done" | "error";
  attachment?: Attachment;
  error?: string;
}

/** Uploads files the moment they're picked so sending never waits on the network. */
export function useUploads() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const controllers = useRef(new Map<string, AbortController>());

  const patch = useCallback((key: string, next: Partial<UploadItem>) => {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...next } : i)));
  }, []);

  const add = useCallback(
    (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`;
        const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
        const controller = new AbortController();
        controllers.current.set(key, controller);
        setItems((prev) => [...prev, { key, file, preview, progress: 0, status: "uploading" }]);
        uploadAttachment(file, (p) => patch(key, { progress: p }), controller.signal)
          .then((attachment) => patch(key, { status: "done", progress: 1, attachment }))
          .catch((err: unknown) => {
            if (err instanceof DOMException && err.name === "AbortError") return;
            patch(key, { status: "error", error: err instanceof Error ? err.message : t("فشل الرفع") });
          })
          .finally(() => controllers.current.delete(key));
      }
    },
    [patch],
  );

  const remove = useCallback((key: string) => {
    controllers.current.get(key)?.abort();
    setItems((prev) => {
      const item = prev.find((i) => i.key === key);
      if (item?.preview) URL.revokeObjectURL(item.preview);
      return prev.filter((i) => i.key !== key);
    });
  }, []);

  const clear = useCallback(() => {
    setItems((prev) => {
      prev.forEach((i) => i.preview && URL.revokeObjectURL(i.preview));
      return [];
    });
  }, []);

  return {
    items,
    add,
    remove,
    clear,
    busy: items.some((i) => i.status === "uploading"),
    ready: items.filter((i) => i.status === "done" && i.attachment).map((i) => i.attachment!),
  };
}

function ProgressRing({ value }: { value: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 -rotate-90">
      <circle cx="12" cy="12" r={r} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5" />
      <motion.circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={c}
        animate={{ strokeDashoffset: c * (1 - Math.max(value, 0.04)) }}
        transition={{ duration: 0.2 }}
      />
    </svg>
  );
}

export function UploadChips({ items, onRemove }: { items: UploadItem[]; onRemove: (key: string) => void }) {
  return (
    <AnimatePresence initial={false}>
      {items.length > 0 && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: easeOutExpo }}
          className="overflow-hidden"
        >
          <div className="flex flex-wrap gap-2 px-1 pb-2 pt-1">
            <AnimatePresence initial={false} mode="popLayout">
              {items.map((item) => (
                <motion.div
                  key={item.key}
                  layout
                  initial={{ opacity: 0, scale: 0.7, y: 6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.7, transition: { duration: 0.15 } }}
                  transition={snappy}
                  className="group relative"
                  title={item.error ?? item.file.name}
                >
                  {item.preview ? (
                    <div className="relative h-16 w-16 overflow-hidden rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
                      <img src={item.preview} alt={item.file.name} className="h-full w-full object-cover" />
                      <UploadOverlay item={item} />
                    </div>
                  ) : (
                    <div
                      className="relative flex h-16 w-48 items-center gap-2 overflow-hidden rounded-lg border px-2.5"
                      style={{ borderColor: item.status === "error" ? "var(--color-danger)" : "var(--color-border)", background: "var(--color-bg)" }}
                    >
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
                        style={{ background: "var(--color-surface-2)", color: "var(--color-accent)", boxShadow: "inset 0 0 0 1px var(--color-border)" }}
                      >
                        <FileIcon className="h-5 w-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium" dir="auto">
                          {item.file.name}
                        </span>
                        <span className="block text-[11px]" style={{ color: item.status === "error" ? "var(--color-danger)" : "var(--color-ink-muted)" }}>
                          {item.status === "error" ? item.error : item.status === "uploading" ? `${Math.round(item.progress * 100)}%` : formatSize(item.file.size)}
                        </span>
                      </span>
                      {item.status === "uploading" && (
                        <motion.span
                          className="absolute bottom-0 start-0 h-0.5"
                          style={{ background: "var(--color-accent)" }}
                          animate={{ width: `${item.progress * 100}%` }}
                          transition={{ duration: 0.2 }}
                        />
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemove(item.key)}
                    aria-label={t("إزالة")}
                    className="absolute -end-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full opacity-0 shadow transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                    style={{ background: "var(--color-ink)", color: "var(--color-bg)" }}
                  >
                    <XIcon className="h-3 w-3" />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function UploadOverlay({ item }: { item: UploadItem }) {
  return (
    <AnimatePresence>
      {item.status !== "done" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 flex items-center justify-center"
          style={{ background: item.status === "error" ? "color-mix(in oklch, var(--color-danger) 70%, transparent)" : "rgba(0,0,0,0.45)" }}
        >
          {item.status === "error" ? <AlertIcon className="h-5 w-5 text-white" /> : <ProgressRing value={item.progress} />}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function useAttachmentSrc(id: string) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let alive = true;
    attachmentUrl(id).then((url) => alive && setSrc(url));
    return () => {
      alive = false;
    };
  }, [id]);
  return src;
}

function ImageThumb({ attachment, onOpen }: { attachment: Attachment; onOpen: (src: string) => void }) {
  const src = useAttachmentSrc(attachment.id);
  const [loaded, setLoaded] = useState(false);
  return (
    <motion.button
      type="button"
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      transition={snappy}
      onClick={() => src && onOpen(src)}
      className="relative h-24 w-24 overflow-hidden rounded-xl border"
      style={{ borderColor: "var(--color-border)" }}
      title={attachment.name}
    >
      {!loaded && <div className="shimmer absolute inset-0" />}
      {src && (
        <motion.img
          src={src}
          alt={attachment.name}
          onLoad={() => setLoaded(true)}
          initial={{ opacity: 0, scale: 1.08 }}
          animate={loaded ? { opacity: 1, scale: 1 } : {}}
          transition={{ duration: 0.4, ease: easeOutExpo }}
          className="h-full w-full object-cover"
        />
      )}
    </motion.button>
  );
}

function FileChip({ attachment }: { attachment: Attachment }) {
  const src = useAttachmentSrc(attachment.id);
  const label = attachment.kind === "pdf" ? "PDF" : attachment.kind === "text" ? t("نص") : t("ملف");
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className="flex max-w-60 items-center gap-2 rounded-xl border px-2.5 py-2 transition-colors hover:bg-[var(--color-surface-2)]"
      style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
      title={attachment.name}
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
        style={{ background: "var(--color-surface-2)", color: "var(--color-accent)", boxShadow: "inset 0 0 0 1px var(--color-border)" }}
      >
        <FileIcon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium" dir="auto">
          {attachment.name}
        </span>
        <span className="block text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
          {label} · {formatSize(attachment.size)}
        </span>
      </span>
    </a>
  );
}

/** Attachments shown on a sent message; images open in an animated lightbox. */
export function AttachmentGallery({ attachments, align = "start" }: { attachments: Attachment[]; align?: "start" | "end" }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!attachments.length) return null;
  const images = attachments.filter((a) => a.kind === "image");
  const files = attachments.filter((a) => a.kind !== "image");

  return (
    <>
      <div className={`flex flex-wrap gap-2 ${align === "end" ? "justify-end" : ""}`}>
        {images.map((a, i) => (
          <motion.div key={a.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, duration: 0.3, ease: easeOutExpo }}>
            <ImageThumb attachment={a} onOpen={setOpen} />
          </motion.div>
        ))}
        {files.map((a, i) => (
          <motion.div
            key={a.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: (images.length + i) * 0.05, duration: 0.3, ease: easeOutExpo }}
          >
            <FileChip attachment={a} />
          </motion.div>
        ))}
      </div>
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              className="fixed inset-0 flex items-center justify-center p-8"
              style={{ zIndex: "var(--z-index-modal)" as unknown as number, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(6px)" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(null)}
            >
              <motion.img
                src={open}
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ duration: 0.3, ease: easeOutExpo }}
                className="max-h-full max-w-full rounded-xl shadow-2xl"
              />
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

/** Wraps an area so files can be dropped onto it, with an animated "drop here" veil. */
export function DropZone({ onFiles, children, className = "" }: { onFiles: (files: FileList) => void; children: ReactNode; className?: string }) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  return (
    <div
      className={`relative ${className}`}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
      }}
    >
      {children}
      <AnimatePresence>
        {over && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-2xl border-2 border-dashed"
            style={{
              zIndex: "var(--z-index-sticky)" as unknown as number,
              borderColor: "var(--color-accent)",
              background: "color-mix(in oklch, var(--color-bg) 82%, var(--color-accent) 18%)",
            }}
          >
            <motion.div
              initial={{ scale: 0.9, y: 8 }}
              animate={{ scale: 1, y: [0, -6, 0] }}
              transition={{ y: { duration: 1.4, repeat: Infinity, ease: "easeInOut" }, scale: { duration: 0.25, ease: easeOutExpo } }}
              className="flex flex-col items-center gap-2 text-sm font-medium"
              style={{ color: "var(--color-accent)" }}
            >
              <FileIcon className="h-8 w-8" />
              {t("افلت الملفات هون")}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
