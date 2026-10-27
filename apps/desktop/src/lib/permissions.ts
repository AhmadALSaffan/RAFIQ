/** The permission groups the user sets in Settings, and which group a tool belongs to —
 *  the same map the agent decides with (agent: core/agent_runtime.py · permission_key). */

import { t } from "../i18n";
import type { PermissionKey, PermissionMode } from "./types";

export const PERMISSION_ROWS: { key: PermissionKey; label: string; hint: string }[] = [
  { key: "filesystem_write", label: t("الكتابة على الملفات"), hint: t("إنشاء/تعديل/حذف ملفات") },
  { key: "shell", label: t("أوامر Shell"), hint: t("تنفيذ أوامر على الجهاز") },
  { key: "process", label: t("إدارة العمليات"), hint: t("إيقاف أو تشغيل عمليات") },
  { key: "browser_navigate", label: t("الويب والمتصفح"), hint: t("قراءة صفحات، البحث، واستخدام المتصفح (ضغط وكتابة)") },
  { key: "desktop_control", label: t("التحكم بسطح المكتب"), hint: t("تحريك الفأرة والكتابة على أي تطبيق") },
  { key: "task_create", label: t("إنشاء وتشغيل التاسكات"), hint: t("الموديل يبلّش مهام بالخلفية، يوقفها، أو يجدولها لحاله") },
  { key: "issue_write", label: t("التعديل على Jira، GitHub وغيرها"), hint: t("تعليق، إنشاء وتعديل المهام، نقل الحالة، تقسيم، ربط، مرفقات، وتسجيل وقت") },
  { key: "git_publish", label: t("النشر على git"), hint: t("رفع فرع التاسك وفتح طلب دمج (PR) — بيطلع من جهازك") },
  { key: "notify_send", label: t("الإرسال لقنوات الفريق"), hint: t("رسائل لـ Slack أو Teams أو Discord") },
  { key: "mcp", label: t("أدوات MCP"), hint: t("استدعاء أدوات خوادم MCP اللي ربطتها") },
  { key: "memory", label: t("الذاكرة"), hint: t("حفظ شي يتذكّره رفيق بالمحادثات الجاية") },
  { key: "notes_new", label: t("ملاحظة جديدة"), hint: t("الموديل يكتب ملاحظة جديدة بملاحظاتك (ما بيغيّر شي موجود)") },
  { key: "notes", label: t("تعديل ملاحظاتك"), hint: t("الموديل يغيّر ملاحظة موجودة — بيوريك الفرق قبل") },
  { key: "motion", label: t("تعديل الفيديوهات"), hint: t("تعديل مشهد الفيديو، فحصه، ورسم إطاراته — كله داخل المشروع") },
  { key: "media", label: t("الصوت والصور"), hint: t("تعليق صوتي، تفريغ كلام، صور من Unsplash/Pexels، توليد صور — بيروح لخدمة برّا") },
];

export const MODE_LABEL: Record<PermissionMode, string> = {
  auto: t("سماح تلقائي"),
  ask: t("اسأل دايماً"),
  deny: t("ممنوع"),
};

const BY_TOOL: Record<string, PermissionKey> = {
  filesystem_write: "filesystem_write",
  filesystem_delete: "filesystem_write",
  shell_run: "shell",
  process_kill: "process",
  web_fetch: "browser_navigate",
  web_search: "browser_navigate",
  memory_save: "memory",
  motion_tts: "media",
  motion_transcribe: "media",
  motion_stock: "media",
  motion_image: "media",
  motion_fetch_image: "media",
  create_tasks: "task_create",
  schedule_create: "task_create",
  schedule_update: "task_create",
  schedule_delete: "task_create",
  task_cancel: "task_create",
  task_publish: "git_publish",
  notify_post: "notify_send",
  note_create: "notes_new",
  note_edit: "notes",
};
const BY_PREFIX: [string, PermissionKey][] = [
  ["issue_", "issue_write"],
  ["browser_", "browser_navigate"],
  ["desktop_", "desktop_control"],
  ["mcp__", "mcp"],
  ["motion_", "motion"],
];

export function permissionKeyOf(tool: string): PermissionKey {
  return BY_TOOL[tool] ?? BY_PREFIX.find(([prefix]) => tool.startsWith(prefix))?.[1] ?? "shell";
}

/** The group's name, as the Settings page shows it. */
export function permissionLabelOf(tool: string): string {
  const key = permissionKeyOf(tool);
  return PERMISSION_ROWS.find((row) => row.key === key)?.label ?? key;
}

/** MCP servers keep their own per-server settings, so "always" isn't offered for them. */
export function canAlwaysAllow(tool: string): boolean {
  return !tool.startsWith("mcp__");
}

export type PermissionAnswer = "approved" | "denied" | "always";

/** Tools whose effect can't be taken back from inside Rafiq: deleting, killing a process,
 *  pushing to git, posting to a team channel. */
const IRREVERSIBLE = new Set(["filesystem_delete", "process_kill", "task_publish", "notify_post", "schedule_delete"]);
/** Commands that delete, overwrite history or wipe a disk. */
const DESTRUCTIVE_COMMAND =
  /(^|[\s;&|(])(rm|rmdir|del|erase|rd|mkfs|shred|Remove-Item|Clear-Content|Clear-RecycleBin|Format-Volume|diskpart)(\.exe)?(?=$|[\s;&|)])|git\s+(push\s.*(--force\b|\s-f\b)|reset\s+--hard|clean\s+-\w*f|branch\s+-D)|\bformat\s+[a-z]:|\bdrop\s+(table|database)\b/i;

/** Whether approving this call should take a press-and-hold instead of a click — so a
 *  stray click can't allow something that can't be undone. */
export function needsHold(tool: string, args: Record<string, unknown>): boolean {
  if (IRREVERSIBLE.has(tool)) return true;
  return tool === "shell_run" && typeof args.command === "string" && DESTRUCTIVE_COMMAND.test(args.command);
}
