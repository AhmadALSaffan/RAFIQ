import { describe, expect, it } from "vitest";
import { rehypeNoteBidi, wikiLinks } from "./notesRehype";

type N = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: N[] };
const text = (value: string): N => ({ type: "text", value });
const el = (tagName: string, children: N[]): N => ({ type: "element", tagName, properties: {}, children });

function run(children: N[]): N {
  const tree = { type: "root", children } as never;
  rehypeNoteBidi({ fallback: "rtl" })(tree);
  return tree as unknown as N;
}

/** The text of each isolated phrase, in order. */
function runs(node: N): string[] {
  const out: string[] = [];
  const walk = (n: N) => {
    if (n.tagName === "bdi") {
      const flat = (m: N): string => m.value ?? (m.children ?? []).map(flat).join("");
      out.push(flat(n));
      return;
    }
    (n.children ?? []).forEach(walk);
  };
  walk(node);
  return out;
}

describe("the rendered note", () => {
  it("gives each block its own direction, and a list the direction of most of its items", () => {
    const tree = run([
      el("h2", [text("Notes in English")]),
      el("p", [text("React بيشتغل مع Tauri")]),
      el("ul", [el("li", [text("مهمة أولى")]), el("li", [text("مهمة تانية")]), el("li", [text("English item")])]),
    ]);
    const [h2, p, ul] = tree.children!;
    expect(h2.properties).toMatchObject({ dir: "ltr", id: "h-0" });
    expect(p.properties!.dir).toBe("rtl");
    expect(ul.properties!.dir).toBe("rtl");
    expect(ul.children![2].properties!.dir).toBe("ltr");
  });

  it("isolates a phrase across bold text, but never splits the bold part", () => {
    const whole = run([el("p", [text("شغل على "), el("strong", [text("React")]), text(" Native بسرعة")])]);
    expect(runs(whole)).toEqual(["React Native"]);
    const half = run([el("p", [el("strong", [text("مرحبا React")]), text(" Native هون")])]);
    expect(runs(half)).toEqual([]);
  });
});

describe("links between notes", () => {
  it("turns [[name]] into a note link, leaving code alone", () => {
    expect(wikiLinks("شوف [[أفكار التصميم]] و `[[x]]`")).toBe("شوف [أفكار التصميم](<note:أفكار التصميم>) و `[[x]]`");
    expect(wikiLinks("[[plan|الخطة]]")).toBe("[الخطة](<note:plan>)");
  });
});
