"""Packs the frozen agent folder (apps/agent/dist/rafiq-agent, built by `pnpm build:agent`)
as the Windows download for the terminal on its own: release/Rafiq-CLI-windows-x64.zip and
its .sha256, published on the GitHub release "cli" that install.ps1 downloads from."""
import hashlib
import sys
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = root / "apps/agent/dist/rafiq-agent"
out = root / "release"
if not (source / "rafiq.exe").exists():
    sys.exit(f"Build the agent first (pnpm build:agent): {source} has no rafiq.exe")
out.mkdir(exist_ok=True)
target = out / "Rafiq-CLI-windows-x64.zip"
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for file in sorted(source.rglob("*")):
        if file.is_file():
            archive.write(file, file.relative_to(source).as_posix())
digest = hashlib.sha256(target.read_bytes()).hexdigest()
(out / (target.name + ".sha256")).write_text(f"{digest}  {target.name}\n", encoding="ascii")
print(target, target.stat().st_size, digest)
