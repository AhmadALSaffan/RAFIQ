/**
 * Stops the test's servers and deletes its throwaway data folder.
 *
 * Playwright stops its servers on its own, but on Windows it waits minutes for the agent's
 * process tree to go. Ending whatever listens on the test's ports first makes the run
 * finish when the tests do.
 */

import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { PORTS } from "./ports";

// By full path: PATH may not include System32 when run from another shell.
const system32 = join(process.env.SystemRoot ?? "C:\\Windows", "System32");

function listeners(ports: number[]): string[] {
  if (process.platform === "win32") {
    // IPv4 and IPv6 both: Vite listens on [::1].
    const out = execSync(`"${join(system32, "netstat.exe")}" -ano`, { encoding: "utf8" });
    return out
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .filter((cols) => cols[0] === "TCP" && cols[3] === "LISTENING" && ports.some((p) => cols[1]?.endsWith(`:${p}`)))
      .map((cols) => cols[4]);
  }
  const pids = ports.flatMap((p) => {
    try {
      return execSync(`lsof -ti tcp:${p} -sTCP:LISTEN`, { encoding: "utf8" }).split("\n");
    } catch {
      return [];
    }
  });
  return pids.filter(Boolean);
}

export default function teardown(): void {
  for (const pid of new Set(listeners(Object.values(PORTS)))) {
    try {
      execSync(process.platform === "win32" ? `"${join(system32, "taskkill.exe")}" /F /T /PID ${pid}` : `kill -9 ${pid}`, { stdio: "ignore" });
    } catch {
      // Already gone.
    }
  }
  const data = process.env.RAFIQ_E2E_DATA;
  if (data) rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
