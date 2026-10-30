# Progress

Overall: **95%** — phone UI and Android packaging are on this branch. The APK is produced by CI and attached by the release workflow after this pull request merges.

## Milestones

- [x] **1. Packaging** — Desktop `.exe` / `.deb` / web zip stay in the release matrix. Android is an extra job: JDK 17, Android SDK/NDK, Rust targets `aarch64-linux-android`, `armv7-linux-androideabi`, `i686-linux-android`, `x86_64-linux-android`, universal APK via `tauri android build --apk`. Signing uses repo secrets when set, otherwise the committed throwaway keystore (`docs/ANDROID.md`). `versionCode` is `major * 1000000 + minor * 1000 + patch`.
- [x] **2. Topology UI** — Wide screens keep the three-column layout. Below 768px: Topology / CLI / Devices tabs, safe-area insets, touch pan, pinch-zoom, drag, tap-to-place, long-press or Link to connect devices.
- [x] **3. NX-OS CLI** — Desktop xterm is unchanged. On a phone, a 16px command field, Send, history, Tab, `?`, and quick-command chips drive the same terminal. The active device is a dropdown.
- [x] **4. Control plane** — Unchanged.
- [x] **5. Tests** — Vitest covers canvas pan/zoom math and versionCode. Playwright (Pixel 7 and 360×740) checks overflow, tabs, tap-to-place, drag, and `show vlan`.
- [x] **6. Docs** — README and `docs/ANDROID.md`.

## Log

- 2026-10-28: NX-OS 10.x research. Control plane, CLI, and example fabrics.
- 2026-10-29: Topology UI, Tauri desktop packages, automatic releases (`v0.1.0` published).
- 2026-10-30: Phone layout and Tauri Android APK packaging.
