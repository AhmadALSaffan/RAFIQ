import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  addSkill,
  deleteSkill,
  getDesign,
  handoffDesign,
  listChats,
  listModels,
  listSkills,
  readSkill,
  renameDesign,
  setDesignFolder,
} from "../lib/api";
import type { AgentSkill, ChatSummary, Design, LlmModel } from "../lib/types";
import { easeOutExpo, snappy } from "../lib/motion";
import { queueChatMessage } from "../lib/handoff";
import { fieldDir } from "../lib/bidi";
import { folderName, pickFolder } from "../lib/folders";
import { openExternal } from "../lib/links";
import { FolderChip } from "../components/FolderPicker";
import { Markdown } from "../components/Markdown";
import { Button, DrawnCheck } from "../components/ui";
import { Resizer } from "../components/Resizer";
import { usePageMenu } from "../components/ContextMenu";
import { ChatPage } from "../features/chat";
import {
  AlertIcon,
  ArrowDownIcon,
  ChatIcon,
  FolderIcon,
  PlusIcon,
  RefreshIcon,
  SparkIcon,
  TasksIcon,
  TrashIcon,
  XIcon,
} from "../components/Icons";

import { t } from "../i18n";
const DEVICES = [
  { id: "mobile", label: t("موبايل"), width: 390 },
  { id: "tablet", label: t("تابلت"), width: 820 },
  { id: "desktop", label: t("شاشة"), width: 0 },
] as const;

type Tab = "preview" | "spec" | "skills";

/**
 * The preview is a `srcdoc` document, so it inherits the app's URL as its base: the design's
 * own links (`#contact`, `about.html`) would load the app — or nothing — into the frame
 * instead of the design's page. This runtime keeps navigation inside the design: `#id` links
 * move within the document (hashchange included, for designs that route on it), links to
 * another page jump to the section with that name, web links open in the browser, and forms
 * don't navigate. It also keeps the webview's own menu (with Inspect) out of the frame.
 * Only the rendered copy is touched; what we copy, save and hand off stays the model's HTML.
 */
const PREVIEW_RUNTIME = `(function () {
  var post = function (data) { data.source = "rafiq-preview"; parent.postMessage(data, "*"); };
  var find = function (name) {
    if (!name) return null;
    var esc = CSS.escape(name);
    return document.getElementById(name) ||
      document.querySelector('[name="' + esc + '"], [data-page="' + esc + '"], #page-' + esc + ', #' + esc + '-page');
  };
  var go = function (name) {
    var target = find(name);
    var id = target && target.id ? target.id : name;
    var hash = id ? "#" + id : "";
    if (location.hash !== hash) location.hash = hash;
    if (target) target.scrollIntoView();
    else if (!name) scrollTo(0, 0);
  };
  document.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  document.addEventListener("submit", function (e) { if (!e.defaultPrevented) e.preventDefault(); });
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0) return;
    var link = e.target.closest ? e.target.closest("a[href]") : null;
    if (!link) return;
    var href = link.getAttribute("href").trim();
    if (!href || /^javascript:/i.test(href)) return;
    e.preventDefault();
    if (/^(https?:|mailto:|tel:)/i.test(href)) return post({ type: "open", url: href });
    var parts = href.split("#");
    var fragment = decodeURIComponent(parts[1] || "");
    var file = parts[0].split("?")[0].replace(/\\/+$/, "").split("/").pop() || "";
    var page = file.replace(/\\.html?$/i, "");
    if (!page || /^(index|home)$/i.test(page)) return go(fragment);
    if (find(page)) return go(page);
    post({ type: "missing", page: file });
  });
})();`;

function guarded(html: string): string {
  return `${html}
<script>${PREVIEW_RUNTIME}<\/script>`; // eslint-disable-line no-useless-escape
}

