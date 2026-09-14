import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { getSettings, getWorkspace, updateSettings } from "../lib/api";
import { revealPath } from "../lib/folders";
import { Button, DrawnCheck } from "../components/ui";
import { PageHeader, StatusStripe } from "../components/Page";
import { ActionProgress } from "../components/Feedback";
import { listContainer, listItem, snappy } from "../lib/motion";
import type { AppSettings, PermissionKey, PermissionMode } from "../lib/types";
import { usePageMenu } from "../components/ContextMenu";
import {
  LIST_MAX,
  LIST_MIN,
  NAV_MAX,
  NAV_MIN,
  READING_LABELS,
  resetLayout,
  setLayout,
  useLayout,
  type LayoutPrefs,
  type ReadingWidth,
} from "../lib/layout";

const permissionRows: { key: PermissionKey; label: string; hint: string }[] = [
  { key: "filesystem_write", label: "الكتابة على الملفات", hint: "إنشاء/تعديل/حذف ملفات" },
  { key: "shell", label: "أوامر Shell", hint: "تنفيذ أوامر على الجهاز" },
  { key: "process", label: "إدارة العمليات", hint: "إيقاف أو تشغيل عمليات" },
  { key: "browser_navigate", label: "تصفح مواقع خارجية", hint: "فتح روابط خارج localhost" },
  { key: "desktop_control", label: "التحكم بسطح المكتب", hint: "تحريك الفأرة والكتابة على أي تطبيق" },
  { key: "issue_write", label: "التعديل على مهام Jira وغيرها", hint: "كتابة تعليق أو تعليم مهمة كمكتملة" },
];

const modeLabel: Record<PermissionMode, string> = {
  auto: "سماح تلقائي",
  ask: "اسأل دايماً",
  deny: "ممنوع",
};

/** Where the files of sessions without a folder end up — so nothing gets lost. */
function StorageSection() {
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    getWorkspace()
      .then(setWorkspace)
      .catch(() => setWorkspace(null));
  }, []);

  async function open() {
    if (!workspace) return;
    const ok = await revealPath(workspace);
    if (!ok) setNote("افتح المسار يدوياً — فتح المجلد بيشتغل من التطبيق بس.");
  }

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-medium">مكان الملفات</h2>
      <div className="rounded-lg border px-4 py-3" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <p className="text-sm font-medium">مجلد رفيق</p>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
          أي مهمة أو تصميم ما حددت إله مجلد، رفيق بيعطيه مجلد خاص فيه هون باسم الجلسة — فما
          بتضيع ملفاتك ولا بتنرمي بمجلد المستخدم.
        </p>
        <div className="mt-2 flex items-center justify-between gap-3">
          <code className="md-inline min-w-0 truncate text-xs" dir="ltr" title={workspace ?? ""}>
            {workspace ?? "…"}
          </code>
          <Button variant="ghost" onClick={open} disabled={!workspace}>
            افتح المجلد
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
          المحادثات والمهام والمرفقات نفسها بتنحفظ بقاعدة بيانات التطبيق:{" "}
          <span className="font-mono" dir="ltr">
            %APPDATA%/Rafiq
          </span>{" "}
          — وبتضل موجودة حتى لو حدّثت التطبيق.
        </p>
        {note && (
          <p className="mt-1 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
            {note}
          </p>
        )}
      </div>
    </section>
  );
}

function LayoutSection() {
  const layout = useLayout();
  const widths: { key: keyof Pick<LayoutPrefs, "nav" | "list">; label: string; min: number; max: number }[] = [
    { key: "nav", label: "عرض الشريط الجانبي", min: NAV_MIN, max: NAV_MAX },
    { key: "list", label: "عرض قائمة المحادثات", min: LIST_MIN, max: LIST_MAX },
  ];

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">الشكل</h2>
        <button onClick={resetLayout} className="text-xs underline underline-offset-2" style={{ color: "var(--color-ink-muted)" }}>
          رجّع الافتراضي
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <div className="rounded-lg border px-4 py-3" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <p className="text-sm font-medium">عرض المحادثة</p>
          <p className="mb-2.5 mt-0.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
            قدّيش بدك يكون عرض النص والرد بصفحة المحادثة.
          </p>
          <div className="flex gap-1 rounded-xl p-1" style={{ background: "var(--color-surface-2)" }}>
            {(Object.keys(READING_LABELS) as ReadingWidth[]).map((key) => (
              <button
                key={key}
                onClick={() => setLayout({ reading: key })}
                className="relative flex-1 rounded-lg px-3 py-1.5 text-xs"
                style={{ color: key === layout.reading ? "var(--color-bg)" : "var(--color-ink-muted)" }}
              >
                {key === layout.reading && (
                  <motion.span
                    layoutId="reading-width"
                    className="absolute inset-0 rounded-lg"
                    style={{ background: "var(--color-accent)" }}
                    transition={snappy}
                  />
                )}
                <span className="relative">{READING_LABELS[key]}</span>
              </button>
            ))}
          </div>
        </div>

        {widths.map((row) => (
          <div
            key={row.key}
            className="rounded-lg border px-4 py-3"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{row.label}</p>
              <span className="font-mono text-xs" dir="ltr" style={{ color: "var(--color-ink-muted)" }}>
                {layout[row.key]}px
              </span>
            </div>
            <input
              type="range"
              dir="ltr"
              min={row.min}
              max={row.max}
              step={4}
              value={layout[row.key]}
              onChange={(e) => setLayout({ [row.key]: Number(e.currentTarget.value) })}
              className="mt-2 w-full accent-[var(--color-accent)]"
            />
            <p className="mt-1 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
              أو اسحب الحد بين الأعمدة مباشرة (دبل كليك بيرجّعه للافتراضي).
            </p>
          </div>
        ))}

        <ToggleRow
          label="اطوِ الشريط الجانبي"
          hint="بيصير أيقونات بس، فبتاخد مساحة أقل."
          checked={layout.navCollapsed}
          onChange={(navCollapsed) => setLayout({ navCollapsed })}
        />
        <ToggleRow
          label="أخفِ قائمة المحادثات"
          hint="بتقدر تفتحها وقت ما بدك من زر «المحادثات» فوق."
          checked={layout.listHidden}
          onChange={(listHidden) => setLayout({ listHidden })}
        />
      </div>
    </section>
  );
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-start"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-xs" style={{ color: "var(--color-ink-muted)" }}>
          {hint}
        </span>
      </span>
      <span
        className="flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200"
        style={{ background: checked ? "var(--color-accent)" : "var(--color-surface-2)", justifyContent: checked ? "flex-end" : "flex-start" }}
      >
        <motion.span layout transition={snappy} className="h-5 w-5 rounded-full bg-white shadow-sm" />
      </span>
    </button>
  );
}

