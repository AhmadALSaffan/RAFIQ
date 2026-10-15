/**
 * The end-to-end smoke test: the real agent and the real UI, talking to a pretend model.
 *
 * Three servers start for it, each on a port of its own so a running dev setup (1420,
 * 8765) is left alone: the fake model, the agent on a throwaway data folder, and Vite
 * pointed at that agent. The browser is the Edge that ships with Windows, so nothing is
 * downloaded. Run with `pnpm e2e`.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defineConfig } from "@playwright/test";
import { PORTS, TOKEN } from "./ports";

const agentDir = resolve(import.meta.dirname, "../../agent");
const python = process.platform === "win32" ? join(agentDir, ".venv", "Scripts", "python.exe") : join(agentDir, ".venv", "bin", "python");
// A fresh, empty Rafiq every run: no chats, no models, no settings carried over.
const dataDir = (process.env.RAFIQ_E2E_DATA ??= mkdtempSync(join(tmpdir(), "rafiq-e2e-")));

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalTeardown: "./teardown.ts",
  use: {
    baseURL: `http://localhost:${PORTS.ui}`,
    channel: "msedge",
    viewport: { width: 1280, height: 800 },
    locale: "ar",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node fake-model.mjs",
      cwd: import.meta.dirname,
      url: `http://127.0.0.1:${PORTS.model}/health`,
      env: { FAKE_MODEL_PORT: String(PORTS.model) },
      reuseExistingServer: false,
    },
    {
      command: `"${python}" -m uvicorn rafiq_agent.main:app --host 127.0.0.1 --port ${PORTS.agent}`,
      cwd: agentDir,
      url: `http://127.0.0.1:${PORTS.agent}/health`,
      timeout: 120_000,
      env: {
        RAFIQ_DATA_DIR: dataDir,
        RAFIQ_WORKSPACE_DIR: join(dataDir, "workspace"),
        RAFIQ_TOKEN: TOKEN,
        RAFIQ_CORS_ORIGINS: `http://localhost:${PORTS.ui},http://127.0.0.1:${PORTS.ui}`,
      },
      reuseExistingServer: false,
    },
    {
      // Vite itself, not through pnpm: one process, so stopping it stops it.
      command: `node node_modules/vite/bin/vite.js --port ${PORTS.ui} --strictPort`,
      cwd: resolve(import.meta.dirname, ".."),
      url: `http://localhost:${PORTS.ui}`,
      timeout: 120_000,
      env: { VITE_API_BASE: `http://127.0.0.1:${PORTS.agent}`, VITE_API_TOKEN: TOKEN },
      reuseExistingServer: false,
    },
  ],
});
