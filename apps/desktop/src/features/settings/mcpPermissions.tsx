/**
 * What one MCP server's tools may do without asking: one mode for the tools that only read
 * (the server marks them read-only), one for the rest, and one per tool on top. Anything
 * left unset follows the global "MCP tools" permission.
 */

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { setMcpPermissions } from "../../lib/api";
import type { McpPermissions, McpServer, PermissionMode } from "../../lib/types";
import { easeOutExpo } from "../../lib/motion";
import { ChevronDownIcon, ShieldIcon } from "../../components/Icons";
import { Reveal } from "../../components/ui";
import { t } from "../../i18n";

const MODES: PermissionMode[] = ["auto", "ask", "deny"];

const MODE_LABEL: Record<PermissionMode, string> = {
  auto: t("سماح تلقائي"),
  ask: t("اسأل دايماً"),
  deny: t("ممنوع"),
};

const MODE_COLOR: Record<PermissionMode, string> = {
  auto: "var(--color-success)",
  ask: "var(--color-pending)",
  deny: "var(--color-danger)",
};

export type ModeSource = "tool" | "group" | "global";

/** The mode a tool ends up with, and which setting gave it — the same rule as the agent
 *  (mcp_bridge.resolve_mode): the tool's own, then read/write, then the global one. */
export function effectiveMode(
  perms: McpPermissions,
  tool: string,
  readOnly: boolean,
  globalMode: PermissionMode,
): { mode: PermissionMode; from: ModeSource } {
  const own = perms.tools[tool];
  if (own) return { mode: own, from: "tool" };
  const group = readOnly ? perms.read : perms.write;
  if (group) return { mode: group, from: "group" };
  return { mode: globalMode, from: "global" };
}

/** A copy with one tool's mode set — or removed, so it follows its group again. */
export function withToolMode(perms: McpPermissions, tool: string, mode: PermissionMode | null): McpPermissions {
  const tools = { ...perms.tools };
  if (mode) tools[tool] = mode;
  else delete tools[tool];
  return { ...perms, tools };
}

function ModeSelect({
  value,
  inherited,
  inheritLabel,
  onChange,
  label,
}: {
  value: PermissionMode | null;
  inherited: PermissionMode;
  inheritLabel: string;
  onChange: (mode: PermissionMode | null) => void;
  label: string;
}) {
  const shown = value ?? inherited;
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="h-1.5 w-1.5 rounded-full transition-colors" style={{ background: MODE_COLOR[shown] }} aria-hidden />
      <select
        value={value ?? ""}
        onChange={(e) => onChange((e.target.value || null) as PermissionMode | null)}
        className="input w-48 py-1 text-xs"
        aria-label={label}
        style={{ color: value ? "var(--color-ink)" : "var(--color-ink-muted)" }}
      >
        <option value="">{t("{0} · {1}", { 0: inheritLabel, 1: MODE_LABEL[inherited] })}</option>
        {MODES.map((m) => (
          <option key={m} value={m}>
            {MODE_LABEL[m]}
          </option>
        ))}
      </select>
    </div>
  );
}

