import { t } from "../i18n";
const LABELS: Record<string, string> = {
  filesystem_list: t("عرض محتويات مجلد"),
  filesystem_read: t("قراءة ملف"),
  filesystem_write: t("كتابة ملف"),
  filesystem_delete: t("حذف ملف"),
  shell_run: t("تنفيذ أمر"),
  process_list: t("عرض العمليات الشغّالة"),
  process_kill: t("إيقاف عملية"),
};

/** Transcripts saved before the rename use dotted names (filesystem.list) — map both. */
export function toolLabel(name: string): string {
  return LABELS[name.replace(".", "_")] ?? name;
}
