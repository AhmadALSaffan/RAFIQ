"""HTTPS certificates for the frozen agent.

The Mac build bundles python.org's Python, and its OpenSSL looks for trusted certificates
where that Python keeps them (/Library/Frameworks/Python.framework/…/etc/openssl). The build
machine has them there; a Mac without that Python doesn't, and everything that opens HTTPS
through the standard library then fails with CERTIFICATE_VERIFY_FAILED. httpx carries its own
(certifi), so most of Rafiq never noticed, but Copilot's SDK downloads its runtime with
urllib, so Copilot sign-in failed on such a Mac and nowhere else.

When OpenSSL's own place is empty, point it at certifi's bundle, the one httpx already
trusts. Windows reads the system store as well and never needs this.
"""

import os
import ssl
import sys


def use_bundled_certificates() -> str | None:
    """Points OpenSSL at certifi's bundle when it has nothing of its own. Returns the bundle's
    path when it did, None when nothing needed changing."""
    if sys.platform == "win32" or os.environ.get("SSL_CERT_FILE") or os.environ.get("SSL_CERT_DIR"):
        return None
    paths = ssl.get_default_verify_paths()
    # Each is None when the file or folder isn't there.
    if paths.cafile or (paths.capath and _has_files(paths.capath)):
        return None
    try:
        import certifi
    except ImportError:
        return None
    bundle = certifi.where()
    if not os.path.isfile(bundle):
        return None
    os.environ["SSL_CERT_FILE"] = bundle
    return bundle


def _has_files(folder: str) -> bool:
    try:
        return any(True for _ in os.scandir(folder))
    except OSError:
        return False
