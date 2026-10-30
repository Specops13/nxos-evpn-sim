# Security

NX-OS EVPN Lab is a simulator. It is not Cisco software and it does not accept packets from a network. The risks that matter are a malicious upgrade, a malicious topology file, and a dependency vulnerability.

## Reporting

Report a vulnerability privately to the repository owner. Do not open a public issue for an unfixed security bug.

## What is checked

- `npm audit --audit-level=high` in CI. High and critical npm advisories fail the build.
- `cargo audit` 0.22.2 in CI. It fails on RustSec vulnerabilities. Unmaintained and unsound warnings in Tauri's GTK stack (`proc-macro-error`, `glib` 0.18) are reported and do not fail the build, because those crates come from the Tauri 2 Linux bindings and this project does not call the affected APIs directly.
- GitHub Actions are pinned to commit SHAs. Dependabot opens updates for npm, Cargo, and Actions.
- Release assets get SHA-256 checksums (`SHA256SUMS`) and build-provenance attestations from the job that built them.

## Content Security Policy

The desktop and Android webview use the CSP in `src-tauri/tauri.conf.json`. The static web bundle gets the same production policy from the Vite build.

`style-src 'unsafe-inline'` is required. React style attributes and xterm.js write element styles at runtime. The production policy does not allow `unsafe-eval` or remote scripts. `connect-src` allows this origin, the Tauri IPC endpoints, and `https://api.github.com` for the update check. `devCsp` additionally allows the Vite dev server on `localhost:1420`. DevTools are not enabled: the `devtools` Cargo feature is off, and the window sets `devtools` to false. Tauri only exposes the inspector in release builds when that feature is on.

`freezePrototype` is on, so the webview cannot change `Object.prototype`.

## Saved labs

Topology JSON is parsed with a reviver that rejects `__proto__`, `prototype`, and `constructor`. Documents are size-limited and checked for control characters and `<` `>` before they are stored. A document this version does not understand is left on disk. See `docs/UPGRADING.md`.

## Updates

The in-app check reads only `https://api.github.com/repos/Specops13/nxos-evpn-sim/releases/latest`. Download links are accepted only when they are `https://github.com/Specops13/nxos-evpn-sim/releases/download/vX.Y.Z/<file>`. Older versions are ignored. The app does not download an installer and run it itself.

On Windows and Linux, **Install update** uses the Tauri v2 updater plugin, which verifies a minisign signature before installing. That plugin does not support Android. The updater private key is never committed. Until `TAURI_SIGNING_PRIVATE_KEY` is set and `plugins.updater.pubkey` contains the matching public key, that button cannot install anything and the release omits `latest.json`.

## Android signing

`v0.1.1` is signed with the keystore in this repository. Anyone can sign another APK with that key, and Android will treat it as an upgrade. `docs/UPGRADING.md` describes APK Signature Scheme v3 rotation, which activates when `ANDROID_KEYSTORE_*` secrets are set, and the versions of Android where the old key remains trusted.
