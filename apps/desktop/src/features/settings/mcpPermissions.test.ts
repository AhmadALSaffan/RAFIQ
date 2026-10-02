import { describe, expect, it } from "vitest";
import type { McpPermissions } from "../../lib/types";
import { effectiveMode, withToolMode } from "./mcpPermissions";

const perms: McpPermissions = { read: "auto", write: null, tools: { delete_file: "deny" } };

describe("MCP tool permissions", () => {
  it("takes the tool's own mode, then its group's, then the global one", () => {
    expect(effectiveMode(perms, "delete_file", false, "ask")).toEqual({ mode: "deny", from: "tool" });
    expect(effectiveMode(perms, "search", true, "ask")).toEqual({ mode: "auto", from: "group" });
    expect(effectiveMode(perms, "create_file", false, "ask")).toEqual({ mode: "ask", from: "global" });
    expect(effectiveMode({ tools: {} }, "search", true, "deny")).toEqual({ mode: "deny", from: "global" });
  });

  it("sets or clears one tool without touching the rest", () => {
    const set = withToolMode(perms, "create_file", "ask");
    expect(set.tools).toEqual({ delete_file: "deny", create_file: "ask" });
    const cleared = withToolMode(set, "delete_file", null);
    expect(cleared.tools).toEqual({ create_file: "ask" });
    expect(perms.tools).toEqual({ delete_file: "deny" }); // the original is left alone
    expect(cleared.read).toBe("auto");
  });
});
