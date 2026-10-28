import { describe, expect, it } from "vitest";
import { needsHold } from "./permissions";

describe("needsHold", () => {
  it("holds for tools that can't be taken back", () => {
    expect(needsHold("filesystem_delete", { path: "a.txt" })).toBe(true);
    expect(needsHold("task_publish", {})).toBe(true);
    expect(needsHold("notify_post", { text: "hi" })).toBe(true);
  });

  it("holds for commands that delete or rewrite history", () => {
    for (const command of ["rm -rf build", "del /q *.log", "Remove-Item -Recurse out", "npm run x && rmdir dist", "git push --force", "git push origin main -f", "git reset --hard HEAD~1", "git clean -fd", "format D: /q", "DROP TABLE users"]) {
      expect(needsHold("shell_run", { command }), command).toBe(true);
    }
  });

  it("holds for scripts that delete", () => {
    for (const script of ["import shutil\nshutil.rmtree('build')", "import os\nos.remove('a.txt')", "from pathlib import Path\nPath('a').unlink()", "require('fs').rmSync('dist', { recursive: true })", "Remove-Item -Recurse out"]) {
      expect(needsHold("shell_run", { script }), script).toBe(true);
    }
  });

  it("clicks for everyday work", () => {
    for (const command of ["npm test", "git push origin main", "git status", "dir", "echo format", "python -m pytest", "pnpm format"]) {
      expect(needsHold("shell_run", { command }), command).toBe(false);
    }
    expect(needsHold("filesystem_write", { path: "a.txt" })).toBe(false);
    expect(needsHold("filesystem_edit", { path: "a.txt", old_text: "a", new_text: "b" })).toBe(false);
    expect(needsHold("shell_run", { script: "import json\nprint(len(open('a.html').read()))", language: "python" })).toBe(false);
    expect(needsHold("web_fetch", { url: "https://example.com" })).toBe(false);
  });
});
