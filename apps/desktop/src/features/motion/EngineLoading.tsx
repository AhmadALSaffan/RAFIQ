/** What a motion project shows while its engine starts (fonts, pictures, 3D): it now starts
 *  when the project opens, not with the app. */

import { t } from "../../i18n";

export function EngineLoading({ full = false }: { full?: boolean }) {
  return (
    <div
      className={`${full ? "h-full" : "absolute inset-0 z-10"} flex items-center justify-center`}
      style={full ? undefined : { background: "var(--color-surface-2)" }}
      role="status"
    >
      <div className="flex flex-col items-center gap-3 text-sm" style={{ color: "var(--color-ink-muted)" }}>
        <span
          className="h-7 w-7 animate-spin rounded-full border-2 motion-reduce:animate-none"
          style={{ borderColor: "var(--color-border)", borderTopColor: "var(--color-accent)" }}
          aria-hidden
        />
        {t("عم يجهّز محرّك الموشن…")}
      </div>
    </div>
  );
}
