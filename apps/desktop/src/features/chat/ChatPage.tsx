/**
 * The chat screen: conversation state, the streaming send, and the commands behind `/`.
 *
 * Rendering lives next door — `Transcript.tsx` draws the messages, `Composer.tsx` owns the
 * message box — so this file stays about *behaviour*: what happens when you send, stop,
 * retry, summarise, export, or hand a design off to a build session.
 *
 * The designs page embeds this same component beside its preview, which is why it takes an
 * explicit chat id and can drop the conversation list and the page header.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  createChat,
  deleteChat,
  deleteChatMessage,
  getChat,
  listChats,
  listIntegrations,
  listModels,
  renameChat,
  resolveChatPermission,
  sendChatMessage,
  setChatFolder,
  setChatPinned,
  summarizeChat,
  updateChatSettings,
} from "../../lib/api";
import type { Attachment, ChatMessage, ChatSummary, LlmModel, ReplySettings, TrackerIssue } from "../../lib/types";
import { canPickNatively, pickFolder } from "../../lib/folders";
import { DEFAULT_LAYOUT, LIST_MAX, LIST_MIN, NAV_COLLAPSED, READING_WIDTHS, setLayout, useLayout } from "../../lib/layout";
import { easeOutExpo, snappy } from "../../lib/motion";
import { ChatList } from "../../components/ChatList";
import { usePageMenu } from "../../components/ContextMenu";
import { Resizer } from "../../components/Resizer";
import { DoneDialog, type CommandId } from "../../components/ComposerMenus";
import { chatToMarkdown, HelpDialog, ReplyConfigDialog, saveTextFile } from "../../components/ChatCommands";
import { DropZone, useUploads } from "../../components/Attachments";
import { DrawnCheck } from "../../components/ui";
import { FolderChip } from "../../components/FolderPicker";
import { AlertIcon, ArrowDownIcon, ChatIcon, CompressIcon } from "../../components/Icons";
import { TokenText } from "../../components/TokenText";
import { Composer } from "./Composer";
import { AssistantBlock, DayDivider, MessageView, startsNewDay, SummaryDivider, Welcome } from "./Transcript";
import { applyEvent, textOf, type Draft } from "./draft";
import { DEFAULT_REPLY_SETTINGS, MODEL_KEY, savedModel } from "./constants";

export function ChatPage({
  chatId,
  embedded = false,
  autoSend,
  onReplyDone,
}: {
  chatId?: string;
  embedded?: boolean;
  /** Sent once, automatically, when the chat opens empty — the design kickoff. */
  autoSend?: string;
  onReplyDone?: () => void;
} = {}) {
  const params = useParams<{ id: string }>();
  const routeId = chatId ?? params.id;
  const navigate = useNavigate();

  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [modelId, setModelId] = useState<string>("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [newChatFolder, setNewChatFolder] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [hasIntegrations, setHasIntegrations] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [lastIssue, setLastIssue] = useState<TrackerIssue | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [configOpen, setConfigOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Bumping this asks the composer's model dropdown to open (that's what /نموذج does).
  const [openModelMenu, setOpenModelMenu] = useState(0);
  const [summarizing, setSummarizing] = useState(false);
  const [loadingChats, setLoadingChats] = useState(true);
  const [atBottom, setAtBottom] = useState(true);

  const abortRef = useRef<AbortController | null>(null);
  const skipLoadRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const uploads = useUploads();

  const layout = useLayout();
  const reading = READING_WIDTHS[layout.reading];
  const usable = models.filter((m) => m.verify_ok !== false);
  const current = chats.find((c) => c.id === routeId);
  const folder = routeId ? current?.working_dir ?? null : newChatFolder;

  useEffect(() => {
    listIntegrations()
      .then((list) => setHasIntegrations(list.some((i) => i.verify_ok !== false)))
      .catch(() => setHasIntegrations(false));
    listChats()
      .then(setChats)
      .finally(() => setLoadingChats(false));
    listModels().then((m) => {
      setModels(m);
      const ok = m.filter((x) => x.verify_ok !== false);
      const remembered = savedModel();
      setModelId((cur) => cur || (ok.find((x) => x.id === remembered) ?? ok[0])?.id || "");
    });
  }, []);

  useEffect(() => {
    setError(null);
    if (!routeId) {
      setMessages([]);
      return;
    }
    if (skipLoadRef.current === routeId) {
      skipLoadRef.current = null;
      return;
    }
    abortRef.current?.abort();
    setLoadingChat(true);
    getChat(routeId)
      .then((chat) => {
        setMessages(chat.messages);
        setChats((prev) => (prev.some((c) => c.id === chat.id) ? prev.map((c) => (c.id === chat.id ? { ...c, ...chat } : c)) : [chat, ...prev]));
        if (chat.model_id && models.some((m) => m.id === chat.model_id && m.verify_ok !== false)) setModelId(chat.model_id);
      })
      .catch(() => !embedded && navigate("/chat", { replace: true }))
      .finally(() => setLoadingChat(false));
    // models intentionally omitted: switching chats shouldn't wait on / refire for the model list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId, navigate, embedded]);

  const autoSent = useRef(false);
  useEffect(() => {
    // Waits for the model list too — send() is a no-op until a model is picked.
    if (!autoSend || !routeId || !modelId || loadingChat || autoSent.current) return;
    if (messages.length > 0 || streaming) return;
    autoSent.current = true;
    void send(autoSend, []);
    // send is stable enough for this one-shot kickoff
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSend, routeId, modelId, loadingChat, messages.length, streaming]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, []);

  useLayoutEffect(() => {
    if (stickRef.current) scrollToBottom();
  }, [messages, draft, scrollToBottom]);

  function pickModel(id: string) {
    setModelId(id);
    try {
      localStorage.setItem(MODEL_KEY, id);
    } catch {
      // convenience only
    }
  }

  async function changeFolder(path: string | null) {
    if (!routeId) {
      setNewChatFolder(path);
      return;
    }
    const updated = await setChatFolder(routeId, path);
    setChats((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
  }

  async function send(text: string, attachments: Attachment[]) {
    const content = text.trim();
    if ((!content && !attachments.length) || streaming || !modelId) return;
    setError(null);
    stickRef.current = true;

    let chatId = routeId;
    if (!chatId) {
      try {
        const chat = await createChat(modelId, newChatFolder);
        chatId = chat.id;
        skipLoadRef.current = chat.id;
        setChats((prev) => [chat, ...prev]);
        setNewChatFolder(null);
        navigate(`/chat/${chat.id}`, { replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : "ما قدرت أبدأ محادثة");
        return;
      }
    }

    const tempId = `temp-${Date.now()}`;
    setMessages((prev) => [...prev, { id: tempId, role: "user", content, attachments, created_at: new Date().toISOString() }]);
    setDraft({ parts: [], reasoning: "" });
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let partial: Draft = { parts: [], reasoning: "" };
    let finished = false;

    try {
      await sendChatMessage(
        chatId,
        content,
        modelId,
        attachments.map((a) => a.id),
        (event) => {
          if (event.type === "start") {
            setMessages((prev) => prev.map((m) => (m.id === tempId ? event.user_message : m)));
            setChats((prev) => {
              const existing = prev.find((c) => c.id === chatId);
              const updated = { ...(existing as ChatSummary), id: chatId!, title: event.title, updated_at: event.user_message.created_at };
              return [updated, ...prev.filter((c) => c.id !== chatId)];
            });
          } else if (event.type === "done") {
            finished = true;
            setMessages((prev) => [...prev, event.message]);
            setDraft(null);
            onReplyDone?.();
          } else if (event.type === "error") {
            setError(event.message);
          } else {
            partial = applyEvent(partial, event);
            setDraft(partial);
          }
        },
        controller.signal,
      );
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : "صار خطأ");
      }
    } finally {
      // Stopped or failed mid-reply: keep what arrived (the backend saved it too).
      if (!finished && partial.parts.length) {
        const kept = partial;
        setMessages((prev) => [
          ...prev,
          {
            id: `partial-${Date.now()}`,
            role: "assistant",
            content: textOf(kept.parts),
            parts: kept.parts.map((p) => (p.kind === "permission" && p.resolution === "pending" ? { ...p, resolution: "denied" as const } : p)),
            reasoning: kept.reasoning,
            created_at: new Date().toISOString(),
          },
        ]);
      }
      setDraft(null);
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function lastAssistantText(): string {
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    return last?.content ?? "";
  }

  /** Success line under the composer; it fades out on its own so they don't pile up. */
  const note = useCallback((text: string) => {
    setNotes((prev) => [...prev, text]);
    setTimeout(() => setNotes((prev) => prev.filter((n) => n !== text)), 7000);
  }, []);

  async function saveSettings(settings: ReplySettings) {
    if (!routeId) return;
    const updated = await updateChatSettings(routeId, settings);
    setChats((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
    note("انحفظت إعدادات الرد");
  }

  /** Folds the old turns into a summary so the next messages cost far fewer tokens. */
  async function summarizeNow() {
    if (!routeId || !modelId || summarizing) return;
    setSummarizing(true);
    setError(null);
    try {
      const result = await summarizeChat(routeId, modelId);
      setChats((prev) =>
        prev.map((c) => (c.id === routeId ? { ...c, summary: result.summary, summary_until: result.summary_until } : c)),
      );
      const saved = Math.max(0, result.approx_tokens_before - result.approx_tokens_after);
      note(`انطوت ${result.folded_messages} رسالة بملخص — توفير ~${saved} توكن بكل رسالة جاية (تقريبي)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ما قدرت ألخّص");
    } finally {
      setSummarizing(false);
    }
  }

  /** Drops the last exchange and sends the same prompt again. */
  async function retryLast() {
    if (!routeId || streaming) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    const stored = (m: ChatMessage) => !m.id.startsWith("temp-") && !m.id.startsWith("partial-");

    setError(null);
    try {
      if (lastAssistant && stored(lastAssistant)) await deleteChatMessage(routeId, lastAssistant.id);
      if (stored(lastUser)) await deleteChatMessage(routeId, lastUser.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ما قدرت أحذف آخر رد");
      return;
    }
    const dropped = new Set([lastUser.id, lastAssistant?.id]);
    setMessages((prev) => prev.filter((m) => !dropped.has(m.id)));
    await send(lastUser.content, lastUser.attachments ?? []);
  }

  async function exportChat() {
    const title = current?.title ?? "محادثة";
    const name = `${title.replace(/[\\/:*?"<>|]/g, "").slice(0, 40) || "rafiq-chat"}.md`;
    try {
      const path = await saveTextFile(name, chatToMarkdown(title, messages));
      if (path) note(`انحفظت المحادثة: ${path}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ما قدرت أصدّر المحادثة");
    }
  }

  async function copyLastReply() {
    const text = lastAssistantText();
    if (!text) return setError("ما في رد لأنسخه.");
    try {
      await navigator.clipboard.writeText(text);
      note("انتسخ آخر رد");
    } catch {
      setError("المتصفح منع النسخ — حدد النص وانسخه يدوياً.");
    }
  }

  async function runCommand(id: CommandId) {
    if (id === "new") return navigate("/chat");
    if (id === "done") return setDoneOpen(true);
    if (id === "config") return setConfigOpen(true);
    if (id === "help") return setHelpOpen(true);
    if (id === "model") return setOpenModelMenu((n) => n + 1);
    if (id === "summarize") return summarizeNow();
    if (id === "retry") return retryLast();
    if (id === "copy") return copyLastReply();
    if (id === "export") return exportChat();
    if (id === "folder") {
      const picked = await pickFolder(folder ?? undefined);
      if (picked) await changeFolder(picked);
      else if (!(await canPickNatively())) setError("افتح زر المجلد فوق وحط المسار يدوياً.");
    }
  }

  function resolvePermission(requestId: string, resolution: "approved" | "denied") {
    if (!routeId) return;
    setDraft((d) => (d ? applyEvent(d, { type: "permission_resolved", id: requestId, resolution }) : d));
    resolveChatPermission(routeId, requestId, resolution);
  }

  async function removeChat(id: string) {
    setChats((prev) => prev.filter((c) => c.id !== id));
    if (id === routeId) navigate("/chat", { replace: true });
    await deleteChat(id);
  }

  async function rename(id: string, title: string) {
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
    const updated = await renameChat(id, title);
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, ...updated } : c)));
  }

  async function pin(id: string, pinned: boolean) {
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, pinned } : c)));
    const updated = await setChatPinned(id, pinned);
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, ...updated } : c)));
  }

  usePageMenu(() => [
    { id: "new-chat", label: "محادثة جديدة", onSelect: () => navigate("/chat") },
    { id: "config", label: "إعدادات الرد", onSelect: () => setConfigOpen(true), disabled: !routeId },
    { id: "summarize", label: "لخّص المحادثة", onSelect: () => void summarizeNow(), disabled: !routeId || summarizing },
    { id: "export", label: "صدّر المحادثة", onSelect: () => void exportChat(), disabled: !routeId },
    { id: "help", label: "الأوامر والاختصارات", onSelect: () => setHelpOpen(true) },
  ]);

  const empty = !routeId && messages.length === 0 && !draft;
  // Past this point the history is the bulk of every request — offer the fold once.
  const longChat = Boolean(routeId) && messages.length >= 20 && !current?.summary && !streaming;

  const listProps = {
    chats,
    models,
    loading: loadingChats,
    activeId: routeId,
    onNew: () => {
      setListOpen(false);
      navigate("/chat");
    },
    onOpen: (id: string) => {
      setListOpen(false);
      navigate(`/chat/${id}`);
    },
    onDelete: removeChat,
    onRename: rename,
    onPin: pin,
  };

  return (
    <div className="flex h-full">
      {!embedded && !layout.listHidden && (
        <>
          <ChatList {...listProps} className="hidden lg:flex" width={layout.list} />
          <div className="hidden lg:flex">
            <Resizer
              value={layout.list}
              min={LIST_MIN}
              max={LIST_MAX}
              onChange={(list) => setLayout({ list })}
              onDoubleClick={() => setLayout({ list: DEFAULT_LAYOUT.list })}
              label="عرض قائمة المحادثات"
            />
          </div>
        </>
      )}

      {/* Narrow windows — and whenever the docked list is hidden by choice — the list
          lives in a drawer that slides out from the nav side. */}
      <AnimatePresence>
        {!embedded && listOpen && (
          <>
            <motion.div
              className={`fixed inset-0 ${layout.listHidden ? "" : "lg:hidden"}`}
              style={{ zIndex: "var(--z-index-modal-backdrop)" as unknown as number, background: "rgba(0,0,0,0.35)" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setListOpen(false)}
            />
            <motion.div
              className={`fixed bottom-0 top-0 flex shadow-2xl ${layout.listHidden ? "" : "lg:hidden"}`}
              style={{
                zIndex: "var(--z-index-modal)" as unknown as number,
                background: "var(--color-bg)",
                insetInlineStart: layout.navCollapsed ? NAV_COLLAPSED : layout.nav,
              }}
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 40, opacity: 0, transition: { duration: 0.18 } }}
              transition={{ duration: 0.32, ease: easeOutExpo }}
            >
              <ChatList {...listProps} className="flex" width={layout.list} />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <DropZone onFiles={uploads.add} className="flex min-w-0 flex-1 flex-col">
        {!embedded && (
        <header className="flex items-center justify-between gap-3 border-b px-6 py-2.5" style={{ borderColor: "var(--color-border)" }}>
          <button
            onClick={() => setListOpen(true)}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-[var(--color-surface-2)] ${layout.listHidden ? "" : "lg:hidden"}`}
            style={{ color: "var(--color-ink-muted)" }}
            aria-label="كل المحادثات"
          >
            <ChatIcon className="h-4 w-4" />
            المحادثات
          </button>
          <AnimatePresence mode="wait" initial={false}>
            <motion.h2
              key={current?.title ?? "new"}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: easeOutExpo }}
              className="min-w-0 flex-1 truncate text-sm font-medium"
              dir="auto"
            >
              <TokenText text={current?.title ?? "محادثة جديدة"} />
            </motion.h2>
          </AnimatePresence>
          <FolderChip value={folder} onChange={changeFolder} />
        </header>
        )}

        <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            stickRef.current = bottom;
            setAtBottom(bottom);
          }}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto flex w-full flex-col gap-6 px-6 py-8" style={{ maxWidth: reading }}>
            {empty ? (
              <Welcome hasModels={usable.length > 0} onPick={(s) => send(s, [])} onModels={() => navigate("/models")} />
            ) : loadingChat ? (
              <div className="flex flex-col gap-4">
                <div className="shimmer h-10 w-2/3 self-end rounded-2xl" />
                <div className="shimmer h-24 rounded-lg" />
              </div>
            ) : (
              <>
                {messages.map((m, i) => (
                  <div key={m.id} className="flex flex-col gap-6">
                    {startsNewDay(messages[i - 1], m) && <DayDivider iso={m.created_at} />}
                    <MessageView
                      message={m}
                      model={models.find((x) => x.id === m.model_id) ?? undefined}
                      onOpenTask={(id) => navigate(`/tasks/${id}`)}
                    />
                    {current?.summary_until === m.id && current.summary && <SummaryDivider summary={current.summary} />}
                  </div>
                ))}
                {summarizing && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center justify-center gap-2 text-xs"
                    style={{ color: "var(--color-ink-muted)" }}
                  >
                    <CompressIcon className="h-4 w-4" />
                    جارِ تلخيص المحادثة…
                  </motion.p>
                )}
                {draft && (
                  <AssistantBlock
                    parts={draft.parts}
                    reasoning={draft.reasoning}
                    live
                    model={models.find((x) => x.id === modelId) ?? undefined}
                    onResolve={resolvePermission}
                    onOpenTask={(id) => navigate(`/tasks/${id}`)}
                  />
                )}
              </>
            )}

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-start gap-2 rounded-lg border px-4 py-3 text-sm"
                  style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}
                  role="alert"
                >
                  <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0 break-words">{error}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Scrolled up mid-conversation (or a reply is streaming out of view). */}
          <AnimatePresence>
            {!atBottom && messages.length > 0 && (
              <motion.button
                initial={{ opacity: 0, y: 8, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.9 }}
                transition={snappy}
                onClick={() => {
                  stickRef.current = true;
                  setAtBottom(true);
                  scrollToBottom();
                }}
                className="absolute bottom-4 left-1/2 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border shadow-lg"
                style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink)" }}
                aria-label="انزل لآخر المحادثة"
                title="انزل لآخر المحادثة"
              >
                <ArrowDownIcon className="h-4 w-4" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {longChat && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="px-6"
            >
              <div className="mx-auto flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2" style={{ maxWidth: reading, borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
                <span className="flex items-center gap-2 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                  <CompressIcon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--color-accent)" }} />
                  المحادثة صارت طويلة — كل رسالة عم تبعت التاريخ كله للنموذج.
                </span>
                <button
                  onClick={summarizeNow}
                  disabled={summarizing}
                  className="shrink-0 rounded-lg px-2.5 py-1 text-xs transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                  style={{ color: "var(--color-accent)" }}
                >
                  {summarizing ? "جارِ التلخيص…" : "لخّصها"}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {notes.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="px-6">
              <div className="mx-auto w-full" style={{ maxWidth: reading }}>
                {notes.map((note, i) => (
                  <motion.p
                    key={`${note}-${i}`}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center gap-2 py-1 text-xs"
                    style={{ color: "var(--color-success)" }}
                  >
                    <DrawnCheck className="h-3.5 w-3.5" />
                    {note}
                  </motion.p>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <Composer
          disabled={usable.length === 0}
          streaming={streaming}
          uploads={uploads}
          onSend={(text) => {
            const ready = uploads.ready;
            uploads.clear();
            send(text, ready);
          }}
          onStop={() => abortRef.current?.abort()}
          models={usable}
          modelId={modelId}
          onModel={pickModel}
          folder={folder}
          hasIntegrations={hasIntegrations}
          inChat={Boolean(routeId)}
          openModelMenu={openModelMenu}
          onCommand={runCommand}
          onIssueMentioned={setLastIssue}
        />
      </DropZone>

      <AnimatePresence>
        {doneOpen && (
          <DoneDialog
            preset={lastIssue}
            defaultComment={lastAssistantText().slice(0, 1500)}
            onClose={() => setDoneOpen(false)}
            onDone={(summary) => note(summary)}
          />
        )}
        {configOpen && (
          <ReplyConfigDialog settings={current?.settings ?? DEFAULT_REPLY_SETTINGS} onClose={() => setConfigOpen(false)} onSave={saveSettings} />
        )}
        {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}
