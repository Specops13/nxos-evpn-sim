# Progress

Overall: **97%** — in-place upgrades and the security checks. A saved v0.1.x lab migrates without being deleted. Android stays on the committed v0.1.1 certificate. Every edition links to the GitHub Release when a newer version exists. No signing secret is required.

## Milestones

- [x] **1. Packaging** — Desktop `.exe` / `.deb` / web zip stay in the release matrix. Android is an extra job: JDK 17, Android SDK/NDK, Rust targets `aarch64-linux-android`, `armv7-linux-androideabi`, `i686-linux-android`, `x86_64-linux-android`, universal APK via `tauri android build --apk`. Signing uses the committed keystore (`docs/ANDROID.md`). `versionCode` is `major * 1000000 + minor * 1000 + patch`.
- [x] **2. Topology UI** — Wide screens keep the three-column layout. Below 768px: Topology / CLI / Devices tabs, safe-area insets, touch pan, pinch-zoom (including when a finger starts on a device card), drag, tap-to-place, long-press or Link to connect devices.
- [x] **3. NX-OS CLI** — Desktop xterm is unchanged. On a phone, a 16px command field, Send, history, Tab, `?`, and quick-command chips drive the same terminal. The active device is a dropdown.
- [x] **4. Control plane** — Unchanged.
- [x] **5. Tests** — Vitest covers canvas pan/zoom math and versionCode. Playwright (Pixel 7 and 360×740) checks overflow, tabs, tap-to-place, drag, and `show vlan`.
- [x] **6. Docs** — README and `docs/ANDROID.md`.

## Log

- 2026-10-28: NX-OS 10.x research. Control plane, CLI, and example fabrics.
- 2026-10-29: Topology UI, Tauri desktop packages, automatic releases (`v0.1.0` published).
- 2026-10-30: Phone layout and Tauri Android APK packaging.
- 2026-10-30: Android CI failed in `android-actions/setup-android` (`sdkmanager --licenses` exit 1, no SDK packages installed). CI now uses the runner SDK and accepts licenses itself. Signing runs after `tauri android init` and writes `keystore.properties` plus the release `signingConfig`, so the collected APK is signed. Pinch-zoom records pointers that start on a device.
- 2026-10-30: SDK install and signing succeeded. `tauri android build` then failed with `no library targets found` because the crate was binary-only. The crate now has a `cdylib`/`staticlib`. API 37 is not installed: `@tauri-apps/cli` is pinned to 2.11.5 so the generated project uses compileSdk/targetSdk 36 and AGP 8.11.0. minSdk stays 24.
- 2026-10-30: Upgrade path for saved labs, Debian, Android certificate pin, and the GitHub release check. npm and cargo audits run in CI.
- 2026-10-31: Dropped the Tauri updater and the optional Android key-rotation path. Updates are a link to this repo's GitHub Release. The committed Android keystore remains the signing key. Export writes the current lab and the backup.
