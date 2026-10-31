/** «What does Rafiq know about me»: everything it remembers, in one place, to edit or erase. */

import { useEffect, useState } from "react";
import { getSettings, updateSettings } from "../lib/api";
import type { AppSettings } from "../lib/types";
import { MemorySettings } from "../features/settings/memory";
import { PageHeader } from "../components/Page";
import { t } from "../i18n";

export function MemoryPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    getSettings().then(setSettings).catch(() => setSettings(null));
  }, []);

  function persist(next: AppSettings) {
    setSettings(next);
    void updateSettings(next).catch(() => undefined);
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader title={t("شو بيعرف رفيق عني")} description={t("كل شي رفيق متذكّره عنك. عدّل أي سطر، طفّيه، أو امسحه؛ وما في شي مخفي برّا هالقائمة.")} />
      {settings && <MemorySettings settings={settings} persist={persist} />}
    </div>
  );
}
