/**
 * Citations from an agent's knowledge base. The model cites a passage by its ID, like
 * [kb-0123456789]; the app turns each ID into a numbered link — but only when the ID is one
 * this reply's searches actually returned (the reply's "citations" part). Anything else is
 * shown as unverified, never as a link. Opening one asks the agent again, so a folder taken
 * away from the agent since can't be read through an old reply.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import type { ChatPart, CitationDetail, CitationItem, Provider } from "../../lib/types";
import { getCitation, openCitation, providerLabel } from "../../lib/api";
import { revealPath } from "../../lib/folders";
import { Dialog } from "../../components/ChatCommands";
import { Button } from "../../components/ui";
import { AlertIcon, FileIcon, LockIcon } from "../../components/Icons";
import { t } from "../../i18n";

export type CitationsPart = Extract<ChatPart, { kind: "citations" }>;

const ID = /kb-[0-9a-f]{10}/g;
// [kb-…], or several in one pair of brackets: [kb-…, kb-…]
const GROUP = /\[((?:\s*kb-[0-9a-f]{10}\s*[,،;]?)+)\]/g;

/** Citation IDs in the order the reply first uses them: that order is their number. */
export function citationOrder(text: string): string[] {
  return [...new Set(text.match(ID) ?? [])];
}

/** [kb-…] → a markdown link the renderer turns into a numbered chip. */
export function linkCitations(text: string): string {
  if (!text.includes("kb-")) return text;
  return text.replace(GROUP, (_, ids: string) => (ids.match(ID) ?? []).map((id) => `[${id}](#cite-${id})`).join(""));
}

interface Citations {
  order: string[];
  items: Map<string, CitationItem>;
  open: (id: string) => void;
}

const CitationContext = createContext<Citations | null>(null);

/** One reply's citations: which IDs are real, their numbers, and the viewer. */
export function CitationScope({ part, text, children }: { part?: CitationsPart; text: string; children: React.ReactNode }) {
  const [viewing, setViewing] = useState<string | null>(null);
  const value = useMemo<Citations>(
    () => ({ order: citationOrder(text), items: new Map((part?.items ?? []).map((i) => [i.id, i])), open: setViewing }),
    [part, text],
  );
  return (
    <CitationContext.Provider value={value}>
      {children}
      <AnimatePresence>
        {viewing && part && value.items.has(viewing) && (
          <CitationViewer agentId={part.agent_id} item={value.items.get(viewing)!} number={value.order.indexOf(viewing) + 1} onClose={() => setViewing(null)} />
        )}
      </AnimatePresence>
    </CitationContext.Provider>
  );
}

/** What a `#cite-kb-…` link renders as inside the reply. */
export function CitationChip({ id }: { id: string }) {
  const scope = useContext(CitationContext);
  const item = scope?.items.get(id);
  if (!scope || !item) {
    return (
      <span
        className="mx-0.5 inline-flex items-center gap-0.5 rounded px-1 align-baseline text-[10px] font-medium"
        style={{ background: "var(--color-surface-2)", color: "var(--color-danger)" }}
        title={t("مصدر ما بيطابق ولا مقطع رجع بهالرد، فما بيتفتح.")}
      >
        <AlertIcon className="h-2.5 w-2.5" />
        {t("مصدر مش مؤكد")}
      </span>
    );
  }
  const n = scope.order.indexOf(id) + 1;
  return (
    <button
      type="button"
      onClick={() => scope.open(id)}
      className="mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md px-1 align-text-top text-[11px] font-semibold transition-transform hover:scale-110"
      style={{ background: "var(--color-accent-soft, var(--color-surface-2))", color: "var(--color-accent)" }}
      title={`${item.rel_path}${item.heading ? ` › ${item.heading}` : ""} · ${linesLabel(item)}`}
      aria-label={t("المصدر {0}: {1}", { 0: n, 1: item.rel_path })}
    >
      <span className="num">{n}</span>
    </button>
  );
}

function linesLabel(item: CitationItem): string {
  return item.line_start === item.line_end ? t("سطر {0}", { 0: item.line_start }) : t("الأسطر {0}–{1}", { 0: item.line_start, 1: item.line_end });
}

