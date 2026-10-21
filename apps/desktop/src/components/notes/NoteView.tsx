/**
 * A note as it reads: Markdown rendered with each paragraph in its own direction and every
 * phrase in the other language kept whole (lib/notesRehype.ts). Pictures come from the
 * note's own folder, `[[links]]` open other notes, and ticking a task box changes the note.
 */

import { Children, cloneElement, isValidElement, memo, useEffect, useState, type ReactElement, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "../arc/code-block/code-block";
import { rehypeNoteBidi, wikiLinks } from "../../lib/notesRehype";
import { noteImageUrl } from "../../lib/api";
import { direction } from "../../i18n";

function NoteImage({ note, src, alt }: { note: string; src: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(/^(https?:|data:)/i.test(src) ? src : null);
  useEffect(() => {
    if (/^(https?:|data:)/i.test(src)) return;
    let alive = true;
    noteImageUrl(note, decodeURI(src)).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [note, src]);
  if (!url) return null;
  return <img src={url} alt={alt} loading="lazy" className="note-image" draggable={false} />;
}

interface Props {
  text: string;
  /** The note's path, for its pictures. */
  path: string;
  onOpenNote?: (name: string) => void;
  /** Ticks or unticks the task on this line (1-based) of the note. */
  onToggleTask?: (line: number) => void;
}

export const NoteView = memo(function NoteView({ text, path, onOpenNote, onToggleTask }: Props) {
  return (
    <div className="md note-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a hast plugin, typed loosely in notesRehype
        rehypePlugins={[[rehypeNoteBidi as any, { fallback: direction() }]]}
        urlTransform={(url) => (url.startsWith("note:") ? url : defaultUrlTransform(url))}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const match = /language-(\w+)/.exec(className ?? "");
            const code = String(children ?? "");
            if (match || code.includes("\n")) return <CodeBlock language={match?.[1] ?? "text"} code={code.replace(/\n$/, "")} maxLines={400} />;
            return (
              <code className="md-inline" dir="ltr">
                {children}
              </code>
            );
          },
          a: ({ href, children }) => {
            if (href?.startsWith("note:")) {
              const target = decodeURIComponent(href.slice(5));
              return (
                <button type="button" className="note-link" onClick={() => onOpenNote?.(target)}>
                  {children}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            );
          },
          img: ({ src, alt }) => (typeof src === "string" ? <NoteImage note={path} src={src} alt={alt ?? ""} /> : null),
          table: ({ children, node }) => (
            <div className="md-table">
              <table dir={(node?.properties?.dir as string | undefined) ?? undefined}>{children}</table>
            </div>
          ),
          li: ({ children, className, node, ...rest }) => {
            const line = node?.position?.start.line;
            if (!className?.includes("task-list-item") || !line || !onToggleTask) {
              return (
                <li className={className} dir={(rest as { dir?: string }).dir}>
                  {children}
                </li>
              );
            }
            // The checkbox react-markdown draws is read-only; this one changes the note.
            return (
              <li className={className} dir={(rest as { dir?: string }).dir}>
                {Children.map(children as ReactNode, (child) =>
                  isValidElement(child) && child.type === "input"
                    ? cloneElement(child as ReactElement<{ disabled?: boolean; onChange?: () => void; className?: string }>, {
                        disabled: false,
                        onChange: () => onToggleTask(line),
                        className: "note-task",
                      })
                    : child,
                )}
              </li>
            );
          },
        }}
      >
        {wikiLinks(text)}
      </ReactMarkdown>
    </div>
  );
});
