/** Settings → Memory: the folders replies can answer from, and how far they've been read. */

import { useCallback, useEffect, useState } from "react";
import type { AppSettings } from "../../lib/types";
import { clearKnowledge, getKnowledgeStatus, rescanKnowledge, type KnowledgeStatus } from "../../lib/api";
import { pickFolder } from "../../lib/folders";
import { Card, Hint, Section } from "./controls";
import { Button } from "../../components/ui";
import { TrashIcon } from "../../components/Icons";
import { intlLocale, t } from "../../i18n";

type Persist = (next: AppSettings) => void;

export function KnowledgeSettings({ settings, persist }: { settings: AppSettings; persist: Persist }) {
  const folders = settings.knowledge_dirs ?? [];
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);

  const refresh = useCallback(() => {
    getKnowledgeStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 4000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function add() {
    const picked = await pickFolder();
    if (picked && !folders.includes(picked)) persist({ ...settings, knowledge_dirs: [...folders, picked] });
  }

  const count = (n: number) => n.toLocaleString(intlLocale());

  return (
    <Section title={t("مجلد المعرفة")}>
      <Hint>{t("اختار مجلد فيه PDF وWord وملاحظات، ورفيق بيجاوب منه وبيقلك من أي ملف وأي صفحة. القراءة والفهرس على جهازك بس؛ المقاطع اللي بتخص سؤالك هي اللي بتروح للنموذج.")}</Hint>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">{t("المجلدات")}</p>
          <Button variant="ghost" onClick={() => void add()}>
            {t("ضيف مجلد")}
          </Button>
        </div>
        {folders.length === 0 ? (
          <p className="mt-2 text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {t("ما في مجلد لسا. لما تختار واحد، رفيق بيقرأه وبيصير يجاوب منه.")}
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {folders.map((path) => (
              <li key={path} className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs" style={{ background: "var(--color-surface-2)" }}>
                <span className="min-w-0 flex-1 truncate" dir="ltr" title={path}>
                  {path}
                </span>
                <button
                  onClick={() => persist({ ...settings, knowledge_dirs: folders.filter((p) => p !== path) })}
                  aria-label={t("شيل المجلد")}
                  className="rounded p-1 hover:bg-[var(--color-surface)]"
                  style={{ color: "var(--color-ink-muted)" }}
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {folders.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs" style={{ color: "var(--color-ink-muted)" }}>
            <span role="status">
              {status?.scanning
                ? t("عم يقرأ الملفات… ({0} لهلأ)", { 0: count(status.files) })
                : status
                  ? t("{0} ملف · {1} مقطع", { 0: count(status.files), 1: count(status.passages) })
                  : t("ما قدرت أعرف حالة الفهرس.")}
              {status?.error && (
                <span className="ms-2" style={{ color: "var(--color-danger)" }}>
                  {status.error}
                </span>
              )}
            </span>
            <span className="flex gap-1">
              <Button variant="ghost" onClick={() => void rescanKnowledge().then(refresh)} disabled={status?.scanning}>
                {t("اقرأ هلأ")}
              </Button>
              <Button variant="ghost" onClick={() => void clearKnowledge().then(refresh)} disabled={status?.scanning}>
                {t("امسح الفهرس")}
              </Button>
            </span>
          </div>
        )}
        {(status?.unread.length ?? 0) > 0 && (
          <p className="mt-2 text-xs" style={{ color: "var(--color-ink-muted)" }} title={status?.unread.join("\n")}>
            {t("ما قدرت أقرأ {0} ملف (غالباً PDF مصوّر بدون نص): {1}", { 0: status?.unread.length ?? 0, 1: status?.unread.slice(0, 3).join(t("، ")) ?? "" })}
          </p>
        )}
      </Card>
    </Section>
  );
}
