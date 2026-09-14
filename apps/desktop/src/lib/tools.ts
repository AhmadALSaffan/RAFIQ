const LABELS: Record<string, string> = {
  filesystem_list: "عرض محتويات مجلد",
  filesystem_read: "قراءة ملف",
  filesystem_write: "كتابة ملف",
  filesystem_delete: "حذف ملف",
  shell_run: "تنفيذ أمر",
  process_list: "عرض العمليات الشغّالة",
  process_kill: "إيقاف عملية",
};

/** Transcripts saved before the rename use dotted names (filesystem.list) — map both. */
export function toolLabel(name: string): string {
  return LABELS[name.replace(".", "_")] ?? name;
}
