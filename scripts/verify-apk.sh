#!/usr/bin/env bash
# Confirm a release APK is signed with the certificate named by
# ANDROID_CERT_SHA256, and that versionCode did not go backwards.
#
# ANDROID_CERT_SHA256 is a repository Actions variable (not a secret).
# Colons and surrounding whitespace are ignored. The comparison is lowercase hex.
#
# Usage: verify-apk.sh NEW.apk [PREVIOUS.apk]
set -euo pipefail
new_apk="${1:?path to the new apk}"
previous_apk="${2:-}"
expected="$(printf '%s' "${ANDROID_CERT_SHA256:-}" | tr -d '[:space:]:' | tr 'A-F' 'a-f')"
if [ -z "$expected" ]; then
  echo "ANDROID_CERT_SHA256 is unset. Refusing to accept this APK." >&2
  echo "Set the Actions variable to the SHA-256 fingerprint of the release certificate." >&2
  exit 1
fi
if ! printf '%s' "$expected" | grep -Eq '^[0-9a-f]{64}$'; then
  echo "ANDROID_CERT_SHA256 must be 64 hex characters (colons optional)." >&2
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
  echo "APK certificate does not match ANDROID_CERT_SHA256." >&2
  echo "  expected $expected" >&2
  echo "  actual:" >&2
  printf '%s\n' "$new_certs" >&2
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
  prev_code="$(code_of "$previous_apk")"
  if [ -z "$prev_code" ]; then
    echo "Could not read versionCode from $previous_apk" >&2
    exit 1
  fi
  if [ "$new_code" -lt "$prev_code" ]; then
    echo "versionCode went from $prev_code to $new_code" >&2
    exit 1
  fi
  echo "versionCode $prev_code -> $new_code."
fi

echo "APK certificate matches ANDROID_CERT_SHA256. versionCode $new_code, minSdk $min_sdk."
