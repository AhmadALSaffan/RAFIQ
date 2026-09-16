# PyInstaller spec for the packaged backend.
#
# Build with:  .venv/Scripts/pyinstaller rafiq-agent.spec --noconfirm
# Output:      dist/rafiq-agent/rafiq-agent.exe  (a folder, shipped as a Tauri resource)
#
# One-folder on purpose: one-file would unpack ~200MB of litellm on every launch.

from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_submodules

datas = []
binaries = []
hiddenimports = []

# litellm reads its model-price table and tokenizer data at runtime, and imports provider
# modules dynamically — nothing short of collect_all catches all of it.
# The MCP client (and its own HTTP stack) is imported lazily when a server connects, so it's
# collected whole as well.
# (mcp's own `mcp.cli` needs typer and exits when imported — Rafiq only uses the client.)
mcp_datas, mcp_binaries, mcp_hidden = collect_all("mcp", filter_submodules=lambda name: not name.startswith("mcp.cli"))
datas += mcp_datas
binaries += mcp_binaries
hiddenimports += mcp_hidden

for package in (
    "litellm",
    "tiktoken",
    "tiktoken_ext",
    "keyring",
    "jiter",
    "mcp_types",
    "httpx2",
    "httpcore2",
    "sse_starlette",
    "opentelemetry",
    # Vertex AI signs its requests with a service account; boto3 signs Bedrock's.
    "google.auth",
    "botocore",
):
    package_datas, package_binaries, package_hidden = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hidden

hiddenimports += collect_submodules("uvicorn")
hiddenimports += collect_submodules("aiosqlite")
hiddenimports += [
    "keyring.backends.Windows",
    "win32ctypes.core",
    "win32ctypes.core.cffi",
    "encodings.idna",
    "email.mime.multipart",
]

# GitHub Copilot's SDK is optional: bundled when installed in the build venv. Its runtime
# (~100 MB) is not — the SDK downloads and checksum-verifies it on the first Copilot sign-in.
try:
    import copilot  # noqa: F401

    copilot_datas, copilot_binaries, copilot_hidden = collect_all("copilot")
    datas += copilot_datas
    binaries += copilot_binaries
    hiddenimports += copilot_hidden
except ImportError:
    pass

# The skills ship with the app: they're markdown next to the package, not importable code.
datas += collect_data_files("rafiq_agent", includes=["skills/bundled/**/*"])

analysis = Analysis(
    ["run_agent.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "notebook", "IPython", "pytest"],
    noarchive=False,
)

pyz = PYZ(analysis.pure)

exe = EXE(
    pyz,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name="rafiq-agent",
    debug=False,
    strip=False,
    upx=False,
    # No terminal window when the desktop app starts it.
    console=False,
)

collect = COLLECT(
    exe,
    analysis.binaries,
    analysis.datas,
    strip=False,
    upx=False,
    name="rafiq-agent",
)
