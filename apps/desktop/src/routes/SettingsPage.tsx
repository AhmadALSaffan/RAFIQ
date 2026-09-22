import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { getSettings, getWorkspace, updateSettings } from "../lib/api";
import { revealPath } from "../lib/folders";
import { Button, DrawnCheck } from "../components/ui";
import { PageHeader, StatusStripe } from "../components/Page";
import { GlobeIcon, LinkIcon, PinIcon, PlugIcon, SettingsIcon, ShieldIcon, TasksIcon, WalletIcon } from "../components/Icons";
import { ActionProgress } from "../components/Feedback";
import { ConnectedAccountsSection } from "../features/accounts/ConnectedAccountsSection";
import { ToggleRow } from "../features/settings/controls";
import { BackgroundSettings, TasksSettings, WebSettings } from "../features/settings/sections";
import { McpSettings } from "../features/settings/mcp";
import { MemorySettings } from "../features/settings/memory";
import { UsageSettings } from "../features/settings/usage";
import { BackupSection } from "../features/settings/backup";
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

import { LOCALES, locale, setLocale, t } from "../i18n";
const permissionRows: { key: PermissionKey; label: string; hint: string }[] = [
  { key: "filesystem_write", label: t("الكتابة على الملفات"), hint: t("إنشاء/تعديل/حذف ملفات") },
  { key: "shell", label: t("أوامر Shell"), hint: t("تنفيذ أوامر على الجهاز") },
  { key: "process", label: t("إدارة العمليات"), hint: t("إيقاف أو تشغيل عمليات") },
  { key: "browser_navigate", label: t("الويب والمتصفح"), hint: t("قراءة صفحات، البحث، واستخدام المتصفح (ضغط وكتابة)") },
  { key: "desktop_control", label: t("التحكم بسطح المكتب"), hint: t("تحريك الفأرة والكتابة على أي تطبيق") },
  { key: "issue_write", label: t("التعديل على مهام Jira وغيرها"), hint: t("كتابة تعليق أو تعليم مهمة كمكتملة") },
  { key: "mcp", label: t("أدوات MCP"), hint: t("استدعاء أدوات خوادم MCP اللي ربطتها") },
  { key: "memory", label: t("الذاكرة"), hint: t("حفظ شي يتذكّره رفيق بالمحادثات الجاية") },
];

const modeLabel: Record<PermissionMode, string> = {
  auto: t("سماح تلقائي"),
  ask: t("اسأل دايماً"),
  deny: t("ممنوع"),
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
    if (!ok) setNote(t("افتح المسار يدوياً — فتح المجلد بيشتغل من التطبيق بس."));
  }

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-medium">{t("مكان الملفات")}</h2>
      <div className="rounded-lg border px-4 py-3" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <p className="text-sm font-medium">{t("مجلد رفيق")}</p>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
          {t("أي مهمة أو تصميم ما حددت إله مجلد، رفيق بيعطيه مجلد خاص فيه هون باسم الجلسة — فما بتضيع ملفاتك ولا بتنرمي بمجلد المستخدم.")}
        </p>
        <div className="mt-2 flex items-center justify-between gap-3">
          <code className="md-inline min-w-0 truncate text-xs" dir="ltr" title={workspace ?? ""}>
            {workspace ?? "…"}
          </code>
          <Button variant="ghost" onClick={open} disabled={!workspace}>
            {t("افتح المجلد")}
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
          {t("المحادثات والمهام والمرفقات نفسها بتنحفظ بقاعدة بيانات التطبيق:")}{" "}
          <span className="font-mono" dir="ltr">
            %APPDATA%/Rafiq
          </span>{" "}
          {t("— وبتضل موجودة حتى لو حدّثت التطبيق.")}
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

