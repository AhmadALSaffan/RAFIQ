/** What the watcher found: mentions, review requests, new assignments, comments and status
 *  changes, newest first. Opening one marks it read. */

import { motion } from "motion/react";
import type { IssueNotice } from "../../lib/types";
import { listContainer, listItem } from "../../lib/motion";
import { timeAgo } from "../../lib/time";
import { openExternal } from "../../lib/links";
import { NOTICE_LABEL } from "../integrations/AccountSettings";
import { Button } from "../../components/ui";
import { t } from "../../i18n";

export function Notices({
  notices,
  onOpen,
  onReadAll,
}: {
  notices: IssueNotice[];
  onOpen: (notice: IssueNotice) => void;
  onReadAll: () => void;
}) {
  if (!notices.length) {
    return (
      <p className="py-16 text-center text-sm" style={{ color: "var(--color-ink-muted)" }}>
        {t("ما في تنبيهات. رفيق بيطّلع كل شوي ع حساباتك وبيحطلك هون المنشن وطلبات المراجعة والمهام الجديدة.")}
      </p>
    );
  }
  const unread = notices.filter((n) => !n.read_at).length;
  return (
    <div>
      {unread > 0 && (
        <div className="mb-2 flex justify-end">
          <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={onReadAll}>
            {t("علّم الكل كمقروء ({0})", { 0: unread })}
          </Button>
        </div>
      )}
      <motion.ul variants={listContainer} initial="hidden" animate="show" className="flex flex-col divide-y overflow-hidden rounded-2xl" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
        {notices.map((notice) => (
          <motion.li key={notice.id} variants={listItem}>
            <button
              onClick={() => {
                onOpen(notice);
                if (notice.url) void openExternal(notice.url);
              }}
              className="flex w-full items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-[var(--color-surface-2)]"
            >
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: notice.read_at ? "transparent" : "var(--color-accent)" }} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                  <span className="rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: "var(--color-surface-2)", color: "var(--color-ink)" }}>
                    {NOTICE_LABEL[notice.kind] ?? notice.kind}
                  </span>
                  <span className="font-mono" dir="ltr">{notice.key}</span>
                  {notice.actor && <span>· {notice.actor}</span>}
                  <span>· {timeAgo(notice.happened_at ?? notice.created_at)}</span>
                </span>
                <span className="mt-0.5 block truncate text-sm font-medium" dir="auto" style={{ opacity: notice.read_at ? 0.7 : 1 }}>
                  {notice.title}
                </span>
                {notice.text && (
                  <span className="mt-0.5 line-clamp-2 block text-xs" dir="auto" style={{ color: "var(--color-ink-muted)" }}>
                    {notice.text}
                  </span>
                )}
              </span>
            </button>
          </motion.li>
        ))}
      </motion.ul>
    </div>
  );
}
