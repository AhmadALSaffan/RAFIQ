import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ChatSearchResult, ChatSummary, LlmModel } from "../lib/types";
import { searchChats } from "../lib/api";
import { easeOutExpo, snappy } from "../lib/motion";
import { timeAgo } from "../lib/time";
import { folderName } from "../lib/folders";
import { fieldDir } from "../lib/bidi";
import { BrandMark } from "./BrandMark";
import { TokenText } from "./TokenText";
import { CompressIcon, FolderIcon, PencilIcon, PinIcon, PlusIcon, SearchIcon, TrashIcon, XIcon } from "./Icons";
import { Button } from "./ui";
import { useElementMenu } from "./ContextMenu";

import { t } from "../i18n";
/** Buckets conversations the way the user thinks about them: pinned first, then recency. */
function bucketOf(chat: ChatSummary, now: number): string {
  if (chat.pinned) return t("مثبّتة");
  const age = now - new Date(chat.updated_at).getTime();
  const day = 86_400_000;
  if (age < day) return t("اليوم");
  if (age < 2 * day) return t("أمس");
  if (age < 7 * day) return t("آخر ٧ أيام");
  if (age < 30 * day) return t("آخر ٣٠ يوم");
  return t("أقدم");
}

const ORDER = [t("مثبّتة"), t("اليوم"), t("أمس"), t("آخر ٧ أيام"), t("آخر ٣٠ يوم"), t("أقدم")];

// From two characters on, the search looks inside every message (on the agent); one
// character only narrows the titles already on screen.
const DEEP_SEARCH_FROM = 2;
const DEBOUNCE_MS = 220;

