/** Settings → General: search inside your files — on or off, which folders, how far it got. */

import { useCallback, useEffect, useState } from "react";
import type { AppSettings } from "../../lib/types";
import { clearFileIndex, getFileSearchStatus, rescanFiles, type FileSearchStatus } from "../../lib/api";
import { pickFolder } from "../../lib/folders";
import { Card, Hint, Section, ToggleRow } from "./controls";
import { Button } from "../../components/ui";
import { TrashIcon } from "../../components/Icons";
import { intlLocale, t } from "../../i18n";

type Persist = (next: AppSettings) => void;

export function FileSearchSettings({ settings, persist }: { settings: AppSettings; persist: Persist }) {
  const on = settings.file_search_enabled ?? true;
  const chosen = settings.file_search_dirs ?? [];
  const [status, setStatus] = useState<FileSearchStatus | null>(null);

  const refresh = useCallback(() => {
    getFileSearchStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 4000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function addFolder() {
    const picked = await pickFolder();
    if (picked && !chosen.includes(picked)) persist({ ...settings, file_search_dirs: [...(chosen.length ? chosen : (status?.folders ?? [])), picked] });
  }

  function removeFolder(path: string) {
    const from = chosen.length ? chosen : (status?.folders ?? []);
    persist({ ...settings, file_search_dirs: from.filter((p) => p !== path) });
  }

  const folders = chosen.length ? chosen : (status?.folders ?? []);
  const last = status?.last_scan ? new Date(status.last_scan).toLocaleString(intlLocale(), { dateStyle: "short", timeStyle: "short" }) : null;

  return (
    <Section title={t("البحث بملفاتك")}>
      <ToggleRow
        label={t("خلّي رفيق يلاقي ملفاتك من محتواها")}
        hint={t("بتسأله «وين فاتورة شهر 3؟» فبيلاقيها من اللي مكتوب جوّاها. الفهرس على جهازك بس، وما بيطلع منه شي.")}
        checked={on}
        onChange={(next) => persist({ ...settings, file_search_enabled: next })}
      />
      {on && (
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t("المجلدات")}</p>
              <Hint>{chosen.length ? t("المجلدات اللي اخترتها.") : t("المستندات وسطح المكتب والتنزيلات — ضيف غيرهم إذا بدك.")}</Hint>
            </div>
            <Button variant="ghost" onClick={() => void addFolder()}>
              {t("ضيف مجلد")}
            </Button>
          </div>
          <ul className="mt-2 flex flex-col gap-1">
            {folders.map((path) => (
              <li key={path} className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs" style={{ background: "var(--color-surface-2)" }}>
                <span className="min-w-0 flex-1 truncate" dir="ltr" title={path}>
                  {path}
                </span>
                <button onClick={() => removeFolder(path)} aria-label={t("شيل المجلد")} className="rounded p-1 hover:bg-[var(--color-surface)]" style={{ color: "var(--color-ink-muted)" }}>
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs" style={{ color: "var(--color-ink-muted)" }}>
            <span role="status">
              {status?.scanning
                ? t("عم يقرأ الملفات… ({0} لهلأ)", { 0: status.files.toLocaleString(intlLocale()) })
                : status
                  ? last
                    ? t("{0} ملف بالفهرس · آخر مرة {1}", { 0: status.files.toLocaleString(intlLocale()), 1: last })
                    : t("{0} ملف بالفهرس · أول قراءة بتبلّش بعد شوي من فتح رفيق", { 0: status.files.toLocaleString(intlLocale()) })
                  : t("ما قدرت أعرف حالة الفهرس.")}
              {status?.error && (
                <span className="ms-2" style={{ color: "var(--color-danger)" }}>
                  {status.error}
                </span>
              )}
            </span>
            <span className="flex gap-1">
              <Button variant="ghost" onClick={() => void rescanFiles().then(refresh)} disabled={status?.scanning}>
                {t("اقرأ هلأ")}
              </Button>
              <Button variant="ghost" onClick={() => void clearFileIndex().then(refresh)} disabled={status?.scanning}>
                {t("امسح الفهرس")}
              </Button>
            </span>
          </div>
        </Card>
      )}
    </Section>
  );
}
