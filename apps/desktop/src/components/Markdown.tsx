import { memo } from "react";
import { CodeBlock } from "./arc/code-block/code-block";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isolateMentions } from "../lib/bidi";

// Past this many lines a block opens folded to a fixed height: a design's whole HTML or a
// motion scene streams in as one block, and a chat that grows with every line drags the
// reader down with it.
const FOLD_LINES = 16;

export const Markdown = memo(function Markdown({ text, live = false }: { text: string; live?: boolean }) {
  // @ملف / #مهمة inside Arabic prose would otherwise flip the sentence around them.
  const source = isolateMentions(text);
  return (
    <div className="md" dir="auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const match = /language-(\w+)/.exec(className ?? "");
            const code = String(children ?? "");
            if (match || code.includes("\n")) {
              return <CodeBlock language={match?.[1] ?? "text"} code={code.replace(/\n$/, "")} maxLines={FOLD_LINES} live={live} />;
            }
            return (
              <code className="md-inline" dir="ltr">
                {children}
              </code>
            );
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="md-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});
