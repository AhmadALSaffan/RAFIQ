import { describe, expect, it } from "vitest";
import { MCP_CATEGORY_LABEL, MCP_PRESETS } from "./mcpCatalog";
import { hasMcpLogo } from "../components/McpLogo";

describe("the MCP catalogue", () => {
  it("has one entry per id", () => {
    const ids = MCP_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every server its own mark", () => {
    expect(MCP_PRESETS.filter((p) => !hasMcpLogo(p.id)).map((p) => p.id)).toEqual([]);
  });

  it("describes each server the way it runs", () => {
    for (const p of MCP_PRESETS) {
      expect(MCP_CATEGORY_LABEL[p.category], p.id).toBeTruthy();
      expect(p.docs.startsWith("https://"), p.id).toBe(true);
      if (p.transport === "http") {
        expect(p.url?.startsWith("https://"), p.id).toBe(true);
        expect(p.command, p.id).toBeUndefined();
      } else {
        expect(p.command, p.id).toBeTruthy();
        expect(p.auth, p.id).not.toBe("oauth"); // a browser sign-in needs a remote server
      }
      // A `{param}` in the command needs a field to fill it, and the other way round.
      expect(Boolean(p.args?.includes("{param}")), p.id).toBe(Boolean(p.param));
      if (p.auth === "token") expect(p.secrets?.length, p.id).toBeGreaterThan(0);
    }
  });
});
