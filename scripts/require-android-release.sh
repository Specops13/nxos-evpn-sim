#!/usr/bin/env bash
# Stop a release before it bumps the version when the private Android key
# or the certificate variable is missing. Nothing in git can sign a release.
set -euo pipefail
missing=0
for name in ANDROID_KEYSTORE_BASE64 ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_CERT_SHA256; do
  if [ -z "${!name:-}" ]; then
    echo "Missing ${name}." >&2
    missing=1
  fi
done
if [ -n "${ANDROID_CERT_SHA256:-}" ]; then
  fp="$(printf '%s' "$ANDROID_CERT_SHA256" | tr -d '[:space:]:' | tr 'A-F' 'a-f')"
  if ! printf '%s' "$fp" | grep -Eq '^[0-9a-f]{64}$'; then
    echo "ANDROID_CERT_SHA256 must be a SHA-256 fingerprint: 64 hex digits, colons optional." >&2
    missing=1
  fi
fi
if [ "$missing" -ne 0 ]; then
  echo "Refusing to release. Android signing uses ANDROID_KEYSTORE_* secrets and the ANDROID_CERT_SHA256 variable." >&2
  echo "No keystore is committed. Add them, then run the release again." >&2
  exit 1
fi
echo "Android release signing secrets and ANDROID_CERT_SHA256 are present."
