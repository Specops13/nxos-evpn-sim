#!/usr/bin/env bash
# Select the Android release keystore for `tauri android build`.
#
# Dylan can replace the throwaway keystore by setting these repository secrets
# (Settings → Secrets and variables → Actions):
#   ANDROID_KEYSTORE_BASE64   base64 of a .jks or .keystore file
#   ANDROID_KEYSTORE_PASSWORD
#   ANDROID_KEY_ALIAS
#   ANDROID_KEY_PASSWORD
# When those are unset, CI uses the committed debug keystore in
# src-tauri/android-signing/. That key is public and is only for sideloading
# this lab. It is not a Play Store signing key.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
out="${ANDROID_KEYSTORE_OUT:-$root/src-tauri/android-signing/active.keystore}"
mkdir -p "$(dirname "$out")"
if [ -n "${ANDROID_KEYSTORE_BASE64:-}" ]; then
  printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 -d > "$out"
  alias="${ANDROID_KEY_ALIAS:?ANDROID_KEY_ALIAS is required when ANDROID_KEYSTORE_BASE64 is set}"
  store_pass="${ANDROID_KEYSTORE_PASSWORD:?ANDROID_KEYSTORE_PASSWORD is required}"
  key_pass="${ANDROID_KEY_PASSWORD:-$store_pass}"
else
  cp "$root/src-tauri/android-signing/nxos-evpn-lab-debug.keystore" "$out"
  alias="nxos-evpn-lab"
  store_pass="nxos-evpn-lab"
  key_pass="nxos-evpn-lab"
  echo "Using the committed throwaway keystore (not for production)."
fi
{
  echo "TAURI_ANDROID_SIGNING_KEY_PATH=$out"
  echo "TAURI_ANDROID_SIGNING_KEY_ALIAS=$alias"
  echo "TAURI_ANDROID_SIGNING_KEY_PASSWORD=$store_pass"
  echo "TAURI_ANDROID_SIGNING_KEY_ALIAS_PASSWORD=$key_pass"
} >> "${GITHUB_ENV:-/dev/null}"
echo "Keystore ready at $out (alias $alias)"
