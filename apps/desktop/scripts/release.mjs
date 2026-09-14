/**
 * Collects a finished `pnpm build:app` into a release folder ready to upload:
 *
 *   release/Rafiq_<version>_x64-setup.exe   — ASCII name, safe for GitHub release assets
 *   release/SHA256SUMS.txt                  — so people can check the download
 *
 * The NSIS bundle itself is named after productName ("رفيق"); the copy only changes the
 * file name, never the installer.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf-8"));
const nsisDir = join(root, "src-tauri", "target", "release", "bundle", "nsis");

const built = readdirSync(nsisDir).find((name) => name.endsWith(`_${version}_x64-setup.exe`));
if (!built) {
  console.error(`No installer for ${version} in ${nsisDir} — run "pnpm build:app" first.`);
  process.exit(1);
}

const releaseDir = join(root, "..", "..", "release");
mkdirSync(releaseDir, { recursive: true });
const assetName = `Rafiq_${version}_x64-setup.exe`;
const target = join(releaseDir, assetName);
copyFileSync(join(nsisDir, built), target);

const digest = createHash("sha256").update(readFileSync(target)).digest("hex");
writeFileSync(join(releaseDir, "SHA256SUMS.txt"), `${digest}  ${assetName}\n`);

const mb = (statSync(target).size / 1024 / 1024).toFixed(1);
console.log(`release/${assetName}  (${mb} MB)`);
console.log(`sha256  ${digest}`);
