/** Beside the model menu: the smart route is on, so a simple question may go elsewhere. One
 *  press turns it off or on again; set it up in Settings → Usage. */

import { useEffect, useState } from "react";
import { getSettings, updateSettings } from "../../lib/api";
import type { AppSettings } from "../../lib/types";
import { BoltIcon } from "../../components/Icons";
import { t } from "../../i18n";

export function SmartRouteChip() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    getSettings().then(setSettings).catch(() => setSettings(null));
  }, []);
  if (!settings?.cheap_model_id) return null; // not set up: nothing to say

  const on = settings.smart_route ?? false;
  function toggle() {
    if (!settings) return;
    const next = { ...settings, smart_route: !on };
    setSettings(next);
    void updateSettings(next).catch(() => setSettings(settings));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      title={on ? t("المسار الذكي شغّال: الأسئلة البسيطة بتروح للنموذج الرخيص") : t("المسار الذكي مطفي: كل شي بيروح للنموذج اللي اخترته")}
      className="flex h-8 items-center gap-1 rounded-full px-2 text-xs transition-colors hover:bg-[var(--color-surface-2)]"
      style={{ color: on ? "var(--color-accent)" : "var(--color-ink-muted)" }}
    >
      <BoltIcon className="h-3.5 w-3.5" />
      {t("مسار ذكي")}
    </button>
  );
}