export function McpToolPermissions({
  server,
  globalMode,
  onSaved,
}: {
  server: McpServer;
  globalMode: PermissionMode;
  onSaved: (server: McpServer) => void;
}) {
  const [open, setOpen] = useState(false);
  const [perms, setPerms] = useState<McpPermissions>(server.permissions);
  const [error, setError] = useState<string | null>(null);
  const tools = server.status.tool_details ?? [];
  const custom = Boolean(perms.read || perms.write || Object.keys(perms.tools).length);

  async function save(next: McpPermissions) {
    const previous = perms;
    setPerms(next);
    setError(null);
    try {
      onSaved(await setMcpPermissions(server.id, next));
    } catch (err) {
      setPerms(previous);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const readMode = perms.read ?? globalMode;
  const writeMode = perms.write ?? globalMode;

  return (
    <div className="mt-3 border-t pt-2" style={{ borderColor: "var(--color-border)" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-start text-xs transition-colors hover:bg-[var(--color-surface-2)]"
        style={{ color: "var(--color-ink-muted)" }}
        aria-expanded={open}
      >
        <ShieldIcon className="h-3.5 w-3.5 shrink-0" style={{ color: custom ? "var(--color-ink)" : undefined }} />
        <span className="font-medium" style={{ color: "var(--color-ink)" }}>
          {t("الصلاحيات")}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {custom
            ? t("القراءة: {0} · التعديل: {1}", { 0: MODE_LABEL[readMode], 1: MODE_LABEL[writeMode] })
            : t("حسب الإعداد العام: {0}", { 0: MODE_LABEL[globalMode] })}
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2, ease: easeOutExpo }}>
          <ChevronDownIcon className="h-3.5 w-3.5" />
        </motion.span>
      </button>

      <Reveal open={open}>
        <div className="flex flex-col gap-2 px-1 pb-1 pt-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium">{t("الأدوات اللي بتقرأ بس")}</p>
              <p className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
                {t("بحث، عرض، قراءة — الخادم معلّمها إنها ما بتغيّر شي")}
              </p>
            </div>
            <ModeSelect
              value={perms.read ?? null}
              inherited={globalMode}
              inheritLabel={t("الإعداد العام")}
              label={t("الأدوات اللي بتقرأ بس")}
              onChange={(mode) => void save({ ...perms, read: mode })}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium">{t("الأدوات اللي بتعدّل")}</p>
              <p className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
                {t("كل أداة ما معلّمة للقراءة بس — إنشاء، تعديل، حذف، إرسال")}
              </p>
            </div>
            <ModeSelect
              value={perms.write ?? null}
              inherited={globalMode}
              inheritLabel={t("الإعداد العام")}
              label={t("الأدوات اللي بتعدّل")}
              onChange={(mode) => void save({ ...perms, write: mode })}
            />
          </div>

          {tools.length > 0 ? (
            <div className="mt-1 flex max-h-80 flex-col overflow-y-auto rounded-xl" style={{ background: "var(--color-surface-2)" }}>
              <p className="sticky top-0 border-b px-3 py-1.5 text-[11px] font-medium" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink-muted)" }}>
                {t("كل أداة لحالها")}
              </p>
              {tools.map((tool) => {
                const own = perms.tools[tool.name] ?? null;
                const group = tool.read_only ? perms.read : perms.write;
                return (
                  <div key={tool.name} className="flex items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0" style={{ borderColor: "var(--color-border)" }}>
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5">
                        <span className="truncate font-mono text-[11px]" dir="ltr" title={tool.name}>
                          {tool.name}
                        </span>
                        {tool.read_only && (
                          <span className="shrink-0 rounded px-1 py-px text-[10px]" style={{ background: "var(--color-surface-2)", color: "var(--color-ink-muted)" }}>
                            {t("بتقرأ بس")}
                          </span>
                        )}
                      </p>
                      {tool.description && (
                        <p className="line-clamp-1 text-[11px]" style={{ color: "var(--color-ink-muted)" }} dir="auto" title={tool.description}>
                          {tool.description}
                        </p>
                      )}
                    </div>
                    <ModeSelect
                      value={own}
                      inherited={group ?? globalMode}
                      inheritLabel={tool.read_only ? t("مثل أدوات القراءة") : t("مثل أدوات التعديل")}
                      label={tool.name}
                      onChange={(mode) => void save(withToolMode(perms, tool.name, mode))}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
              {t("لما يتصل الخادم، بتطلع أدواته هون وبتقدر تحدد كل وحدة لحالها.")}
            </p>
          )}

          <AnimatePresence>
            {error && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-xs" style={{ color: "var(--color-danger)" }} role="alert">
                {error}
              </motion.p>
            )}
          </AnimatePresence>
          <p className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
            {t("بتنطبق من الرسالة الجاية — ما بدها إعادة اتصال.")}
          </p>
        </div>
      </Reveal>
    </div>
  );
}
