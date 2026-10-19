/** The app's ear on the trackers: the agent's watcher stores what it finds (mentions,
 *  review requests, new assignments…); this polls for the new ones, says each once — a
 *  toast in the app, and a Windows notification when the account asked for it — and keeps
 *  the unread count for the «شغلي» badge. */

import { useEffect, useRef, useState } from "react";
import { listIntegrations, listNotices, quietly } from "./api";
import type { IntegrationAccount, IssueNotice } from "./types";
import { notify as toast } from "./toast";
import { notify as desktop } from "./background";
import { t } from "../i18n";

const EVERY = 45_000;

const KIND_TITLE: Record<string, string> = {
  assigned: t("انسندتلك مهمة"),
  mention: t("حدا ذكرك"),
  review: t("طلب مراجعة"),
  comment: t("تعليق جديد"),
  status: t("تغيّرت حالة مهمة"),
  update: t("تحديث على مهمة"),
};

export function useIssueNotices(navigate: (to: string) => void): number {
  const [unread, setUnread] = useState(0);
  const seen = useRef<Set<string> | null>(null);
  const accounts = useRef<{ at: number; list: IntegrationAccount[] }>({ at: 0, list: [] });

  useEffect(() => {
    let alive = true;
    const check = async () => {
      let notices: IssueNotice[];
      try {
        notices = await quietly(() => listNotices({ unreadOnly: true, limit: 50 }));
        if (Date.now() - accounts.current.at > 5 * 60_000) {
          accounts.current = { at: Date.now(), list: await quietly(() => listIntegrations()) };
        }
      } catch {
        return;
      }
      if (!alive) return;
      setUnread(notices.length);
      const before = seen.current;
      seen.current = new Set(notices.map((n) => n.id));
      if (!before) return; // the first look only learns what's there
      const fresh = notices.filter((n) => !before.has(n.id)).slice(0, 4);
      for (const notice of fresh) {
        const title = KIND_TITLE[notice.kind] ?? t("تنبيه");
        const body = `${notice.key} — ${notice.title}${notice.actor ? ` · ${notice.actor}` : ""}`;
        toast({
          type: "info",
          title,
          description: body,
          action: { label: t("افتح"), onClick: () => navigate(`/work?open=${encodeURIComponent(`${notice.integration_id}::${notice.key}`)}`) },
        });
        const account = accounts.current.list.find((a) => a.id === notice.integration_id);
        if (account?.settings.watch.desktop !== false) void desktop(title, body);
      }
    };
    const first = window.setTimeout(check, 4000);
    const id = window.setInterval(check, EVERY);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [navigate]);

  return unread;
}
