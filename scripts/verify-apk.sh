#!/usr/bin/env bash
# Confirm a release APK is signed with the pinned lab certificate and that
# its versionCode did not go backwards.
#
# Usage: verify-apk.sh NEW.apk [PREVIOUS.apk]
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
new_apk="${1:?path to the new apk}"
previous_apk="${2:-}"
pin_file="$root/src-tauri/android-signing/expected-cert-sha256.txt"
expected="$(tr -d '[:space:]' < "$pin_file" | tr 'A-F' 'a-f' | tr -d ':')"
if [ -z "$expected" ]; then
  echo "Pinned certificate fingerprint is empty ($pin_file)" >&2
  exit 1
fi

signer="$(find "${ANDROID_HOME:?ANDROID_HOME is required}/build-tools" -type f -name apksigner | sort | tail -n 1)"
aapt="$(find "$ANDROID_HOME/build-tools" -type f -name aapt | sort | tail -n 1)"
if [ -z "$signer" ] || [ -z "$aapt" ]; then
  echo "apksigner or aapt was not found under $ANDROID_HOME/build-tools" >&2
  exit 1
fi

certs_of() {
  "$signer" verify --min-sdk-version 24 --print-certs "$1" \
    | sed -n 's/.*SHA-256 digest: //p' \
    | tr -d '[:space:]:' \
    | tr 'A-F' 'a-f'
}

code_of() {
  "$aapt" dump badging "$1" | sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p" | head -n 1
}

sdk_of() {
  "$aapt" dump badging "$1" | sed -n "s/.*sdkVersion:'\([0-9]*\)'.*/\1/p" | head -n 1
}

new_certs="$(certs_of "$new_apk")"
if ! printf '%s\n' "$new_certs" | grep -qx "$expected"; then
  echo "Android signing certificate changed." >&2
  echo "  pinned $expected" >&2
  echo "  actual:" >&2
  printf '%s\n' "$new_certs" >&2
  echo "Refusing to publish an APK that cannot upgrade v0.1.1 in place." >&2
  echo "The release APK must stay signed with the committed lab certificate." >&2
  exit 1
fi

new_code="$(code_of "$new_apk")"
min_sdk="$(sdk_of "$new_apk")"
if [ -z "$new_code" ] || [ "$new_code" -lt 1001 ]; then
  echo "versionCode ${new_code:-missing} is below v0.1.1 (1001)" >&2
  exit 1
fi
if [ "$min_sdk" != "24" ]; then
  echo "minSdk is ${min_sdk:-missing}, expected 24" >&2
  exit 1
fi

if [ -n "$previous_apk" ]; then
  prev_certs="$(certs_of "$previous_apk")"
  prev_code="$(code_of "$previous_apk")"
  while IFS= read -r prev; do
    [ -n "$prev" ] || continue
    if ! printf '%s\n' "$new_certs" | grep -qx "$prev"; then
      echo "New APK dropped a certificate from $previous_apk ($prev)" >&2
      exit 1
    fi
  done <<< "$prev_certs"
  if [ "$new_code" -lt "$prev_code" ]; then
    echo "versionCode went from $prev_code to $new_code" >&2
    exit 1
  fi
  echo "Certificate matches the previous APK. versionCode $prev_code -> $new_code."
fi

echo "APK certificate matches the pinned lab key. versionCode $new_code, minSdk $min_sdk."