/** Under the reply: the passages it cited, and where their text went. */
export function KnowledgeSources({ part, text }: { part: CitationsPart; text: string }) {
  const scope = useContext(CitationContext);
  const order = citationOrder(text).filter((id) => part.items.some((i) => i.id === id));
  const cited = order.map((id) => part.items.find((i) => i.id === id)!);
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      {cited.length > 0 && (
        <ol className="flex flex-col gap-1">
          {cited.map((item, i) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => scope?.open(item.id)}
                className="flex max-w-full items-center gap-2 rounded-lg px-2 py-1 text-start transition-colors hover:bg-[var(--color-surface-2)]"
              >
                <span className="num inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-md text-[11px] font-semibold" style={{ background: "var(--color-surface-2)", color: "var(--color-accent)" }}>
                  {i + 1}
                </span>
                <FileIcon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--color-ink-muted)" }} />
                <span className="min-w-0 truncate">
                  <bdi className="font-medium">{item.rel_path}</bdi>
                  {item.heading && (
                    <span style={{ color: "var(--color-ink-muted)" }}>
                      {" › "}
                      <bdi>{item.heading}</bdi>
                    </span>
                  )}
                </span>
                <span className="num shrink-0" style={{ color: "var(--color-ink-muted)" }}>
                  {linesLabel(item)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className="flex items-start gap-1.5 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
        {part.sent_to ? <AlertIcon className="mt-0.5 h-3 w-3 shrink-0" /> : <LockIcon className="mt-0.5 h-3 w-3 shrink-0" />}
        <span>
          {part.sent_to
            ? t("المقاطع اللي لقاها من ملفاتك انبعتت لـ {0} ليكتب هالرد.", { 0: providerLabel(part.sent_to as Provider) })
            : t("المقاطع اللي لقاها من ملفاتك ضلت على جهازك.")}
          {part.embedded_with && ` ${t("وسؤالك انبعت لـ {0} ليدوّر بالمعنى.", { 0: part.embedded_with })}`}
        </span>
      </p>
    </div>
  );
}

/** The cited passage in its file, the cited lines marked; and a way to open the file itself. */
function CitationViewer({ agentId, item, number, onClose }: { agentId: string; item: CitationItem; number: number; onClose: () => void }) {
  const [detail, setDetail] = useState<CitationDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const marked = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    getCitation(agentId, item.id)
      .then(setDetail)
      .catch(() => setFailed(true));
  }, [agentId, item.id]);
  useEffect(() => {
    marked.current?.scrollIntoView({ block: "center" });
  }, [detail]);

  async function open() {
    try {
      const result = await openCitation(agentId, item.id);
      setOpened(result.opened === "editor" ? t("انفتح بالمحرّر على السطر {0}.", { 0: result.line ?? item.line_start }) : t("انفتح بالبرنامج الافتراضي."));
    } catch {
      setOpened(t("ما قدرت أفتح الملف."));
    }
  }

  return (
    <Dialog title={t("المصدر {0}: {1}", { 0: number, 1: item.rel_path })} subtitle={`${item.source_name}${item.heading ? ` › ${item.heading}` : ""} · ${linesLabel(item)}`} onClose={onClose}>
      {failed ? (
        <p className="text-sm" style={{ color: "var(--color-danger)" }}>
          {t("هالوكيل ما عاد يقدر يفتح هالمصدر: المجلد انشال منه، أو الملف تغيّر من وقتها.")}
        </p>
      ) : !detail ? (
        <div className="shimmer h-40 rounded-xl" />
      ) : (
        <>
          <div className="max-h-[46vh] overflow-auto rounded-xl py-2 font-mono text-xs leading-relaxed" style={{ background: "var(--color-surface-2)" }} dir="ltr">
            {detail.context.map((line, i) => {
              const n = detail.context_start + i;
              const hit = n >= detail.line_start && n <= detail.line_end;
              return (
                <div
                  key={n}
                  ref={n === detail.line_start ? marked : undefined}
                  className="flex gap-3 px-3"
                  style={hit ? { background: "color-mix(in oklab, var(--color-accent) 16%, transparent)" } : { opacity: 0.6 }}
                >
                  <span className="num w-8 shrink-0 select-none text-end" style={{ color: "var(--color-ink-muted)" }}>
                    {n}
                  </span>
                  <span className="min-w-0 whitespace-pre-wrap break-words" dir="auto">
                    {line || " "}
                  </span>
                </div>
              );
            })}
            {!detail.exists && (
              <p className="px-3 pt-2" style={{ color: "var(--color-pending)" }} dir="auto">
                {t("الملف ما عاد موجود؛ هاد النص من الفهرس.")}
              </p>
            )}
          </div>
          <p className="truncate font-mono text-[11px]" dir="ltr" title={detail.path} style={{ color: "var(--color-ink-muted)" }}>
            {detail.path}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void open()} disabled={!detail.exists}>
              {t("افتح الملف")}
            </Button>
            <Button variant="ghost" onClick={() => void revealPath(detail.path)} disabled={!detail.exists}>
              {t("بيّنه بالمجلد")}
            </Button>
            {opened && (
              <span className="text-xs" role="status" style={{ color: "var(--color-ink-muted)" }}>
                {opened}
              </span>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
