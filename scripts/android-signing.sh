#!/usr/bin/env bash
# Select the Android release keystore and, once `tauri android init` has
# generated the project, point Gradle at it.
#
# Gradle does not read TAURI_ANDROID_SIGNING_* variables. Release signing uses
# src-tauri/gen/android/keystore.properties plus a signingConfig in
# app/build.gradle.kts (https://v2.tauri.app/distribute/sign/android/).
# That project is generated into gitignored gen/, so this script must run
# after init and before `tauri android build`. Running it earlier only
# selects the key file.
#
# Gradle always signs with the committed lab key so the v2 certificate stays
# the one that shipped in v0.1.1. A private key in ANDROID_KEYSTORE_* is not
# applied here. scripts/android-rotate.sh adds it as a v3 rotated signer after
# the APK exists, and scripts/verify-apk.sh rejects a certificate change that
# does not still include the pinned lab certificate.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
out="${ANDROID_KEYSTORE_OUT:-$root/src-tauri/android-signing/active.keystore}"
mkdir -p "$(dirname "$out")"
cp "$root/src-tauri/android-signing/nxos-evpn-lab-debug.keystore" "$out"
alias="nxos-evpn-lab"
store_pass="nxos-evpn-lab"
key_pass="nxos-evpn-lab"
echo "Gradle will sign with the pinned lab keystore so v0.1.1 can upgrade in place."

{
  echo "TAURI_ANDROID_SIGNING_KEY_PATH=$out"
  echo "TAURI_ANDROID_SIGNING_KEY_ALIAS=$alias"
  echo "TAURI_ANDROID_SIGNING_KEY_PASSWORD=$store_pass"
  echo "TAURI_ANDROID_SIGNING_KEY_ALIAS_PASSWORD=$key_pass"
} >> "${GITHUB_ENV:-/dev/null}"

gradle="$root/src-tauri/gen/android/app/build.gradle.kts"
if [ ! -f "$gradle" ]; then
  echo "Keystore selected at $out (alias $alias). Gradle signing is applied after tauri android init."
  exit 0
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
echo "Wrote $props and the release signingConfig (alias $alias)"
