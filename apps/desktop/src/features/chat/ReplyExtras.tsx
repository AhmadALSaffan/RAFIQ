/** Small notes on a reply: where its facts came from, and which model the smart route used. */

import { sourcesOf } from "../../lib/sources";
import { revealPath } from "../../lib/folders";
import { FileIcon } from "../../components/Icons";
import type { ChatPart } from "../../lib/types";
import { t } from "../../i18n";

/** Fired on window to ask the same thing again with the model the user picked. */
export const ASK_STRONG_EVENT = "rafiq:ask-strong";

export function SourcesList({ parts, text }: { parts: ChatPart[]; text: string }) {
  const sources = sourcesOf(parts, text);
  if (!sources.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label={t("المصادر")}>
      <span className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
        {t("المصادر:")}
      </span>
      {sources.map((s) => (
        <button
          key={s.n}
          type="button"
          onClick={() => void revealPath(s.path)}
          title={s.path}
          className="flex max-w-72 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-[var(--color-surface-2)]"
          style={{ borderColor: "var(--color-border)" }}
        >
          <span className="num font-semibold" style={{ color: "var(--color-accent)" }}>
            {s.n}
          </span>
          <FileIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate" dir="auto">
            {s.file}
          </span>
          {s.page !== null && <span style={{ color: "var(--color-ink-muted)" }}>{t("ص {0}", { 0: s.page })}</span>}
        </button>
      ))}
    </div>
  );
}

export function RoutedNote({ part, messageId }: { part: Extract<ChatPart, { kind: "routed" }>; messageId?: string }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--color-ink-muted)" }}>
      <span>{t("جاوب {0} بالمسار الذكي، لأنه سؤال بسيط", { 0: part.to_name })}</span>
      {messageId && (
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent(ASK_STRONG_EVENT, { detail: messageId }))}
          className="underline underline-offset-2 hover:text-[var(--color-ink)]"
        >
          {t("اسأل {0} بدله", { 0: part.from_name })}
        </button>
      )}
    </p>
  );
}