/** Interface language. Switching reloads the window so direction and every label change at once. */
function LanguageSection() {
  const current = locale();
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-medium">{t("اللغة")}</h2>
      <div className="rounded-lg border px-4 py-3" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <div className="flex rounded-lg p-1" style={{ background: "var(--color-surface-2)" }} role="radiogroup" aria-label={t("اللغة")}>
          {LOCALES.map((option) => {
            const active = option.id === current;
            return (
              <button
                key={option.id}
                role="radio"
                aria-checked={active}
                lang={option.id}
                dir={option.dir}
                onClick={() => setLocale(option.id)}
                className="relative flex-1 rounded-md px-3 py-1.5 text-sm transition-colors"
                style={{ color: active ? "var(--color-accent-ink)" : "var(--color-ink)" }}
              >
                {active && (
                  <motion.span
                    layoutId="locale-pill"
                    className="absolute inset-0 rounded-md"
                    style={{ background: "var(--color-accent)" }}
                    transition={snappy}
                  />
                )}
                <span className="relative">{option.name}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs" style={{ color: "var(--color-ink-muted)" }}>
          {t("التطبيق بيعيد التحميل لحظة ليطبّق اللغة والاتجاه.")}
        </p>
      </div>
    </section>
  );
}

function LayoutSection() {
  const layout = useLayout();
  const widths: { key: keyof Pick<LayoutPrefs, "nav" | "list">; label: string; min: number; max: number }[] = [
    { key: "nav", label: t("عرض الشريط الجانبي"), min: NAV_MIN, max: NAV_MAX },
    { key: "list", label: t("عرض قائمة المحادثات"), min: LIST_MIN, max: LIST_MAX },
  ];

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">{t("الشكل")}</h2>
        <button onClick={resetLayout} className="text-xs underline underline-offset-2" style={{ color: "var(--color-ink-muted)" }}>
          {t("رجّع الافتراضي")}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <div className="rounded-lg border px-4 py-3" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <p className="text-sm font-medium">{t("عرض المحادثة")}</p>
          <p className="mb-2.5 mt-0.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {t("قدّيش بدك يكون عرض النص والرد بصفحة المحادثة.")}
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
              {t("أو اسحب الحد بين الأعمدة مباشرة (دبل كليك بيرجّعه للافتراضي).")}
            </p>
          </div>
        ))}

        <ToggleRow
          label={t("اطوِ الشريط الجانبي")}
          hint={t("بيصير أيقونات بس، فبتاخد مساحة أقل.")}
          checked={layout.navCollapsed}
          onChange={(navCollapsed) => setLayout({ navCollapsed })}
        />
        <ToggleRow
          label={t("أخفِ قائمة المحادثات")}
          hint={t("بتقدر تفتحها وقت ما بدك من زر «المحادثات» فوق.")}
          checked={layout.listHidden}
          onChange={(listHidden) => setLayout({ listHidden })}
        />
      </div>
    </section>
  );
}


const MODE_COLOR: Record<PermissionMode, string> = {
  ask: "var(--color-pending)",
  auto: "var(--color-success)",
  deny: "var(--color-danger)",
};

type TabId = "general" | "accounts" | "agent" | "permissions" | "memory" | "web" | "mcp" | "usage";

