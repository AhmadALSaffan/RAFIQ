/** Above a council's decision in a chat: what each model answered and said about the others. */

import { useState } from "react";
import { Markdown } from "../../components/Markdown";
import { ChevronDownIcon, CouncilIcon } from "../../components/Icons";
import { messageDir } from "../../lib/bidi";
import type { CouncilSeat } from "../../lib/types";
import { t } from "../../i18n";

export function CouncilRecord({ seats }: { seats: CouncilSeat[] }) {
  const [open, setOpen] = useState(false);
  const muted = { color: "var(--color-ink-muted)" };
  return (
    <div className="rounded-2xl" style={{ background: "var(--color-surface)" }}>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-2.5 text-start text-xs font-medium" style={muted}>
        <CouncilIcon className="h-4 w-4" style={{ color: "var(--color-accent)" }} />
        <span className="flex-1">{t("قرار المجلس · {0}", { 0: seats.map((s) => s.name).join(t("، ")) })}</span>
        <ChevronDownIcon className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="flex flex-col gap-4 border-t px-4 py-3 text-sm" style={{ borderColor: "var(--color-border)" }}>
          {seats.map((seat) => (
            <section key={seat.id}>
              <h4 className="mb-1 text-xs font-bold">{seat.name}</h4>
              <div dir={messageDir(seat.answer)}>
                <Markdown text={seat.answer || t("ما جاوب.")} />
              </div>
              {seat.critique && (
                <div className="mt-2" dir={messageDir(seat.critique)}>
                  <p className="mb-1 text-xs font-semibold" style={muted}>
                    {t("نقده للباقي")}
                  </p>
                  <Markdown text={seat.critique} />
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
