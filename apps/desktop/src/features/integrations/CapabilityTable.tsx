/** What each provider can do — so nobody connects one expecting a feature it lacks. */

import type { IntegrationCapability, IntegrationProvider } from "../../lib/types";
import { BrandMark } from "../../components/BrandMark";
import { DrawnCheck } from "../../components/ui";
import { t } from "../../i18n";

export const CAPABILITY_LABEL: Record<IntegrationCapability, string> = {
  search: t("بحث بلغة المنصّة"),
  create: t("إنشاء مهام"),
  update: t("تعديل الحقول"),
  subtasks: t("مهام فرعية"),
  link: t("ربط مهام"),
  attach: t("مرفقات"),
  worklog: t("تسجيل وقت"),
  dev: t("PRs وكوميتات مرتبطة"),
  comment_edit: t("تعديل وحذف التعليقات"),
  mentions: t("منشن وتنبيهات"),
  reviews: t("طلبات المراجعة"),
  sprint: t("السبرنت الحالي"),
  projects: t("قائمة المشاريع"),
  users: t("الأشخاص"),
  pull_request: t("فتح طلب دمج من تاسك"),
};

export function CapabilityTable({ providers }: { providers: IntegrationProvider[] }) {
  const caps = Object.keys(CAPABILITY_LABEL) as IntegrationCapability[];
  return (
    <div className="overflow-x-auto rounded-2xl" style={{ background: "var(--color-surface)" }}>
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="sticky start-0 px-3 py-2 text-start font-medium" style={{ background: "var(--color-surface)" }} />
            {providers.map((p) => (
              <th key={p.id} className="px-2 py-2 font-medium" title={p.name}>
                <span className="flex flex-col items-center gap-1">
                  <BrandMark provider={p.id} className="h-4 w-4" />
                  <span className="whitespace-nowrap text-[10px]" style={{ color: "var(--color-ink-muted)" }}>{p.name}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {caps.map((cap) => (
            <tr key={cap} className="border-t" style={{ borderColor: "var(--color-border)" }}>
              <td className="sticky start-0 whitespace-nowrap px-3 py-1.5" style={{ background: "var(--color-surface)" }}>{CAPABILITY_LABEL[cap]}</td>
              {providers.map((p) => (
                <td key={p.id} className="px-2 py-1.5 text-center">
                  {p.capabilities.includes(cap) ? (
                    <span className="inline-flex" style={{ color: "var(--color-success)" }} aria-label={t("مدعوم")}>
                      <DrawnCheck className="h-3.5 w-3.5" />
                    </span>
                  ) : (
                    <span style={{ color: "var(--color-ink-muted)", opacity: 0.4 }} aria-label={t("مو مدعوم")}>—</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
