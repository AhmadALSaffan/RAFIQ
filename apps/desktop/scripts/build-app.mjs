/**
 * Builds the installer, signed for the updater.
 *
 * The signing key lives outside this repo — `~/.tauri/rafiq-updater.key`, generated once
 * with `pnpm tauri signer generate -w ~/.tauri/rafiq-updater.key`. It is never committed;
 * only its public half is in tauri.conf.json. Without it the build still runs, but produces
 * no .sig, so `release.mjs` writes no latest.json and installed copies see no update.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const keyPath = process.env.RAFIQ_SIGNING_KEY ?? join(homedir(), ".tauri", "rafiq-updater.key");
const env = { ...process.env };

if (existsSync(keyPath)) {
  env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(keyPath, "utf-8").trim();
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= "";
} else {
  console.warn(`No signing key at ${keyPath} — building an installer that can't be offered as an update.`);
}

const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit", shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run("pnpm", ["build:agent"]);
run("pnpm", ["tauri", "build"]);
