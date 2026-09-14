import { splitTokens } from "../lib/bidi";

/**
 * Renders text with `@ملف` / `#مهمة` / `/أمر` mentions in the brand colour, each inside a
 * `<bdi>` so a Latin path can't flip the Arabic sentence around it.
 */
export function TokenText({ text }: { text: string }) {
  return (
    <>
      {splitTokens(text).map((chunk, i) =>
        chunk.token ? (
          <bdi key={i} className="composer-token" dir="ltr">
            {chunk.text}
          </bdi>
        ) : (
          <span key={i}>{chunk.text}</span>
        ),
      )}
    </>
  );
}
