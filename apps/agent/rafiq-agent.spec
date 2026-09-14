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
for package in ("litellm", "tiktoken", "tiktoken_ext", "keyring", "jiter"):
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
