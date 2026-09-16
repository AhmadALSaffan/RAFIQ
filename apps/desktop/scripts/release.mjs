/**
 * Collects a finished `pnpm build:app` into a release folder ready to upload:
 *
 *   release/Rafiq_<version>_x64-setup.exe   — ASCII name, safe for GitHub release assets
 *   release/SHA256SUMS.txt                  — so people can check the download
 *   release/latest.json                     — what installed copies read to find this build
 *
 * The NSIS bundle itself is named after productName ("رفيق"); the copy only changes the
 * file name, never the installer.
 *
 * latest.json carries the signature Tauri produced from the private key (kept outside this
 * repo, see scripts/build-app.mjs). Upload all three files to the GitHub release: the app
 * asks for latest.json at the `endpoints` URL in tauri.conf.json, verifies the signature
 * against the public key baked into the build, and only then installs.
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

// The updater manifest, pointing at this release's asset on GitHub.
const signatureFile = join(nsisDir, `${built}.sig`);
let signature = null;
try {
  signature = readFileSync(signatureFile, "utf-8").trim();
} catch {
  console.warn(`No ${built}.sig — built without a signing key, so no latest.json was written.`);
}

if (signature) {
  const notesPath = join(root, "..", "..", "release", "NOTES.md");
  let notes = `رفيق ${version}`;
  try {
    notes = readFileSync(notesPath, "utf-8").trim() || notes;
  } catch {
    // No notes file: the version alone is a fine description.
  }
  writeFileSync(
    join(releaseDir, "latest.json"),
    `${JSON.stringify(
      {
        version,
        notes,
        pub_date: new Date().toISOString(),
        platforms: {
          "windows-x86_64": {
            signature,
            url: `https://github.com/AhmadALSaffan/RAFIQ/releases/download/v${version}/${assetName}`,
          },
        },
      },
      null,
      2,
    )}\n`,
  );
}

const mb = (statSync(target).size / 1024 / 1024).toFixed(1);
console.log(`release/${assetName}  (${mb} MB)`);
console.log(`sha256  ${digest}`);
if (signature) console.log(`release/latest.json  → tag v${version}`);
