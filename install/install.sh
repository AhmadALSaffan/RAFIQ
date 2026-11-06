#!/bin/sh
# Rafiq in the terminal, on its own (no app), for macOS on Apple Silicon:
#
#   curl -fsSL https://rafiqagent.com/install.sh | sh
#
# Downloads the published archive from GitHub (release "cli"), checks its SHA-256, unpacks it
# to ~/.rafiq/cli and links `rafiq` into ~/.local/bin. Run it again to update.
set -eu

base="https://github.com/AhmadALSaffan/RAFIQ/releases/download/cli"
name="Rafiq-CLI-macos-arm64.tar.gz"
dir="$HOME/.rafiq/cli"
bin="$HOME/.local/bin"

if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  echo "This installer is for macOS on Apple Silicon. On Windows: irm https://rafiqagent.com/install.ps1 | iex" >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
echo "Downloading Rafiq for the terminal..."
curl -fsSL "$base/$name" -o "$tmp/$name"
expected="$(curl -fsSL "$base/$name.sha256" | awk '{print $1}')"
actual="$(shasum -a 256 "$tmp/$name" | awk '{print $1}')"
if [ "$expected" != "$actual" ]; then
  echo "The download doesn't match the published checksum. Nothing was installed." >&2
  exit 1
fi

rm -rf "$dir"
mkdir -p "$dir" "$bin"
tar -xzf "$tmp/$name" -C "$dir"
ln -sf "$dir/rafiq" "$bin/rafiq"

echo
echo "Rafiq is installed: $bin/rafiq"
case ":$PATH:" in
  *":$bin:"*) echo "Open a new terminal and type: rafiq" ;;
  *) echo "Add it to your PATH (for example in ~/.zshrc):  export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
esac
echo "The first time, it helps you add a model (your own key, or a free local one with Ollama)."