export function DesignWorkspace() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [design, setDesign] = useState<Design | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("preview");
  const [device, setDevice] = useState<(typeof DEVICES)[number]["id"]>("desktop");
  const [chatWidth, setChatWidth] = useState(420);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await getDesign(id);
      setDesign(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ما لقيت التصميم"));
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [id, refresh]);

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
    { id: "designs", label: t("كل التصاميم"), onSelect: () => navigate("/designs") },
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
      <header className="flex items-center gap-3 border-b px-5 py-2.5" style={{ borderColor: "var(--color-border)" }}>
        <button
          onClick={() => navigate("/designs")}
          className="shrink-0 rounded-lg px-2 py-1 text-xs transition-colors hover:bg-[var(--color-surface-2)]"
          style={{ color: "var(--color-ink-muted)" }}
        >
          {t("التصاميم ›")}
        </button>

        {renaming ? (
          <input
            autoFocus
            defaultValue={design.title}
            onBlur={async (e) => {
              const title = e.currentTarget.value.trim();
              setRenaming(false);
              if (title && title !== design.title) setDesign(await renameDesign(design.id, title));
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="min-w-0 flex-1 rounded-lg border px-2 py-1 text-sm outline-none"
            style={{ borderColor: "var(--color-accent)", background: "var(--color-surface)", color: "var(--color-ink)" }}
            dir="auto"
          />
        ) : (
          <h1
            onDoubleClick={() => setRenaming(true)}
            title={t("دبل كليك لإعادة التسمية")}
            className="min-w-0 flex-1 cursor-text truncate text-sm font-medium"
            dir="auto"
          >
            {design.title}
          </h1>
        )}

        <div className="flex shrink-0 items-center gap-1 rounded-lg p-0.5" style={{ background: "var(--color-surface-2)" }}>
          {(["preview", "spec", "skills"] as Tab[]).map((key) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className="relative rounded-md px-2.5 py-1 text-xs"
              style={{ color: tab === key ? "var(--color-ink)" : "var(--color-ink-muted)" }}
            >
              {tab === key && (
                <motion.span
                  layoutId="design-tab"
                  className="absolute inset-0 rounded-md"
                  style={{ background: "var(--color-surface)", boxShadow: "inset 0 0 0 1px var(--color-border)" }}
                  transition={snappy}
                />
              )}
              <span className="relative">{key === "preview" ? t("معاينة") : key === "spec" ? t("المواصفات") : t("المهارات")}</span>
            </button>
          ))}
        </div>

        <FolderChip
          value={design.working_dir}
          onChange={async (path) => setDesign(await setDesignFolder(design.id, path))}
        />

        <Button onClick={() => setHandoffOpen(true)} disabled={!design.preview_html && !design.spec}>
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
            className="flex items-center gap-2 border-b px-5 py-2 text-xs"
            style={{ borderColor: "var(--color-border)", color: "var(--color-success)" }}
          >
            <DrawnCheck className="h-3.5 w-3.5" />
            {note}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="flex min-h-0 flex-1">
        {/* The design conversation — the same chat surface as everywhere else. */}
        <div className="flex min-h-0 shrink-0 flex-col border-e" style={{ width: chatWidth, borderColor: "var(--color-border)" }}>
          {/* The kickoff is sent only while that chat is still empty, so a reload is safe. */}
          <ChatPage chatId={design.chat_id} embedded autoSend={design.kickoff} onReplyDone={refresh} />
        </div>
        <Resizer
          value={chatWidth}
          min={340}
          max={720}
          onChange={setChatWidth}
          onDoubleClick={() => setChatWidth(420)}
          label={t("عرض الشات")}
        />

        <div className="flex min-h-0 flex-1 flex-col" style={{ background: "var(--color-surface-2)" }}>
          {tab === "preview" && (
            <PreviewPane
              savedPath={design.saved_path}
              html={design.preview_html}
              width={width}
              device={device}
              onDevice={setDevice}
              onRefresh={refresh}
              onCopied={() => flash(t("انتسخ كود الواجهة"))}
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

function Empty({ text }: { text: string }) {
  return (
    <p className="px-6 py-16 text-center text-xs" style={{ color: "var(--color-ink-muted)" }}>
      {text}
    </p>
  );
}

function PreviewPane({
  html,
  savedPath,
  width,
  device,
  onDevice,
  onRefresh,
  onCopied,
}: {
  html: string | null;
  savedPath: string | null;
  width: number;
  device: string;
  onDevice: (id: (typeof DEVICES)[number]["id"]) => void;
  onRefresh: () => void;
  onCopied: () => void;
}) {
  const [nonce, setNonce] = useState(0);
  const [missing, setMissing] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

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
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ background: "var(--color-surface)" }}>
          {DEVICES.map((d) => (
            <button
              key={d.id}
              onClick={() => onDevice(d.id)}
              className="rounded-md px-2.5 py-1 text-xs transition-colors"
              style={{
                background: device === d.id ? "var(--color-surface-2)" : "transparent",
                color: device === d.id ? "var(--color-ink)" : "var(--color-ink-muted)",
              }}
            >
              {d.label}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 items-center gap-1">
          <AnimatePresence>
            {missing && (
              <motion.span
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="me-1 flex min-w-0 items-center gap-1 truncate text-[11px]"
                style={{ color: "var(--color-accent)" }}
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
          <IconButton
            label={t("حدّث المعاينة")}
            onClick={() => {
              onRefresh();
              setNonce((n) => n + 1);
            }}
          >
            <RefreshIcon className="h-3.5 w-3.5" />
          </IconButton>
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

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {html ? (
          <div
            className="mx-auto h-full overflow-hidden rounded-xl border shadow-sm"
            style={{ width: width ? `${width}px` : "100%", maxWidth: "100%", borderColor: "var(--color-border)", background: "white" }}
          >
            <iframe
              ref={frameRef}
              key={nonce}
              srcDoc={guarded(html)}
              title={t("معاينة التصميم")}
              sandbox="allow-scripts allow-forms"
              className="h-full w-full"
              style={{ border: 0, minHeight: "600px" }}
            />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <SparkIcon className="h-6 w-6" style={{ color: "var(--color-accent)" }} />
            <p className="text-sm font-medium">{t("المعاينة بتطلع هون")}</p>
            <p className="max-w-xs text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
              {t("أول ما النموذج يرجّع أول نسخة من الواجهة رح تشوفها حيّة، وتقدر تناقشه بالشات على اليمين وتشوف التعديل مباشرة.")}
            </p>
          </div>
        )}
      </div>
    </>
  );
}

function IconButton({
  label,
  onClick,
  children,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded-lg p-1.5 transition-colors hover:bg-[var(--color-surface)] disabled:opacity-40"
      style={{ color: "var(--color-ink-muted)" }}
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
            <li key={skill.name} className="rounded-lg border" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
              <button onClick={() => show(skill.name)} className="w-full px-4 py-3 text-start">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-xs" dir="ltr" style={{ color: "var(--color-accent)" }}>
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
        onDone(t("انبعت التصميم كمهمة — رفيق بيشتغل عليها بالدور."));
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
    { id: "task", label: t("مهمة بالخلفية"), hint: t("رفيق بينفّذها لحاله بالدور") },
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
                borderColor: target === option.id ? "var(--color-accent)" : "var(--color-border)",
                background: target === option.id ? "color-mix(in oklch, var(--color-accent) 10%, transparent)" : "transparent",
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
