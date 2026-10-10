import { describe, expect, it } from "vitest";
import type { ChatPart } from "../../lib/types";
import { collectActivity } from "./ActivityPanel";
import { doing, statusOf } from "./WorkStatus";

const tool = (id: string, name: string, args: Record<string, unknown>, ok?: boolean, output?: string): ChatPart => ({ kind: "tool", id, tool: name, args, ok, output });

describe("what the model did, for the side panel", () => {
  it("lists each written file once, newest first", () => {
    const { files, commands } = collectActivity([
      tool("1", "filesystem_write", { path: "./site/index.html" }, true),
      tool("2", "filesystem_write", { path: "notes.md" }, true),
      tool("3", "filesystem_write", { path: "site\\index.html" }, false),
      tool("4", "filesystem_read", { path: "photo.png" }, true),
    ]);
    expect(files.map((f) => [f.path, f.state])).toEqual([
      ["site/index.html", "fail"],
      ["notes.md", "ok"],
    ]);
    expect(commands).toEqual([]);
  });

  it("keeps commands in order, with their output and state", () => {
    const { commands } = collectActivity([tool("1", "shell_run", { command: "npm test" }, true, "ok"), tool("2", "shell_run", { command: "npm run build" })]);
    expect(commands.map((c) => [c.command, c.state, c.output])).toEqual([
      ["npm test", "ok", "ok"],
      ["npm run build", "running", ""],
    ]);
  });
});

describe("the status line", () => {
  it("names what a running tool is doing", () => {
    expect(doing("filesystem_read", { path: "src/app/main.py" })).toContain("main.py");
    expect(doing("shell_run", { command: "npm test" })).toContain("npm test");
    expect(doing("shell_run", { command: "x".repeat(200) }).length).toBeLessThan(80);
  });

  it("follows the reply: waiting, a tool, writing, thinking", () => {
    expect(statusOf([{ kind: "permission", id: "p", call: { id: "c", tool: "shell_run", category: "exec", args: {} } as never, resolution: "pending" }]).kind).toBe("permission");
    expect(statusOf([tool("1", "filesystem_write", { path: "a.txt" })]).kind).toBe("tool");
    expect(statusOf([tool("1", "filesystem_write", { path: "a.txt" }, true), { kind: "text", text: "تم" }]).kind).toBe("writing");
    expect(statusOf([tool("1", "filesystem_write", { path: "a.txt" }, true)]).kind).toBe("thinking");
    expect(statusOf([]).kind).toBe("thinking");
  });
});