/** The side list. Each line says what's inside, so nobody has to open a tab to find out. */
const TABS: { id: TabId; label: string; hint: string; Icon: typeof SettingsIcon }[] = [
  { id: "general", label: t("عام"), hint: t("اللغة، الشكل، مكان الملفات، التشغيل بالخلفية"), Icon: SettingsIcon },
  { id: "accounts", label: t("الحسابات"), hint: t("تسجيل الدخول لمزوّدي النماذج"), Icon: LinkIcon },
  { id: "agent", label: t("المهام والنماذج"), hint: t("موديل المهام، التوازي، نسخة git، حدود المزوّد"), Icon: TasksIcon },
  { id: "permissions", label: t("الصلاحيات"), hint: t("شو بيعمله لحاله وشو بيستأذن عليه"), Icon: ShieldIcon },
  { id: "memory", label: t("الذاكرة"), hint: t("اللي بيتذكّره رفيق بين المحادثات"), Icon: PinIcon },
  { id: "web", label: t("الويب والمتصفح"), hint: t("مزوّد البحث ومفتاحه، ونافذة المتصفح"), Icon: GlobeIcon },
  { id: "mcp", label: "MCP", hint: t("اربط GitHub وNotion وقواعد بياناتك"), Icon: PlugIcon },
  { id: "usage", label: t("التكلفة"), hint: t("الصرف اليومي والشهري وحدوده"), Icon: WalletIcon },
];

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  usePageMenu(() => [{ id: "reset-layout", label: t("رجّع الشكل للافتراضي"), onSelect: resetLayout }]);

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  // Which section is open lives in the URL (?tab=…), so «/ذاكرة» from a chat — and the
  // back button — land where the user expects.
  const { hash } = useLocation();
  const [params, setParams] = useSearchParams();
  const wanted = params.get("tab") ?? (hash === "#memory" ? "memory" : null);
  const tab: TabId = TABS.some((x) => x.id === wanted) ? (wanted as TabId) : "general";
  const setTab = (id: TabId) => setParams(id === "general" ? {} : { tab: id }, { replace: true });

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
    <div className="relative mx-auto max-w-5xl px-8 py-10">
      <ActionProgress active={saving} className="fixed inset-x-0 top-0" />
      <PageHeader
        title={t("الإعدادات")}
        description={t("تحكّم بشو يقدر رفيق يعمله لحاله، وشو لازم ياخد إذنك عليه.")}
        actions={<SavedNote at={savedAt} />}
      />

      {/* The list sits on the start side (right in Arabic) and follows the page, so moving
          between sections never means scrolling back to the top. Narrow windows get a row. */}
      <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
        <nav
          className="-mx-2 flex gap-1 overflow-x-auto px-2 pb-1 lg:sticky lg:top-6 lg:mx-0 lg:h-fit lg:w-56 lg:shrink-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0"
          role="tablist"
          aria-label={t("أقسام الإعدادات")}
        >
          {TABS.map((item) => {
            const active = item.id === tab;
            return (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                role="tab"
                aria-selected={active}
                title={item.hint}
                className="relative flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-start transition-colors md:w-full"
                style={{ color: active ? "var(--color-ink)" : "var(--color-ink-muted)" }}
              >
                {active && (
                  <motion.span
                    layoutId="settings-tab"
                    className="absolute inset-0 rounded-lg"
                    style={{
                      background: "color-mix(in oklch, var(--color-accent) 14%, transparent)",
                      boxShadow: "inset 0 0 0 1px color-mix(in oklch, var(--color-accent) 45%, transparent)",
                    }}
                    transition={snappy}
                  />
                )}
                <item.Icon className="relative h-4 w-4 shrink-0" style={{ color: active ? "var(--color-accent)" : undefined }} />
                <span className="relative min-w-0">
                  <span className="block text-sm font-medium">{item.label}</span>
                  <span className="mt-0.5 hidden text-[11px] leading-snug lg:block" style={{ color: "var(--color-ink-muted)" }}>
                    {item.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
              transition={{ duration: 0.22 }}
            >
              {tab === "general" && (
                <>
                  <LanguageSection />
                  <LayoutSection />
                  <StorageSection />
                  <BackupSection />
                  <BackgroundSettings settings={settings} persist={persist} />
                </>
              )}
              {tab === "accounts" && <ConnectedAccountsSection />}
              {tab === "agent" && <TasksSettings settings={settings} persist={persist} />}
              {tab === "memory" && <MemorySettings settings={settings} persist={persist} />}
              {tab === "web" && <WebSettings settings={settings} persist={persist} />}
              {tab === "mcp" && <McpSettings />}
              {tab === "usage" && <UsageSettings settings={settings} persist={persist} />}
              {tab === "permissions" && (
                <>
                  <section className="mb-8">
                    <h2 className="mb-3 text-sm font-medium">{t("سياسة الصلاحيات")}</h2>
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
                    style={{
                      borderColor: settings.desktop_control_enabled ? "var(--color-danger)" : "var(--color-border)",
                      background: "var(--color-surface)",
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{t("تفعيل التحكم الكامل بسطح المكتب")}</p>
                        <p className="mt-1 max-w-md text-xs" style={{ color: "var(--color-ink-muted)" }}>
                          {t("يسمح لرفيق يحرّك الفأرة ويكتب على أي تطبيق مفتوح، مو بس داخل التطبيق. خليه مطفي إلا إذا كنت متأكد إنك بتحتاجه.")}
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
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
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
          {t("انحفظ")}
        </motion.span>
      )}
    </AnimatePresence>
  );
}
