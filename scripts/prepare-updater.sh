#!/usr/bin/env bash
# Turn updater signatures on only when the private key is present.
# Tauri refuses to build updater artifacts without TAURI_SIGNING_PRIVATE_KEY.
# Leaving createUpdaterArtifacts false keeps the desktop packages building.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  enabled=true
  echo "TAURI_SIGNING_PRIVATE_KEY is set. Updater signatures will be created."
else
  enabled=false
  echo "::warning::TAURI_SIGNING_PRIVATE_KEY is unset. Updater signatures and latest.json are skipped. Windows and AppImage will not self-update until that secret (and TAURI_SIGNING_PRIVATE_KEY_PASSWORD, if the key has one) is set and plugins.updater.pubkey in src-tauri/tauri.conf.json is the matching public key. See docs/UPGRADING.md."
fi
node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
const path = "src-tauri/tauri.conf.json";
const tauri = JSON.parse(readFileSync(path, "utf8"));
tauri.bundle ??= {};
tauri.bundle.createUpdaterArtifacts = process.argv[1] === "true";
writeFileSync(path, `${JSON.stringify(tauri, null, 2)}\n`);
' "$enabled"
