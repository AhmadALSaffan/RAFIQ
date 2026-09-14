import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isolateMentions } from "../lib/bidi";

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span dir="ltr">{language || "code"}</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            });
          }}
        >
          {copied ? "انتسخ ✓" : "نسخ"}
        </button>
      </div>
      <pre dir="ltr">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
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
              return <CodeBlock language={match?.[1] ?? ""} code={code.replace(/\n$/, "")} />;
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
