#!/usr/bin/env bash
# When ANDROID_KEYSTORE_* secrets are set, add an APK Signature Scheme v3
# rotation from the pinned lab key to that private key.
#
# v2 stays the pinned key, which is what Android 7 and 8 verify, so a v0.1.1
# install can still upgrade. Android 9 and newer (rotation-min-sdk-version 28)
# record the new key. --set-rollback false tells those versions not to accept
# a later package signed only by the old key. Android 7 and 8 ignore that flag.
#
# This does nothing when the secrets are unset. The published lab key then
# remains the only signer, which is the v0.1.1 situation.
set -euo pipefail
apk="${1:?apk path}"
if [ -z "${ANDROID_KEYSTORE_BASE64:-}" ]; then
  echo "ANDROID_KEYSTORE_* is unset. The APK stays signed only by the pinned lab key."
  exit 0
fi
root="$(cd "$(dirname "$0")/.." && pwd)"
alias="${ANDROID_KEY_ALIAS:?ANDROID_KEY_ALIAS is required when ANDROID_KEYSTORE_BASE64 is set}"
: "${ANDROID_KEYSTORE_PASSWORD:?ANDROID_KEYSTORE_PASSWORD is required}"
old="$root/src-tauri/android-signing/nxos-evpn-lab-debug.keystore"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 -d > "$work/new.keystore"
export LAB_KEY_PASS="nxos-evpn-lab"
export NEW_STORE_PASS="$ANDROID_KEYSTORE_PASSWORD"
export NEW_KEY_PASS="${ANDROID_KEY_PASSWORD:-$ANDROID_KEYSTORE_PASSWORD}"
signer="$(find "${ANDROID_HOME:?}/build-tools" -type f -name apksigner | sort | tail -n 1)"
"$signer" rotate --out "$work/lineage" \
  --old-signer --ks "$old" --ks-key-alias nxos-evpn-lab \
    --ks-pass env:LAB_KEY_PASS --key-pass env:LAB_KEY_PASS \
    --set-installed-data true --set-shared-uid true --set-permission true \
    --set-rollback false --set-auth true \
  --new-signer --ks "$work/new.keystore" --ks-key-alias "$alias" \
    --ks-pass env:NEW_STORE_PASS --key-pass env:NEW_KEY_PASS
cp "$apk" "$work/before-rotation.apk"
"$signer" sign \
  --rotation-min-sdk-version 28 \
  --v1-signing-enabled false \
  --v2-signing-enabled true \
  --v3-signing-enabled true \
  --lineage "$work/lineage" \
  --ks "$old" --ks-key-alias nxos-evpn-lab \
    --ks-pass env:LAB_KEY_PASS --key-pass env:LAB_KEY_PASS \
  --next-signer \
  --ks "$work/new.keystore" --ks-key-alias "$alias" \
    --ks-pass env:NEW_STORE_PASS --key-pass env:NEW_KEY_PASS \
  "$apk"
pin="$(tr -d '[:space:]' < "$root/src-tauri/android-signing/expected-cert-sha256.txt" | tr 'A-F' 'a-f')"
sdk24="$("$signer" verify --min-sdk-version 24 --print-certs "$apk" | sed -n 's/.*SHA-256 digest: //p' | tr -d '[:space:]:' | tr 'A-F' 'a-f' | head -n 1)"
if [ "$sdk24" != "$pin" ]; then
  cp "$work/before-rotation.apk" "$apk"
  echo "v3 rotation was not applied." >&2
  echo "apksigner (build-tools 36) reports the rotated certificate at API 24 as well as on newer versions." >&2
  echo "Publishing that APK would make a v0.1.1 install refuse the upgrade." >&2
  echo "The APK was restored to the pinned lab key. ANDROID_KEYSTORE_* was not used." >&2
  echo "Keeping the published key preserves in-place upgrades and leaves that key able to sign updates." >&2
  echo "Signing only with the new key would require uninstalling the current app. That choice is not made here." >&2
  exit 1
fi
echo "Added a v3 signing-certificate rotation. API 24 still verifies the pinned lab key."
