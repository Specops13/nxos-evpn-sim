#!/usr/bin/env bash
# Point Gradle at the private release keystore.
#
# Gradle does not read TAURI_ANDROID_SIGNING_* variables. Release signing uses
# src-tauri/gen/android/keystore.properties plus a signingConfig in
# app/build.gradle.kts (https://v2.tauri.app/distribute/sign/android/).
# That project is generated into gitignored gen/, so this script runs after
# `tauri android init` and before `tauri android build`.
#
# There is no keystore in git. Release publishing sets ANDROID_SIGNING_REQUIRED=1
# and fails when the secrets are missing. Pull-request CI leaves that unset:
# with no secrets it skips signing so the job can build a debug APK.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"

if [ -e "$root/src-tauri/android-signing/nxos-evpn-lab-debug.keystore" ] \
  || [ -e "$root/src-tauri/android-signing/expected-cert-sha256.txt" ]; then
  echo "Refusing to sign: a keystore or certificate pin is still committed under src-tauri/android-signing/." >&2
  echo "Release signing uses only ANDROID_KEYSTORE_* secrets." >&2
  exit 1
fi

have_b64=0
have_pass=0
have_alias=0
[ -n "${ANDROID_KEYSTORE_BASE64:-}" ] && have_b64=1
[ -n "${ANDROID_KEYSTORE_PASSWORD:-}" ] && have_pass=1
[ -n "${ANDROID_KEY_ALIAS:-}" ] && have_alias=1
count=$((have_b64 + have_pass + have_alias))

write_output() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "$1" >> "$GITHUB_OUTPUT"
  fi
}

if [ "$count" -eq 0 ]; then
  if [ "${ANDROID_SIGNING_REQUIRED:-}" = "1" ]; then
    echo "Release signing requires ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, and ANDROID_KEY_ALIAS." >&2
    echo "No keystore is committed, and this build will not fall back to another key." >&2
    exit 1
  fi
  echo "ANDROID_KEYSTORE_* is not set. Skipping release signing so CI can build a debug APK."
  write_output "signed=false"
  exit 0
fi

if [ "$count" -ne 3 ]; then
  echo "Set ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, and ANDROID_KEY_ALIAS together." >&2
  echo "A partial set is not a signing key, and there is no committed keystore to fall back to." >&2
  exit 1
fi

alias="$ANDROID_KEY_ALIAS"
store_pass="$ANDROID_KEYSTORE_PASSWORD"
key_pass="${ANDROID_KEY_PASSWORD:-$ANDROID_KEYSTORE_PASSWORD}"
out="${ANDROID_KEYSTORE_OUT:-$root/src-tauri/android-signing/active.keystore}"
mkdir -p "$(dirname "$out")"
printf '%s' "$ANDROID_KEYSTORE_BASE64" | tr -d '[:space:]' | base64 -d > "$out"
if [ ! -s "$out" ]; then
  echo "ANDROID_KEYSTORE_BASE64 decoded to an empty file." >&2
  rm -f "$out"
  exit 1
fi

gradle="$root/src-tauri/gen/android/app/build.gradle.kts"
if [ ! -f "$gradle" ]; then
  echo "app/build.gradle.kts does not exist yet. Run tauri android init before scripts/android-signing.sh." >&2
  exit 1
fi

if ! keytool -list -keystore "$out" -storepass "$store_pass" -alias "$alias" >/dev/null; then
  echo "The keystore does not open with ANDROID_KEY_ALIAS and ANDROID_KEYSTORE_PASSWORD." >&2
  rm -f "$out"
  exit 1
fi

cp "$out" "$root/src-tauri/gen/android/app/nxos-release.keystore"
props="$root/src-tauri/gen/android/keystore.properties"
cd "$root"
KEY_ALIAS="$alias" STORE_PASS="$store_pass" KEY_PASS="$key_pass" \
  PROPS_PATH="$props" GRADLE_PATH="$gradle" \
  node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
import { keystoreProperties, patchReleaseSigning } from "./scripts/android-gradle.js";
writeFileSync(process.env.PROPS_PATH, keystoreProperties({
  keyAlias: process.env.KEY_ALIAS,
  password: process.env.STORE_PASS,
  keyPassword: process.env.KEY_PASS,
  storeFile: "nxos-release.keystore",
}));
const gradlePath = process.env.GRADLE_PATH;
writeFileSync(gradlePath, patchReleaseSigning(readFileSync(gradlePath, "utf8")));
'
echo "Release signing is configured for alias ${alias}."
write_output "signed=true"