const MODE_COLOR: Record<PermissionMode, string> = {
  ask: "var(--color-pending)",
  auto: "var(--color-success)",
  deny: "var(--color-danger)",
};

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  usePageMenu(() => [{ id: "reset-layout", label: "رجّع الشكل للافتراضي", onSelect: resetLayout }]);

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  if (!settings) {
    // Skeletons shaped like the real sections, so the page doesn't jump when they load.
    return (
      <div className="mx-auto max-w-2xl px-8 py-10">
        <div className="shimmer mb-8 h-12 w-64 rounded-lg" />
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="shimmer h-16 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  // Optimistic, but honest: the bar runs until the backend has it, then a quiet «انحفظ».
  function persist(next: AppSettings) {
    setSettings(next);
    setSaving(true);
    updateSettings(next)
      .then(() => setSavedAt(Date.now()))
      .catch(() => getSettings().then(setSettings))
      .finally(() => setSaving(false));
  }

  function setPermission(key: PermissionKey, mode: PermissionMode) {
    if (!settings) return;
    persist({ ...settings, permissions: { ...settings.permissions, [key]: mode } });
  }

  return (
    <div className="relative mx-auto max-w-2xl px-8 py-10">
      <ActionProgress active={saving} className="fixed inset-x-0 top-0" />
      <PageHeader
        title="الإعدادات"
        description="تحكّم بشو يقدر رفيق يعمله لحاله، وشو لازم ياخد إذنك عليه."
        actions={<SavedNote at={savedAt} />}
      />

      <StorageSection />

      <LayoutSection />

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium">سياسة الصلاحيات</h2>
        <motion.div variants={listContainer} initial="hidden" animate="show" className="flex flex-col gap-2">
          {permissionRows.map((row) => (
            <motion.div
              variants={listItem}
              key={row.key}
              className="relative flex items-center justify-between overflow-hidden rounded-lg border px-4 py-3"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <StatusStripe color={MODE_COLOR[settings.permissions[row.key]]} />
              <div>
                <p className="text-sm font-medium">{row.label}</p>
                <p className="mt-0.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                  {row.hint}
                </p>
              </div>
              <select
                value={settings.permissions[row.key]}
                onChange={(e) => setPermission(row.key, e.target.value as PermissionMode)}
                className="input w-36"
                disabled={row.key === "desktop_control" && !settings.desktop_control_enabled}
              >
                {(["ask", "auto", "deny"] as PermissionMode[]).map((m) => (
                  <option key={m} value={m}>
                    {modeLabel[m]}
                  </option>
                ))}
              </select>
            </motion.div>
          ))}
        </motion.div>
      </section>

      <section
        className="rounded-lg border px-4 py-4"
        style={{ borderColor: settings.desktop_control_enabled ? "var(--color-danger)" : "var(--color-border)", background: "var(--color-surface)" }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">تفعيل التحكم الكامل بسطح المكتب</p>
            <p className="mt-1 max-w-md text-xs" style={{ color: "var(--color-ink-muted)" }}>
              يسمح لرفيق يحرّك الفأرة ويكتب على أي تطبيق مفتوح، مو بس داخل التطبيق. خليه مطفي إلا إذا كنت متأكد إنك بتحتاجه.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={settings.desktop_control_enabled}
            onClick={() => persist({ ...settings, desktop_control_enabled: !settings.desktop_control_enabled })}
            className="flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200"
            style={{
              background: settings.desktop_control_enabled ? "var(--color-danger)" : "var(--color-surface-2)",
              justifyContent: settings.desktop_control_enabled ? "flex-end" : "flex-start",
            }}
          >
            <motion.span layout transition={snappy} className="h-5 w-5 rounded-full bg-white shadow-sm" />
          </button>
        </div>
      </section>
    </div>
  );
}

/** A quiet confirmation that fades in after each save and out a moment later. */
function SavedNote({ at }: { at: number | null }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!at) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 1600);
    return () => clearTimeout(timer);
  }, [at]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.span
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="flex items-center gap-1.5 text-xs font-medium"
          style={{ color: "var(--color-success)" }}
        >
          <DrawnCheck className="h-3.5 w-3.5" />
          انحفظ
        </motion.span>
      )}
    </AnimatePresence>
  );
}
