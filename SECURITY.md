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

The in-app check reads only `https://api.github.com/repos/Specops13/nxos-evpn-sim/releases/latest`. Download links are accepted only when they are `https://github.com/Specops13/nxos-evpn-sim/releases/download/vX.Y.Z/<file>`. The release page link has to stay on `https://github.com/Specops13/nxos-evpn-sim/releases`. Older versions are ignored. The desktop and Android shells can open only `https://github.com/Specops13/nxos-evpn-sim/releases/**`. The app does not download an installer and run it itself.

## Android signing

The Android signing key is public. It lives in this repository at `src-tauri/android-signing/nxos-evpn-lab-debug.keystore`, and the store password is in `scripts/android-signing.sh`. Anyone can sign another APK with that key, and Android will treat it as an upgrade of this app.

That is a known, accepted trade-off for this personal lab tool. There is no private key and nothing to configure in GitHub Actions. CI still refuses to publish an APK whose certificate SHA-256 is not the pinned value in `src-tauri/android-signing/expected-cert-sha256.txt` (`af59f0f6b7d05b0e1c9e3506e6ddbae5a1013fc6d13dbf0c2d324bcab7058f6f`), and `versionCode` cannot go backwards.
