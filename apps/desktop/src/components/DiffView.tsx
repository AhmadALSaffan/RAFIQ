import { useMemo } from "react";

/** A unified diff, coloured line by line. Used by the changes panel and the permission card. */
export function DiffView({ diff, maxHeight = "28rem" }: { diff: string; maxHeight?: string }) {
  const lines = useMemo(() => diff.split("\n").slice(0, 4000), [diff]);
  return (
    <pre
      className="overflow-auto rounded-lg border p-3 font-mono text-[11px] leading-5"
      style={{ maxHeight, borderColor: "var(--color-border)", background: "var(--color-bg)" }}
      dir="ltr"
    >
      {lines.map((line, i) => {
        const color = line.startsWith("+++") || line.startsWith("---")
          ? "var(--color-ink-muted)"
          : line.startsWith("+")
            ? "var(--color-success)"
            : line.startsWith("-")
              ? "var(--color-danger)"
              : line.startsWith("@@")
                ? "var(--color-accent)"
                : line.startsWith("diff ")
                  ? "var(--color-ink)"
                  : "var(--color-ink-muted)";
        const bg = line.startsWith("+") && !line.startsWith("+++")
          ? "color-mix(in oklch, var(--color-success) 8%, transparent)"
          : line.startsWith("-") && !line.startsWith("---")
            ? "color-mix(in oklch, var(--color-danger) 8%, transparent)"
            : undefined;
        return (
          <div key={i} style={{ color, background: bg, fontWeight: line.startsWith("diff ") ? 600 : undefined }}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}
