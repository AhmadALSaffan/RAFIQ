import { t } from "../i18n";
const LABELS: Record<string, string> = {
  filesystem_list: t("عرض محتويات مجلد"),
  filesystem_read: t("قراءة ملف"),
  filesystem_write: t("كتابة ملف"),
  filesystem_delete: t("حذف ملف"),
  shell_run: t("تنفيذ أمر"),
  process_list: t("عرض العمليات الشغّالة"),
  process_kill: t("إيقاف عملية"),
  wait_for_tasks: t("استنى المهام تخلص"),
  web_fetch: t("قراءة صفحة ويب"),
  web_search: t("بحث على الويب"),
  browser_open: t("فتح صفحة بالمتصفح"),
  browser_read: t("قراءة الصفحة"),
  browser_click: t("ضغطة بالمتصفح"),
  browser_type: t("كتابة بالمتصفح"),
  browser_press: t("زر بالمتصفح"),
  browser_screenshot: t("صورة الصفحة"),
  desktop_screenshot: t("صورة الشاشة"),
  desktop_click: t("ضغطة بالفأرة"),
  desktop_type: t("كتابة بالكيبورد"),
  desktop_key: t("اختصار كيبورد"),
  desktop_scroll: t("تمرير"),
};

/** Transcripts saved before the rename use dotted names (filesystem.list) — map both. */
export function toolLabel(name: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) return t("MCP · {0}: {1}", { 0: mcp[1], 1: mcp[2] });
  return LABELS[name.replace(".", "_")] ?? name;
}
