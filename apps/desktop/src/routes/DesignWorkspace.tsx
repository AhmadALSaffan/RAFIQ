import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "../components/arc/tabs/tabs";
import { Breadcrumb } from "../components/easy/breadcrumb";
import { useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  addSkill,
  askDesignVariants,
  chooseDesignVariant,
  deleteSkill,
  getDesignVersion,
  listDesignVersions,
  restoreDesignVersion,
  undoDesignReply,
  getDesign,
  handoffDesign,
  listChats,
  listDesignDocuments,
  listModels,
  listSkills,
  readDesignDocument,
  readSkill,
  renameDesign,
  saveDesignBoard,
  setDesignFolder,
} from "../lib/api";
import type { AgentSkill, ChatMessage, ChatSummary, Design, DesignDocument, LlmModel } from "../lib/types";
import { easeOutExpo, snappy } from "../lib/motion";
import { queueChatMessage } from "../lib/handoff";
import { fieldDir } from "../lib/bidi";
import { guarded } from "../features/design/preview";
import { PickComposer, PickHint, usePicker } from "../features/design/PickComposer";
import { BeforeAfter, DesignReplyActions, VariantsView } from "../features/design/CompareViews";
import { previousOf } from "../features/design/HistoryPane";
import { HistoryPane } from "../features/design/HistoryPane";
import { Board } from "../features/design/Board";
import { boardHtml, boardItems } from "../features/design/boardLayout";
import { notify } from "../lib/toast";

import { folderName, pickFolder, revealPath } from "../lib/folders";
import { openExternal } from "../lib/links";
import { FolderChip } from "../components/FolderPicker";
import { Markdown } from "../components/Markdown";
import { Wireframe } from "../components/brand";
import { Button, DrawnCheck } from "../components/ui";
import { Resizer } from "../components/Resizer";
import { usePageMenu } from "../components/ContextMenu";
import { ChatPage } from "../features/chat";
import { AlertIcon, ArrowDownIcon, ChatIcon, FileIcon, FolderIcon, LayersIcon, PickIcon, PlusIcon, RefreshIcon, ShieldIcon, TasksIcon, TrashIcon, UndoIcon, XIcon, PencilIcon } from "../components/Icons";
import { BuildProgress } from "../features/design/BuildProgress";
import { buildOutline, type BuildOutline } from "../features/design/buildOutline";
import { SLOP_REQUEST } from "../components/ComposerMenus";

import { t } from "../i18n";
const DEVICES = [
  { id: "board", label: t("لوحة"), width: 0 },
  { id: "mobile", label: t("موبايل"), width: 390 },
  { id: "tablet", label: t("تابلت"), width: 820 },
  { id: "desktop", label: t("شاشة"), width: 0 },
] as const;

/** Which way the designed product reads, from the brief's answer ("عربي RTL", "English LTR"…). */
function briefDir(brief: Record<string, string | string[]> | null): "rtl" | "ltr" {
  const answer = String(brief?.direction ?? "");
  if (/ltr/i.test(answer) && !/rtl/i.test(answer)) return "ltr";
  if (/rtl/i.test(answer)) return "rtl";
  return document.documentElement.dir === "ltr" ? "ltr" : "rtl";
}

type Tab = "preview" | "history" | "spec" | "skills";

