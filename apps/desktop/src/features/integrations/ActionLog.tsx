/** Everything Rafiq changed on the trackers — by you, by a chat, or by a task — with undo
 *  wherever the tracker allows it. */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { listIntegrationActions, undoIntegrationAction } from "../../lib/api";
import type { IntegrationAction } from "../../lib/types";
import { Button } from "../../components/ui";
import { BrandMark } from "../../components/BrandMark";
import { UndoIcon } from "../../components/Icons";
import { timeAgo } from "../../lib/time";
import { notify } from "../../lib/toast";
import { listContainer, listItem } from "../../lib/motion";
import { t } from "../../i18n";

export const ACTION_LABEL: Record<string, string> = {
  comment: t("تعليق"),
  comment_edit: t("تعديل تعليق"),
  comment_delete: t("حذف تعليق"),
  status: t("نقل حالة"),
  create: t("مهمة جديدة"),
  update: t("تعديل حقول"),
  link: t("ربط"),
  attach: t("مرفق"),
  worklog: t("تسجيل وقت"),
  pull_request: t("طلب دمج"),
  undo: t("تراجع"),
};

function SourceLink({ source }: { source: IntegrationAction["source"] }) {
  if (source?.task_id) return <Link to={`/tasks/${source.task_id}`} className="underline underline-offset-2">{t("من تاسك")}</Link>;
  if (source?.chat_id) return <Link to={`/chat/${source.chat_id}`} className="underline underline-offset-2">{t("من محادثة")}</Link>;
  return <span>{t("منك")}</span>;
}

export function ActionList({ actions, onUndone }: { actions: IntegrationAction[]; onUndone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!actions.length) {
    return <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>{t("رفيق ما عدّل شي لسا.")}</p>;
  }
  return (
    <motion.ul variants={listContainer} initial="hidden" animate="show" className="flex flex-col gap-1.5">
      {actions.map((action) => (
        <motion.li key={action.id} variants={listItem} className="flex items-start gap-3 rounded-xl px-3 py-2" style={{ background: "var(--color-surface)", opacity: action.undone_at ? 0.55 : 1 }}>
          <BrandMark provider={action.provider} className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 text-xs">
              <span className="font-medium">{ACTION_LABEL[action.action] ?? action.action}</span>
              <span className="font-mono" dir="ltr">{action.key}</span>
              <span style={{ color: "var(--color-ink-muted)" }}>· <SourceLink source={action.source} /> · {timeAgo(action.created_at)}</span>
              {action.undone_at && <span style={{ color: "var(--color-ink-muted)" }}>· {t("انلغى")}</span>}
            </p>
            <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs" style={{ color: "var(--color-ink-muted)" }} dir="auto">
              {action.summary}
            </p>
          </div>
          {action.can_undo && (
            <Button
              variant="ghost"
              className="shrink-0 px-2 py-1 text-xs"
              disabled={busy === action.id}
              onClick={async () => {
                setBusy(action.id);
                try {
                  const { message } = await undoIntegrationAction(action.id);
                  notify({ type: "success", title: message });
                  onUndone();
                } catch (err) {
                  notify({ type: "error", title: err instanceof Error ? err.message : t("ما زبط") });
                } finally {
                  setBusy(null);
                }
              }}
            >
              <UndoIcon className="arc-mirror h-3.5 w-3.5" />
              {t("تراجع")}
            </Button>
          )}
        </motion.li>
      ))}
    </motion.ul>
  );
}

export function ActionLog() {
  const [actions, setActions] = useState<IntegrationAction[]>([]);
  const load = () => listIntegrationActions({ limit: 60 }).then(setActions).catch(() => setActions([]));
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="mt-10">
      <h2 className="mb-1 text-sm font-medium">{t("شو عدّل رفيق")}</h2>
      <p className="mb-3 text-xs" style={{ color: "var(--color-ink-muted)" }}>{t("كل تعليق ونقل حالة وتعديل عمله رفيق على المنصّات، ومين طلبه.")}</p>
      <ActionList actions={actions} onUndone={() => void load()} />
    </section>
  );
}
