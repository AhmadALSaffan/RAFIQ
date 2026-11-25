#!/bin/bash
# Makes this runner look like a user's Mac to the frozen agent: hides the certificates of the
# runner's python.org Python, which the OpenSSL bundled into the agent would otherwise find.
# `hide_python_certs.sh` hides them and proves Python can't open HTTPS without them;
# `hide_python_certs.sh restore` puts them back.
set -euo pipefail

cafile=$(python3 -c "import ssl; print(ssl.get_default_verify_paths().openssl_cafile)")
capath=$(python3 -c "import ssl; print(ssl.get_default_verify_paths().openssl_capath)")

if [ "${1:-}" = "restore" ]; then
  for path in "$cafile" "$capath"; do
    if [ -e "$path.hidden" ] || [ -L "$path.hidden" ]; then sudo mv "$path.hidden" "$path"; fi
  done
  exit 0
fi

echo "The bundled OpenSSL looks for certificates in $cafile and $capath"
for path in "$cafile" "$capath"; do
  if [ -e "$path" ] || [ -L "$path" ]; then sudo mv "$path" "$path.hidden"; fi
done
if env -u SSL_CERT_FILE -u SSL_CERT_DIR python3 -c "import urllib.request; urllib.request.urlopen('https://github.com', timeout=20)" 2>/dev/null; then
  echo "::error::Python still opens HTTPS without those certificates; this no longer stands for a user's Mac"
  exit 1
fi
echo "Python alone can't open HTTPS now, like on a Mac without python.org's Python"