export function DesignWorkspace() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [design, setDesign] = useState<Design | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("preview");
  const [device, setDevice] = useState<(typeof DEVICES)[number]["id"]>("desktop");
  const [chatWidth, setChatWidth] = useState(420);
  const [handoffOpen, setHandoffOpen] = useState(false);
  // A message a button here sends into the design chat (the AI-slop check).
  const [sendRequest, setSendRequest] = useState<{ id: number; text: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  // What the preview can open, and which one the user picked. Null follows the model:
  // the newest document wins, which is what someone watching a design expects.
  const [documents, setDocuments] = useState<DesignDocument[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  // Folder files are read when they're first opened, then kept.
  const [folderHtml, setFolderHtml] = useState<Record<string, string>>({});
  // A reply's before and after, open over the preview: which reply, which of its documents,
  // and the two versions' HTML (null while loading; `before` null when the reply made it).
  const [compare, setCompare] = useState<{ message: string; documents: string[]; current: string; before: string | null; after: string | null } | null>(null);
  // The variants, side by side, while there are some to choose between (closable).
  const [variantsHidden, setVariantsHidden] = useState(false);
  const [asking, setAsking] = useState(false);
  // What the reply being written has built so far — the preview shows it assembling.
  const [outline, setOutline] = useState<BuildOutline | null>(null);
  const onDraftText = useCallback((text: string | null) => {
    const next = text ? buildOutline(text) : null;
    setOutline((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, []);
  // Going back to before a reply: the preview winds back while the old version loads.
  const [rewinding, setRewinding] = useState(false);
  const rewind = async <T,>(run: () => Promise<T>): Promise<T> => {
    setRewinding(true);
    const started = Date.now();
    try {
      return await run();
    } finally {
      setTimeout(() => setRewinding(false), Math.max(0, 650 - (Date.now() - started)));
    }
  };

  const refresh = useCallback(async () => {
    try {
      const next = await getDesign(id);
      setDesign(next);
      // The folder may have gained an .html file the model wrote with its own tools.
      setDocuments(await listDesignDocuments(id).catch(() => []));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ما لقيت التصميم"));
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [id, refresh]);

  // An app's design opens on its board.
  const boardOpened = useRef(false);
  useEffect(() => {
    if (!design?.board || boardOpened.current) return;
    boardOpened.current = true;
    setDevice("board");
  }, [design?.board]);

  // The newest document of the conversation is the default — the one the model just wrote.
  // (Variants are side documents: the page stays the default while they're compared and after.)
  const pages = documents.filter((d) => !/^variant-/i.test(d.name));
  const newest = [...pages].reverse().find((d) => d.source === "chat") ?? pages[pages.length - 1] ?? documents[documents.length - 1] ?? null;
  const active = documents.find((d) => documentKey(d) === picked) ?? newest;
  const activeHtml = active
    ? active.source === "folder"
      ? (folderHtml[active.path ?? ""] ?? null)
      : (design?.files?.find((f) => f.name === active.name)?.html ?? design?.preview_html ?? null)
    : null;

  // The board shows every document: the chat's, and the HTML files in the design's folder
  // (a model may write its screens there with its own tools). All of them are read for it.
  const onBoard = device === "board";
  useEffect(() => {
    if (!onBoard) return;
    const unread = documents.filter((d) => d.source === "folder" && d.path && folderHtml[d.path] === undefined);
    if (!unread.length) return;
    let alive = true;
    void Promise.all(
      unread.map((d) =>
        readDesignDocument(id, d.path as string)
          .then((doc) => [d.path as string, doc.html] as const)
          .catch(() => [d.path as string, ""] as const),
      ),
    ).then((read) => alive && setFolderHtml((all) => ({ ...all, ...Object.fromEntries(read) })));
    return () => {
      alive = false;
    };
  }, [onBoard, documents, folderHtml, id]);
  const boardFiles = useMemo(() => {
    const files = design?.files ?? [];
    const named = new Set(files.map((f) => f.name.toLowerCase()));
    const fromFolder = documents
      .filter((d) => d.source === "folder" && d.path && folderHtml[d.path] && !named.has(d.name.toLowerCase()))
      .map((d) => ({ name: d.name, html: folderHtml[d.path as string] }));
    return [...files, ...fromFolder];
  }, [design?.files, documents, folderHtml]);

  // Read a folder file the first time it's opened.
  useEffect(() => {
    if (!active || active.source !== "folder" || !active.path || folderHtml[active.path] !== undefined) return;
    let alive = true;
    readDesignDocument(id, active.path)
      .then((doc) => alive && setFolderHtml((all) => ({ ...all, [active.path as string]: doc.html })))
      .catch(() => alive && setFolderHtml((all) => ({ ...all, [active.path as string]: "" })));
    return () => {
      alive = false;
    };
  }, [active, folderHtml, id]);

  /** Open a reply's before and after for one of the documents it wrote. */
  async function openCompare(messageId: string, document?: string) {
    try {
      const versions = await listDesignVersions(id);
      const mine = versions.filter((v) => v.message_id === messageId);
      if (!mine.length) return notify({ type: "info", title: t("هالرد ما غيّر شي بالتصميم.") });
      const version = mine.find((v) => v.document === document) ?? mine.find((v) => v.document === active?.name) ?? mine[0];
      const docs = mine.map((v) => v.document);
      setTab("preview");
      setCompare({ message: messageId, documents: docs, current: version.document, before: null, after: null });
      const previous = previousOf(versions, version.id);
      const [after, before] = await Promise.all([getDesignVersion(id, version.id), previous ? getDesignVersion(id, previous) : Promise.resolve(null)]);
      setCompare({ message: messageId, documents: docs, current: version.document, after: after.html, before: before ? before.html : null });
    } catch (e) {
      notify({ type: "error", title: t("ما قدرت أفتح المقارنة"), description: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Take the design back to before a reply; the toast can bring it back again. */
  async function undoReply(messageId: string): Promise<void> {
    try {
      const result = await rewind(() => undoDesignReply(id, messageId));
      setDesign(result.design);
      setPicked(null);
      if (!result.restored.length) {
        notify({ type: "info", title: t("هالرد عمل مستندات جديدة بس — ما في شي يرجع لقبله.") });
        return;
      }
      notify({
        type: "success",
        duration: 8000,
        title: t("رجع التصميم لقبل هالرد"),
        description: result.skipped.length ? t("ضل متل ما هو: {0} (انعمل بهالرد)", { 0: result.skipped.join(t("، ")) }) : undefined,
        action: {
          label: t("رجّعه"),
          onClick: () =>
            void rewind(async () => {
              const versions = await listDesignVersions(id);
              let next: Design | null = null;
              for (const v of versions.filter((x) => x.message_id === messageId && result.restored.includes(x.document))) {
                next = await restoreDesignVersion(id, v.id);
              }
              if (next) setDesign(next);
            }),
        },
      });
    } catch (e) {
      notify({ type: "error", title: t("ما قدرت أرجّع"), description: e instanceof Error ? e.message : String(e) });
    }
  }

  async function askVariants() {
    setAsking(true);
    try {
      const { design: next, message } = await askDesignVariants(id);
      setDesign(next);
      setVariantsHidden(false);
      setCompare(null);
      setTab("preview");
      setSendRequest({ id: Date.now(), text: message });
    } catch (e) {
      notify({ type: "error", title: t("ما قدرت أطلب النسخ"), description: e instanceof Error ? e.message : String(e) });
    } finally {
      setAsking(false);
    }
  }

  function flash(text: string) {
    setNote(text);
    setTimeout(() => setNote((n) => (n === text ? null : n)), 6000);
  }

  usePageMenu(() => [
    { id: "refresh", label: t("حدّث المعاينة"), onSelect: () => void refresh() },
    {
      id: "copy-html",
      label: t("انسخ كود الواجهة"),
      disabled: !design?.preview_html,
      onSelect: () => {
        if (design?.preview_html) void navigator.clipboard.writeText(design.preview_html).then(() => flash(t("انتسخ كود الواجهة")));
      },
    },
    { id: "spec", label: t("اعرض المواصفات"), onSelect: () => setTab("spec") },
    { id: "skills", label: t("المهارات"), onSelect: () => setTab("skills") },
    {
      id: "handoff",
      label: t("بدء البرمجة"),
      disabled: !design?.preview_html && !design?.spec,
      onSelect: () => setHandoffOpen(true),
    },
    { id: "designs", label: t("كل التصاميم"), onSelect: () => navigate(design?.board ? "/designs?type=board" : "/designs") },
  ]);

  if (error) {
    return (
      <div className="mx-auto max-w-xl px-8 py-16 text-center">
        <AlertIcon className="mx-auto h-6 w-6" style={{ color: "var(--color-danger)" }} />
        <p className="mt-3 text-sm">{error}</p>
        <Button variant="ghost" className="mt-4" onClick={() => navigate("/designs")}>
          {t("رجوع للتصاميم")}
        </Button>
      </div>
    );
  }

  if (!design) {
    return (
      <div className="flex h-full flex-col gap-3 p-6">
        <div className="shimmer h-10 rounded-lg" />
        <div className="shimmer min-h-0 flex-1 rounded-xl" />
      </div>
    );
  }

  const width = DEVICES.find((d) => d.id === device)?.width ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 px-5 pb-1 pt-3">
        {renaming ? (
          <input
            autoFocus
            defaultValue={design.title}
            onBlur={async (e) => {
              const title = e.currentTarget.value.trim();
              const cancelled = e.currentTarget.dataset.cancel === "1";
              setRenaming(false);
              if (!cancelled && title && title !== design.title) setDesign(await renameDesign(design.id, title));
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
            <h1 onDoubleClick={() => setRenaming(true)} title={t("دبل كليك لإعادة التسمية")} className="min-w-0 truncate text-[15px]">
              <Breadcrumb
                items={[
                  design.board
                    ? { label: t("تصميم تطبيقات"), onClick: () => navigate("/designs?type=board") }
                    : { label: t("التصاميم"), onClick: () => navigate("/designs") },
                  { label: design.title },
                ]}
              />
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

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="shrink-0">
          <TabsList aria-label={t("عرض التصميم")}>
            {(["preview", "history", "spec", "skills"] as Tab[]).map((key) => (
              <TabsTrigger key={key} value={key} className="!min-w-0">
                <span className="text-xs">{key === "preview" ? t("معاينة") : key === "history" ? t("النسخ") : key === "spec" ? t("المواصفات") : t("المهارات")}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <FolderChip
          value={design.working_dir}
          onChange={async (path) => setDesign(await setDesignFolder(design.id, path))}
        />

        {design.can_vary && !design.board && (
          <Button
            variant="ghost"
            onClick={() => (design.variants?.length ? (setCompare(null), setTab("preview"), setVariantsHidden((h) => !h)) : void askVariants())}
            disabled={asking || (!design.preview_html && !design.variants?.length)}
            title={t("3 نسخ من الصفحة، كل وحدة باتجاه فني مختلف، وبتختار وحدة")}
          >
            <LayersIcon className="h-4 w-4" />
            {design.variants?.length ? (variantsHidden ? t("اعرض النسخ البديلة") : t("خبّي النسخ البديلة")) : asking ? t("عم يحضّر…") : t("3 نسخ بديلة")}
          </Button>
        )}

        <Button
          variant="ghost"
          onClick={() => setSendRequest({ id: Date.now(), text: SLOP_REQUEST })}
          disabled={!design.preview_html}
          title={t("بيفحص التصميم على كل علامات التصميم الآلي، والنموذج بيصلّحها")}
        >
          <ShieldIcon className="h-4 w-4" />
          {t("تأكد إنه مش AI slop")}
        </Button>

        <Button variant="accent" onClick={() => setHandoffOpen(true)} disabled={!design.preview_html && !design.spec}>
          <TasksIcon className="h-4 w-4" />
          {t("بدء البرمجة")}
        </Button>
      </header>

      <AnimatePresence>
        {note && (
          <motion.p
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2 px-5 py-2 text-xs"
            style={{ color: "var(--color-success)" }}
          >
            <DrawnCheck className="h-3.5 w-3.5" />
            {note}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="flex min-h-0 flex-1">
        {/* The design conversation — the same chat surface as everywhere else. */}
        <div className="flex min-h-0 shrink-0 flex-col" style={{ width: chatWidth }}>
          {/* The kickoff is sent only while that chat is still empty, so a reload is safe. */}
          <ChatPage
            chatId={design.chat_id}
            embedded
            autoSend={design.kickoff}
            sendRequest={sendRequest}
            onReplyDone={refresh}
            onDraftText={onDraftText}
            mode="design"
            onHostCommand={(id) => {
              if (id !== "design:build") return false;
              setHandoffOpen(true);
              return true;
            }}
            replyFooter={(m: ChatMessage) =>
              /```html/i.test(m.content) && !m.id.startsWith("temp") ? (
                <DesignReplyActions onUndo={() => undoReply(m.id)} onCompare={() => void openCompare(m.id)} />
              ) : null
            }
          />
        </div>
        <Resizer
          value={chatWidth}
          min={340}
          max={720}
          onChange={setChatWidth}
          onDoubleClick={() => setChatWidth(420)}
          label={t("عرض الشات")}
        />

        <div className="relative m-2 ms-0 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl" style={{ background: "var(--color-surface)" }}>
          <AnimatePresence>
            {tab === "preview" && outline && <BuildProgress key="build" outline={outline} floating={Boolean(activeHtml || boardFiles.length || design.variants?.length)} />}
            {rewinding && <Rewinding key="rewind" />}
          </AnimatePresence>
          {tab === "preview" && compare && (
            <BeforeAfter
              documents={compare.documents}
              current={compare.current}
              onDocument={(name) => void openCompare(compare.message, name)}
              before={compare.before}
              after={compare.after}
              onClose={() => setCompare(null)}
            />
          )}
          {tab === "preview" && !compare && !!design.variants?.length && !variantsHidden && (
            <VariantsView
              variants={design.variants}
              files={design.files ?? []}
              working={Boolean(design.working)}
              onClose={() => setVariantsHidden(true)}
              onChoose={async (key) => {
                try {
                  const next = await chooseDesignVariant(design.id, key);
                  setDesign(next);
                  setPicked(null);
                  flash(t("اعتمدت «{0}» — صارت هي الصفحة", { 0: design.variants?.find((v) => v.key === key)?.name ?? key }));
                } catch (e) {
                  notify({ type: "error", title: t("ما قدرت أعتمدها"), description: e instanceof Error ? e.message : String(e) });
                  throw e;
                }
              }}
            />
          )}
          {tab === "preview" && !compare && (!design.variants?.length || variantsHidden) && (
            <PreviewPane
              design={design}
              boardFiles={boardFiles}
              documents={documents}
              active={active}
              html={activeHtml}
              onPick={(doc) => setPicked(documentKey(doc))}
              width={width}
              device={device}
              onDevice={setDevice}
              onRefresh={() => {
                setFolderHtml({});
                void refresh();
              }}
              onCopied={() => flash(t("انتسخ كود الواجهة"))}
              onAsk={(text) => setSendRequest({ id: Date.now(), text })}
            />
          )}
          {tab === "history" && (
            <HistoryPane
              designId={design.id}
              changedAt={design.updated_at}
              onRestored={(next, label) => {
                setDesign(next);
                setTab("preview");
                flash(t("رجعت {0}", { 0: label }));
              }}
            />
          )}
          {tab === "spec" && (
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
              <div className="mx-auto max-w-2xl">
                {design.spec ? <Markdown text={design.spec} /> : <Empty text={t("المواصفات بتظهر هون بعد أول رد من النموذج.")} />}
              </div>
            </div>
          )}
          {tab === "skills" && <SkillsPane />}
        </div>
      </div>

      <AnimatePresence>
        {handoffOpen && (
          <HandoffDialog
            design={design}
            onClose={() => setHandoffOpen(false)}
            onDone={(text) => {
              flash(text);
              void refresh();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Over the preview while it goes back to an earlier version: an arrow winding backwards. */
function Rewinding() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.3 } }}
      className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-3"
      style={{ background: "color-mix(in oklch, var(--color-surface) 70%, transparent)", backdropFilter: "blur(6px) saturate(0.6)" }}
      role="status"
    >
      <motion.span
        className="flex h-12 w-12 items-center justify-center rounded-full"
        style={{ background: "var(--color-surface)", color: "var(--color-accent)", boxShadow: "0 8px 24px -8px rgb(0 0 0 / 0.25)" }}
        animate={{ rotate: -360 }}
        transition={{ duration: 0.9, ease: [0.65, 0, 0.35, 1], repeat: Infinity }}
      >
        <UndoIcon className="h-6 w-6" />
      </motion.span>
      <span className="text-xs font-medium" style={{ color: "var(--color-ink)" }}>
        {t("عم يرجّع للنسخة القديمة…")}
      </span>
    </motion.div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="px-6 py-16 text-center text-xs" style={{ color: "var(--color-ink-muted)" }}>
      {text}
    </p>
  );
}

/** A document is identified by where it came from and its name — a folder file and a chat
 *  document can share a name. */
function documentKey(doc: DesignDocument): string {
  return `${doc.source}:${doc.path ?? doc.name}`;
}

function PreviewPane({
  design,
  boardFiles,
  documents,
  active,
  html,
  onPick,
  width,
  device,
  onDevice,
  onRefresh,
  onCopied,
  onAsk,
}: {
  design: Design;
  boardFiles: { name: string; html: string }[];
  documents: DesignDocument[];
  active: DesignDocument | null;
  html: string | null;
  onPick: (doc: DesignDocument) => void;
  width: number;
  device: string;
  onDevice: (id: (typeof DEVICES)[number]["id"]) => void;
  onRefresh: () => void;
  onCopied: () => void;
  onAsk: (text: string) => void;
}) {
  const savedPath = active?.path ?? null;
  const [nonce, setNonce] = useState(0);
  const onBoard = device === "board";
  const [exporting, setExporting] = useState(false);

  async function exportBoard() {
    setExporting(true);
    try {
      const items = boardItems(boardFiles);
      const screens = items.filter((i) => i.kind === "screen").length;
      const html = boardHtml(design.title, items, briefDir(design.brief), t("{0} شاشة", { 0: screens }));
      const saved = await saveDesignBoard(design.id, html);
      notify({ type: "success", title: t("انحفظت اللوحة"), description: saved.path, action: { label: t("افتح المجلد"), onClick: () => void revealPath(saved.path) } });
    } catch (e) {
      notify({ type: "error", title: t("ما قدرت أحفظ اللوحة"), description: e instanceof Error ? e.message : String(e) });
    } finally {
      setExporting(false);
    }
  }
  const [missing, setMissing] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  // The frame springs between device widths, so the page is seen reflowing — measured in
  // pixels, since "100%" and "390px" can't be tweened.
  const stage = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => setRoom(el.clientWidth - 32);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onBoard]);
  // Picking parts of the page to ask about (the board has its own).
  const picker = usePicker(
    () => new Map(frameRef.current ? [["page", frameRef.current]] : []),
    () => active?.name ?? design.title,
  );
  const pickingOn = picker.picking || picker.items.length > 0;

  // What the preview runtime (PREVIEW_RUNTIME) asks of us: open a web link, or say a page
  // the design links to doesn't exist in it.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function onMessage(event: MessageEvent) {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { source?: string; type?: string; url?: string; page?: string } | null;
      if (data?.source !== "rafiq-preview") return;
      if (data.type === "open" && data.url) void openExternal(data.url);
      if (data.type === "missing" && data.page) {
        setMissing(data.page);
        clearTimeout(timer);
        timer = setTimeout(() => setMissing(null), 6000);
      }
    }
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
    };
  }, []);

  return (
    <>
      {/* One row per concern: which document, then how it's shown. The document row only
          appears once there's more than one to choose between. */}
      {documents.length > 1 && !onBoard && (
        <div className="flex items-center gap-1 overflow-x-auto border-b px-4 py-1.5" style={{ borderColor: "var(--color-border)" }}>
          <FileIcon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--color-ink-muted)" }} />
          {documents.map((doc) => {
            const on = active ? documentKey(doc) === documentKey(active) : false;
            return (
              <button
                key={documentKey(doc)}
                onClick={() => onPick(doc)}
                title={doc.path ?? doc.name}
                className="relative shrink-0 rounded-full px-2.5 py-1 text-xs transition-colors"
                style={{ color: on ? "var(--color-ink)" : "var(--color-ink-muted)" }}
              >
                {on && (
                  <motion.span
                    layoutId="design-file"
                    className="absolute inset-0 rounded-full"
                    style={{ background: "var(--color-surface-2)" }}
                    transition={snappy}
                  />
                )}
                <span className="relative flex items-center gap-1.5" dir="auto">
                  {doc.name}
                  {doc.source === "folder" && (
                    <FolderIcon className="h-3 w-3 shrink-0" style={{ color: "var(--color-ink-muted)" }} aria-label={t("من المجلد")} />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-b px-4 py-2" style={{ borderColor: "var(--color-border)" }}>
        {design.board ? (
          // an app board is only ever a board: no device sizes to switch between
          <span className="px-1 text-xs font-semibold" style={{ color: "var(--color-ink-muted)" }}>
            {t("{0} شاشة", { 0: boardItems(boardFiles).filter((i) => i.kind === "screen").length })}
          </span>
        ) : (
          <div className="flex items-center gap-1 rounded-full p-0.5" style={{ background: "var(--color-surface-2)" }}>
            {DEVICES.filter((d) => d.id !== "board").map((d) => (
              <button
                key={d.id}
                onClick={() => onDevice(d.id)}
                aria-pressed={device === d.id}
                className="relative rounded-full px-2.5 py-1 text-xs transition-colors"
                style={{ color: device === d.id ? "var(--color-ink)" : "var(--color-ink-muted)" }}
              >
                {device === d.id && <motion.span layoutId="design-device" className="absolute inset-0 rounded-full" style={{ background: "var(--color-surface)" }} transition={snappy} />}
                <span className="relative">{d.label}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex min-w-0 items-center gap-1">
          <AnimatePresence>
            {missing && (
              <motion.span
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="me-1 flex min-w-0 items-center gap-1 truncate text-[11px]"
                style={{ color: "var(--color-pending)" }}
                role="status"
              >
                <AlertIcon className="h-3 w-3 shrink-0" />
                <span className="truncate">{t("الصفحة «{0}» مو موجودة بالتصميم — اطلبها من النموذج بالشات.", { 0: missing })}</span>
              </motion.span>
            )}
          </AnimatePresence>
          {savedPath && (
            <span className="me-1 flex items-center gap-1 text-[11px]" style={{ color: "var(--color-ink-muted)" }} title={savedPath}>
              <FolderIcon className="h-3 w-3" />
              {t("انحفظ بـ")} {folderName(savedPath)}
            </span>
          )}
          {!onBoard && (
            <IconButton
              label={t("حدد أجزاء من التصميم واطلب تعديلها")}
              disabled={!html}
              active={pickingOn}
              onClick={() => (pickingOn ? picker.reset() : picker.start())}
            >
              <PickIcon className="h-3.5 w-3.5" />
            </IconButton>
          )}
          <IconButton
            label={t("حدّث المعاينة")}
            onClick={() => {
              onRefresh();
              setNonce((n) => n + 1);
            }}
          >
            <RefreshIcon className="h-3.5 w-3.5" />
          </IconButton>
          {onBoard && (
            <Button variant="ghost" onClick={() => void exportBoard()} disabled={exporting || !boardFiles.length}>
              <ArrowDownIcon className="h-3.5 w-3.5" />
              {exporting ? t("عم يحفظ…") : t("صدّر اللوحة HTML")}
            </Button>
          )}
          <IconButton
            label={t("انسخ كود الواجهة")}
            disabled={!html}
            onClick={() => {
              if (html) void navigator.clipboard.writeText(html).then(onCopied);
            }}
          >
            <ArrowDownIcon className="h-3.5 w-3.5 rotate-180" />
          </IconButton>
        </div>
      </div>

      {onBoard ? (
        <div className="min-h-0 flex-1">
          <Board title={design.title} files={boardFiles} dir={briefDir(design.brief)} nonce={nonce} onAsk={onAsk} />
        </div>
      ) : (
      <div ref={stage} className="relative min-h-0 flex-1 overflow-auto p-4" style={{ background: "var(--color-surface-2)" }}>
        <AnimatePresence>
          {picker.picking && !picker.items.length && (
            <div key="hint" className="pointer-events-none absolute inset-x-0 top-6 z-10 flex justify-center">
              <PickHint />
            </div>
          )}
          {picker.items.length > 0 && (
            <div key="composer" className="absolute inset-x-0 bottom-6 z-10 flex justify-center">
              <PickComposer picker={picker} onSend={onAsk} />
            </div>
          )}
        </AnimatePresence>
        {html ? (
          <motion.div
            className="mx-auto h-full overflow-hidden rounded-xl"
            initial={false}
            animate={room ? { width: width ? Math.min(width, room) : room } : undefined}
            transition={{ type: "spring", visualDuration: 0.5, bounce: 0.1 }}
            style={{ width: room ? undefined : "100%", maxWidth: "100%", background: "white" }}
          >
            <iframe
              ref={frameRef}
              key={nonce}
              srcDoc={guarded(html)}
              title={t("معاينة التصميم")}
              sandbox="allow-scripts allow-forms"
              onLoad={(e) => picker.onFrameLoad(e.currentTarget, "page")}
              className="h-full w-full"
              style={{ border: 0 }}
            />
          </motion.div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Wireframe size={120} className="mb-2 opacity-60" />
            <p className="text-sm font-medium">{t("المعاينة بتطلع هون")}</p>
            <p className="max-w-xs text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
              {t("أول ما النموذج يرجّع أول نسخة من الواجهة رح تشوفها حيّة، وتقدر تناقشه بالشات على اليمين وتشوف التعديل مباشرة.")}
            </p>
          </div>
        )}
      </div>
      )}
    </>
  );
}

function IconButton({
  label,
  onClick,
  children,
  disabled = false,
  active = false,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active || undefined}
      title={label}
      className="rounded-full p-1.5 transition-colors hover:bg-[var(--color-surface)] disabled:opacity-40"
      style={active ? { background: "var(--color-accent)", color: "var(--color-accent-ink)" } : { color: "var(--color-ink-muted)" }}
    >
      {children}
    </motion.button>
  );
}

/** What the model is reading from — visible, so the user knows what's behind the design. */
function SkillsPane() {
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [adding, setAdding] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const reload = useCallback(() => {
    listSkills()
      .then(setSkills)
      .catch(() => setSkills([]));
  }, []);

  useEffect(reload, [reload]);

  /** Point at a folder that has a SKILL.md — Rafiq copies it into your skills. */
  async function importFolder() {
    setStatus(null);
    const path = await pickFolder();
    if (!path) return;
    setAdding(true);
    try {
      const skill = await addSkill({ path });
      setStatus(t("انضافت المهارة {0}", { 0: skill.name }));
      reload();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t("ما قدرت أضيف المهارة"));
    } finally {
      setAdding(false);
    }
  }

  async function remove(name: string) {
    await deleteSkill(name).catch(() => undefined);
    reload();
  }

  async function show(name: string, file?: string) {
    setOpen(`${name}${file ? `/${file}` : ""}`);
    setContent("");
    const doc = await readSkill(name, file).catch(() => null);
    setContent(doc?.content ?? t("ما قدرت أقرأ المهارة."));
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-2xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">{t("المهارات")}</h2>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" onClick={() => setPasting(true)}>
              {t("الصق مهارة")}
            </Button>
            <Button onClick={importFolder} disabled={adding}>
              <PlusIcon className="h-4 w-4" />
              {adding ? t("جارِ الإضافة…") : t("أضف مهارة")}
            </Button>
          </div>
        </div>
        {status && (
          <p className="mb-3 text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {status}
          </p>
        )}
        <p className="mb-4 text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
          {t("هاي المهارات المدمجة اللي رفيق بيقرأها قبل ما يصمّم وبيرجعلها بكل تعديل. بتشتغل مع أي نموذج لأنها بتنمرّر كأدوات عادية (skill_list و skill_read). بتقدر تضيف مهاراتك بمجلد")}{" "}
          <span className="font-mono" dir="ltr">
            %APPDATA%/Rafiq/skills
          </span>
          .
        </p>
        <ul className="flex flex-col gap-2">
          {skills.map((skill) => (
            <li key={skill.name} className="rounded-2xl" style={{ background: "var(--color-surface)" }}>
              <button onClick={() => show(skill.name)} className="w-full px-4 py-3 text-start">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-xs" dir="ltr" style={{ color: "var(--color-ink-muted)" }}>
                    {skill.name}
                  </span>
                  {skill.source === "user" && (
                    <span className="rounded-full px-1.5 text-[10px]" style={{ background: "var(--color-surface-2)", color: "var(--color-ink-muted)" }}>
                      {t("مهارتك")}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }} dir="auto">
                  {skill.description}
                </span>
              </button>
              {skill.source === "user" && (
                <div className="px-4 pb-3">
                  <button
                    onClick={() => remove(skill.name)}
                    className="flex items-center gap-1 text-[11px]"
                    style={{ color: "var(--color-danger)" }}
                  >
                    <TrashIcon className="h-3 w-3" />
                    {t("احذف المهارة")}
                  </button>
                </div>
              )}
              {skill.files.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-4 pb-3">
                  {skill.files.map((file) => (
                    <button
                      key={file}
                      onClick={() => show(skill.name, file)}
                      className="rounded-full border px-2 py-0.5 font-mono text-[10px]"
                      style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }}
                      dir="ltr"
                    >
                      {file}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <AnimatePresence>
        {pasting && (
          <PasteSkillDialog
            onClose={() => setPasting(false)}
            onAdded={(name) => {
              setStatus(t("انضافت المهارة {0}", { 0: name }));
              reload();
            }}
          />
        )}
        {open && (
          <motion.div
            className="fixed inset-0 flex items-center justify-center p-6"
            style={{ zIndex: "var(--z-index-modal)" as unknown as number, background: "rgba(0,0,0,0.5)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(null)}
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.97, y: 10, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: easeOutExpo }}
              className="flex max-h-[82vh] w-full max-w-3xl flex-col rounded-2xl border shadow-2xl"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <header className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: "var(--color-border)" }}>
                <span className="font-mono text-xs" dir="ltr">
                  {open}
                </span>
                <button onClick={() => setOpen(null)} aria-label={t("إغلاق")} style={{ color: "var(--color-ink-muted)" }}>
                  <XIcon className="h-4 w-4" />
                </button>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {content ? <Markdown text={content} /> : <div className="shimmer h-40 rounded-lg" />}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** For skills that aren't a folder yet: a name and the markdown, written into your skills. */
function PasteSkillDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (name: string) => void }) {
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const skill = await addSkill({ name, content });
      onAdded(skill.name);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ما قدرت أحفظ المهارة"));
      setBusy(false);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 flex items-center justify-center p-6"
      style={{ zIndex: "var(--z-index-modal)" as unknown as number, background: "rgba(0,0,0,0.5)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.97, y: 8, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22, ease: easeOutExpo }}
        className="flex w-full max-w-xl flex-col gap-3 rounded-2xl border p-5 shadow-2xl"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <div>
          <h2 className="text-base font-semibold">{t("الصق مهارة")}</h2>
          <p className="mt-0.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {t("الصق محتوى SKILL.md. إذا ما فيه front matter، رفيق بيضيفه لحاله.")}
          </p>
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder={t("اسم المهارة (إنجليزي، بدون مسافات)")}
          className="input w-full"
          dir="ltr"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.currentTarget.value)}
          placeholder={t("# محتوى المهارة…")}
          rows={10}
          className="input w-full resize-y font-mono text-xs"
          dir={fieldDir(content)}
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
          <Button onClick={save} disabled={busy || !name.trim() || !content.trim()}>
            {busy ? t("جارِ الحفظ…") : t("احفظ المهارة")}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** "بدء البرمجة" — hands the design to the session that will build it. */
function HandoffDialog({ design, onClose, onDone }: { design: Design; onClose: () => void; onDone: (note: string) => void }) {
  const navigate = useNavigate();
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [target, setTarget] = useState<"existing" | "new" | "task">("new");
  const [chatId, setChatId] = useState("");
  const [modelId, setModelId] = useState(design.model_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The API already leaves design sessions out of this list.
    listChats()
      .then((list) => {
        setChats(list);
        setChatId(list[0]?.id ?? "");
      })
      .catch(() => setChats([]));
    listModels()
      .then((list) => {
        setModels(list.filter((m) => m.verify_ok !== false));
        setModelId((cur) => cur || list[0]?.id || "");
      })
      .catch(() => setModels([]));
  }, []);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      if (target === "task") {
        const result = await handoffDesign(design.id, { target: "task", model_id: modelId });
        onDone(t("انبعت التصميم كمهمة — رفيق بيشتغل عليها بالخلفية."));
        onClose();
        if (result.task_id) navigate(`/tasks/${result.task_id}`);
        return;
      }
      const result = await handoffDesign(design.id, {
        target: "chat",
        chat_id: target === "existing" ? chatId : undefined,
        model_id: modelId,
      });
      if (result.chat_id) {
        // The message lands in the composer of that session, ready to send.
        queueChatMessage(result.message);
        onDone(t("انبعت التصميم للمحادثة."));
        onClose();
        navigate(`/chat/${result.chat_id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ما قدرت أبعت التصميم"));
      setBusy(false);
    }
  }

  const options = [
    { id: "new", label: t("محادثة جديدة"), hint: t("بتفتح جلسة برمجة نضيفة ومعها التصميم") },
    { id: "existing", label: t("محادثة موجودة"), hint: t("ابعتها لجلسة شغّالة على المشروع") },
    { id: "task", label: t("مهمة بالخلفية"), hint: t("رفيق بينفّذها لحاله بالخلفية") },
  ] as const;

  return (
    <motion.div
      className="fixed inset-0 flex items-center justify-center p-6"
      style={{ zIndex: "var(--z-index-modal)" as unknown as number, background: "rgba(0,0,0,0.5)" }}
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
        className="flex w-full max-w-lg flex-col gap-4 rounded-2xl border p-5 shadow-2xl"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <div>
          <h2 className="text-base font-semibold">{t("ابعت التصميم للبرمجة")}</h2>
          <p className="mt-0.5 text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
            {t("بينبعت القرارات + كود الواجهة المعتمد، مع تعليمات إنه يقرأ مهارة impeccable قبل ما يبدأ.")}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          {options.map((option) => (
            <button
              key={option.id}
              onClick={() => setTarget(option.id)}
              className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-start transition-colors"
              style={{
                borderColor: target === option.id ? "var(--color-ink)" : "var(--color-border)",
                background: target === option.id ? "var(--color-surface-2)" : "transparent",
              }}
            >
              {option.id === "task" ? <TasksIcon className="mt-0.5 h-4 w-4 shrink-0" /> : <ChatIcon className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>
                <span className="block text-sm">{option.label}</span>
                <span className="block text-xs" style={{ color: "var(--color-ink-muted)" }}>
                  {option.hint}
                </span>
              </span>
            </button>
          ))}
        </div>

        {target === "existing" && (
          <select value={chatId} onChange={(e) => setChatId(e.currentTarget.value)} className="input w-full">
            {chats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        )}

        <label className="flex items-center justify-between gap-3 text-xs" style={{ color: "var(--color-ink-muted)" }}>
          {t("النموذج اللي رح يبرمج")}
          <select value={modelId} onChange={(e) => setModelId(e.currentTarget.value)} className="input w-48">
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>

        {error && (
          <p className="text-xs" style={{ color: "var(--color-danger)" }}>
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("إلغاء")}
          </Button>
          <Button onClick={send} disabled={busy || (target === "existing" && !chatId)}>
            {busy ? t("جارِ الإرسال…") : t("ابعت وابدأ")}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