/** Looks inside the messages as the user types; the newest query wins, older ones are dropped. */
function useChatSearch(query: string, workspaceId?: string | null, refreshKey?: unknown) {
  const [results, setResults] = useState<ChatSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const q = query.trim();
  const deep = q.length >= DEEP_SEARCH_FROM;

  useEffect(() => {
    if (!deep) {
      setResults(null);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(() => {
      searchChats(q, workspaceId, controller.signal)
        .then((found) => setResults(found))
        .catch((e: unknown) => {
          if ((e as { name?: string })?.name !== "AbortError") setResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q, deep, workspaceId, refreshKey]);

  return { deep, results, searching };
}

/** The snippet with the matched words marked. */
function Marked({ text, marks }: { text: string; marks: [number, number][] }) {
  const pieces: React.ReactNode[] = [];
  let at = 0;
  marks.forEach(([start, end], i) => {
    if (start > at) pieces.push(text.slice(at, start));
    pieces.push(
      <mark
        key={i}
        className="rounded-[3px] px-px"
        style={{ background: "color-mix(in oklch, var(--color-accent) 32%, transparent)", color: "var(--color-ink)" }}
      >
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  });
  if (at < text.length) pieces.push(text.slice(at));
  return <>{pieces}</>;
}

export function ChatList({
  chats,
  models,
  activeId,
  loading = false,
  onNew,
  onOpen,
  onDelete,
  onRename,
  onPin,
  className = "",
  width,
  workspaceId,
}: {
  chats: ChatSummary[];
  models: LlmModel[];
  activeId?: string;
  loading?: boolean;
  onNew: () => void;
  /** `messageId` when opened from a search result: the chat opens at that message. */
  onOpen: (id: string, messageId?: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  className?: string;
  width?: number;
  /** Search the same chats the list shows. */
  workspaceId?: string | null;
}) {
  const [query, setQuery] = useState("");
  // A new or deleted chat changes what a search should find, so it searches again.
  const { deep, results, searching } = useChatSearch(query, workspaceId, chats.length);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const groups = useMemo(() => {
    const now = Date.now();
    const q = query.trim().toLowerCase();
    const matched = q ? chats.filter((c) => c.title.toLowerCase().includes(q)) : chats;
    const map = new Map<string, ChatSummary[]>();
    for (const chat of matched) {
      const bucket = bucketOf(chat, now);
      map.set(bucket, [...(map.get(bucket) ?? []), chat]);
    }
    return ORDER.filter((name) => map.has(name)).map((name) => ({ name, items: map.get(name)! }));
  }, [chats, query]);

  return (
    <aside
      className={`shrink-0 flex-col border-e ${className}`}
      style={{ width: width ?? 240, borderColor: "var(--color-border)", background: "var(--color-bg)" }}
    >
      <div className="flex flex-col gap-2 p-3">
        <Button className="w-full" onClick={onNew}>
          <PlusIcon className="h-4 w-4" />
          {t("محادثة جديدة")}
        </Button>

        <div
          className="flex items-center gap-2 rounded-lg border px-2.5 transition-colors focus-within:border-[var(--color-accent)]"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <SearchIcon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--color-ink-muted)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder={t("دوّر بالعناوين والرسائل…")}
            aria-label={t("دوّر بالعناوين والرسائل…")}
            className="w-full bg-transparent py-1.5 text-xs outline-none"
            style={{ color: "var(--color-ink)" }}
            dir={fieldDir(query)}
          />
          <AnimatePresence>
            {query && (
              <motion.button
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                onClick={() => setQuery("")}
                aria-label={t("امسح البحث")}
                className="shrink-0 rounded p-0.5"
                style={{ color: "var(--color-ink-muted)" }}
              >
                <XIcon className="h-3 w-3" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading && chats.length === 0 && (
          <div className="flex flex-col gap-2 px-1">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="shimmer h-12 rounded-lg" />
            ))}
          </div>
        )}

        {deep && (
          <SearchResults
            query={query.trim()}
            results={results}
            searching={searching}
            activeId={activeId}
            onOpen={onOpen}
          />
        )}

        {!deep && groups.map((group) => (
          <section key={group.name}>
            <h3
              className="sticky top-0 z-10 px-2 py-1.5 text-[11px] font-medium backdrop-blur"
              style={{ color: "var(--color-ink-muted)", background: "color-mix(in oklch, var(--color-bg) 85%, transparent)" }}
            >
              {group.name}
              <span className="ms-1 tabular-nums opacity-60">{group.items.length}</span>
            </h3>
            <ul>
              <AnimatePresence initial={false}>
                {group.items.map((chat, i) => (
                  <Row
                    key={chat.id}
                    chat={chat}
                    index={i}
                    model={models.find((m) => m.id === chat.model_id)}
                    active={chat.id === activeId}
                    renaming={renaming === chat.id}
                    confirming={confirming === chat.id}
                    onOpen={() => onOpen(chat.id)}
                    onStartRename={() => {
                      setConfirming(null);
                      setRenaming(chat.id);
                    }}
                    onRename={(title) => {
                      setRenaming(null);
                      if (title.trim() && title.trim() !== chat.title) onRename(chat.id, title.trim());
                    }}
                    onPin={() => onPin(chat.id, !chat.pinned)}
                    onDelete={() => (confirming === chat.id ? onDelete(chat.id) : setConfirming(chat.id))}
                    onLeave={() => confirming === chat.id && setConfirming(null)}
                  />
                ))}
              </AnimatePresence>
            </ul>
          </section>
        ))}

        {!loading && chats.length === 0 && (
          <p className="px-3 py-8 text-center text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
            {t("محادثاتك رح تظهر هون.")}
            <br />
            {t("ابدأ وحدة واسأل رفيق أي شي.")}
          </p>
        )}
        {!deep && !loading && chats.length > 0 && groups.length === 0 && (
          <p className="px-3 py-8 text-center text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {t("ما في محادثة بهالاسم.")}
          </p>
        )}
      </div>
    </aside>
  );
}

function SearchResults({
  query,
  results,
  searching,
  activeId,
  onOpen,
}: {
  query: string;
  results: ChatSearchResult[] | null;
  searching: boolean;
  activeId?: string;
  onOpen: (id: string, messageId?: string) => void;
}) {
  const muted = { color: "var(--color-ink-muted)" };
  return (
    <section aria-live="polite">
      <h3
        className="sticky top-0 z-10 flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium backdrop-blur"
        style={{ ...muted, background: "color-mix(in oklch, var(--color-bg) 85%, transparent)" }}
      >
        {t("نتائج البحث")}
        {results && <span className="tabular-nums opacity-60">{results.length}</span>}
        {searching && (
          <motion.span
            className="ms-auto h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--color-accent)" }}
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
            aria-label={t("عم يدوّر…")}
          />
        )}
      </h3>

      {results === null && searching && (
        <div className="flex flex-col gap-2 px-1 pt-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="shimmer h-14 rounded-lg" />
          ))}
        </div>
      )}

      {results && results.length === 0 && !searching && (
        <p className="px-3 py-8 text-center text-xs leading-relaxed" style={muted}>
          {t("ما لقيت شي بـ «{0}».", { 0: query })}
        </p>
      )}

      <ul>
        <AnimatePresence initial={false}>
          {results?.map((r, i) => (
            <motion.li
              key={r.chat_id}
              layout="position"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.2, delay: Math.min(i, 8) * 0.02, ease: easeOutExpo } }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
            >
              <button
                onClick={() => onOpen(r.chat_id, r.snippet?.message_id)}
                className="flex w-full flex-col items-start gap-1 rounded-lg px-3 py-2 text-start transition-colors hover:bg-[var(--color-surface)]"
                style={r.chat_id === activeId ? { background: "var(--color-surface-2)" } : undefined}
              >
                <span className="flex w-full items-center gap-1.5">
                  {r.pinned && <PinIcon className="h-3 w-3 shrink-0" style={{ color: "var(--color-accent)" }} />}
                  <span className="min-w-0 flex-1 truncate text-sm" dir="auto">
                    <TokenText text={r.title} />
                  </span>
                </span>
                {r.snippet && (
                  <span className="line-clamp-2 text-[12px] leading-relaxed" dir="auto" style={muted}>
                    <span className="font-medium" style={{ color: "var(--color-ink)" }}>
                      {r.snippet.role === "user" ? t("إنت:") : t("رفيق:")}{" "}
                    </span>
                    <Marked text={r.snippet.text} marks={r.snippet.marks} />
                  </span>
                )}
                <span className="flex items-center gap-1.5 text-[11px]" style={muted}>
                  <span>{timeAgo(r.updated_at)}</span>
                  {r.matches > 0 && (
                    <>
                      <span className="opacity-50">·</span>
                      <span className="tabular-nums">{t("{0} نتيجة", { 0: r.matches })}</span>
                    </>
                  )}
                  {r.title_match && (
                    <>
                      <span className="opacity-50">·</span>
                      <span>{t("بالعنوان")}</span>
                    </>
                  )}
                </span>
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}

function Row({
  chat,
  index,
  model,
  active,
  renaming,
  confirming,
  onOpen,
  onStartRename,
  onRename,
  onPin,
  onDelete,
  onLeave,
}: {
  chat: ChatSummary;
  index: number;
  model?: LlmModel;
  active: boolean;
  renaming: boolean;
  confirming: boolean;
  onOpen: () => void;
  onStartRename: () => void;
  onRename: (title: string) => void;
  onPin: () => void;
  onDelete: () => void;
  onLeave: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const menu = useElementMenu();

  return (
    <motion.li
      layout="position"
      onContextMenu={menu(() => [
        { id: "open", label: t("افتح المحادثة"), onSelect: onOpen },
        { id: "pin", label: chat.pinned ? t("إلغاء التثبيت") : t("ثبّت فوق"), onSelect: onPin },
        { id: "rename", label: t("إعادة تسمية"), onSelect: onStartRename },
        { id: "delete", label: t("احذف المحادثة"), onSelect: onDelete, danger: true },
      ])}
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0, transition: { duration: 0.25, delay: Math.min(index, 8) * 0.02, ease: easeOutExpo } }}
      exit={{ opacity: 0, x: -10, height: 0, transition: { duration: 0.18 } }}
      className="group relative"
      onMouseLeave={onLeave}
    >
      {active && (
        <motion.span
          layoutId="chat-active"
          className="absolute inset-0 rounded-lg"
          style={{ background: "var(--color-surface-2)", boxShadow: "inset 0 0 0 1px var(--color-border)" }}
          transition={snappy}
        />
      )}
      {active && (
        <motion.span
          layoutId="chat-active-bar"
          className="absolute inset-y-2 end-0 w-0.5 rounded-full"
          style={{ background: "var(--color-accent)" }}
          transition={snappy}
        />
      )}

      {renaming ? (
        <input
          ref={input}
          autoFocus
          defaultValue={chat.title}
          onBlur={(e) => onRename(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") input.current?.blur();
            if (e.key === "Escape") onRename(chat.title);
          }}
          className="relative w-full rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ borderColor: "var(--color-accent)", background: "var(--color-surface)", color: "var(--color-ink)" }}
          dir="auto"
        />
      ) : (
        <button
          onClick={onOpen}
          onDoubleClick={onStartRename}
          className="relative flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-start transition-colors hover:bg-[var(--color-surface)]"
        >
          <span className="flex w-full items-center gap-1.5">
            {chat.pinned && <PinIcon className="h-3 w-3 shrink-0" style={{ color: "var(--color-accent)" }} />}
            <span className="min-w-0 flex-1 truncate text-sm" dir="auto" style={{ color: active ? "var(--color-ink)" : undefined }}>
              <TokenText text={chat.title} />
            </span>
            {chat.streaming && (
              <motion.span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: "var(--color-accent)" }}
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                title={t("عم يكتب رد…")}
                aria-label={t("عم يكتب رد…")}
              />
            )}
          </span>
          <span className="flex w-full items-center gap-1.5 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
            {model && <BrandMark provider={model.provider} className="h-3 w-3 shrink-0" />}
            <span className="shrink-0">{timeAgo(chat.updated_at)}</span>
            {chat.message_count > 0 && (
              <>
                <span className="opacity-50">·</span>
                <span className="shrink-0 tabular-nums">{t("{0} رسالة", { 0: chat.message_count })}</span>
              </>
            )}
            {chat.summary && (
              <span title={t("متلخّصة — الرسائل القديمة انطوت")} className="flex shrink-0">
                <CompressIcon className="h-3 w-3" />
              </span>
            )}
            {chat.working_dir && (
              <span className="flex min-w-0 items-center gap-1" title={chat.working_dir}>
                <FolderIcon className="h-3 w-3 shrink-0" />
                <span className="truncate" dir="ltr">
                  {folderName(chat.working_dir)}
                </span>
              </span>
            )}
          </span>
        </button>
      )}

      {!renaming && (
        <span
          className={`absolute end-1.5 top-1.5 flex items-center gap-0.5 rounded-md p-0.5 transition-opacity ${
            confirming ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
          }`}
          style={{ background: "var(--color-surface-2)" }}
        >
          <Action label={chat.pinned ? t("إلغاء التثبيت") : t("ثبّت")} onClick={onPin} active={chat.pinned}>
            <PinIcon className="h-3.5 w-3.5" />
          </Action>
          <Action label={t("إعادة تسمية")} onClick={onStartRename}>
            <PencilIcon className="h-3.5 w-3.5" />
          </Action>
          <Action label={confirming ? t("اضغط مرة ثانية للحذف") : t("حذف")} onClick={onDelete} danger={confirming}>
            <TrashIcon className="h-3.5 w-3.5" />
          </Action>
        </span>
      )}
    </motion.li>
  );
}

function Action({
  label,
  onClick,
  children,
  danger = false,
  active = false,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.88 }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
      className="rounded p-1 transition-colors hover:bg-[var(--color-surface)]"
      style={{
        color: danger ? "white" : active ? "var(--color-accent)" : "var(--color-ink-muted)",
        background: danger ? "var(--color-danger)" : "transparent",
      }}
    >
      {children}
    </motion.button>
  );
}
