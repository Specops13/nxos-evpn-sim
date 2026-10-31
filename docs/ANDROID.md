# Android build

The phone UI is the same web app. Below 768px it uses a single pane and a bottom tab bar (Topology, CLI, Devices). Tauri v2 wraps that UI in an APK.

Minimum Android version is API 24 (Android 7.0). `compileSdk` and `targetSdk` are 36, the newest stable platform the GitHub runner's `sdkmanager` installs. `@tauri-apps/cli` is pinned to 2.11.5: 2.12 generates `compileSdk` 37 and Android Gradle Plugin 9.3.1, and API 37 is not a stable `platforms;android-37` package. `minSdkVersion` stays 24. This project does not publish to the Play Store.

Upgrades are in [UPGRADING.md](UPGRADING.md). Nothing here needs a GitHub secret or a key you generate yourself.

## Sideload signing

Release APKs are signed with the keystore committed in this repository:

- file: `src-tauri/android-signing/nxos-evpn-lab-debug.keystore`
- alias: `nxos-evpn-lab`
- store password and key password: `nxos-evpn-lab`

That key is public. Anyone can re-sign with it. That is an accepted trade-off for this personal lab tool, described in [SECURITY.md](../SECURITY.md). Android will warn that the package is from an unknown developer.

Every release APK uses this same certificate, so an install of v0.1.1 upgrades in place. CI compares the APK with the published v0.1.1 APK and fails if the certificate differs or `versionCode` goes backwards. The expected SHA-256 is in `src-tauri/android-signing/expected-cert-sha256.txt`:

```text
af59f0f6b7d05b0e1c9e3506e6ddbae5a1013fc6d13dbf0c2d324bcab7058f6f
```

`scripts/android-signing.sh` writes `keystore.properties` for that key after `tauri android init`. Gradle reads that file. The generated `gen/` tree is gitignored, so CI applies the patch on every build.

`versionCode` follows Tauri's formula `major * 1000000 + minor * 1000 + patch` and is written into `tauri.conf.json` by `scripts/set-version.js` on each release. `0.1.0` is version code `1000`, `0.1.1` is `1001`, and `0.1.3` is `1003`.

On a phone, open the **Devices** tab and use **Export** before you replace the app by hand. That downloads `nxos-evpn-saved-labs.json` (the current lab and the backup). **Import** reads it back. An in-place upgrade keeps the saved lab without that file.

## Local APK

Install JDK 17, the Android SDK, and an NDK. Then:

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
export ANDROID_HOME="$HOME/Android/Sdk"
export NDK_HOME="$ANDROID_HOME/ndk/<version>"
npm run tauri android init -- --ci
bash scripts/android-signing.sh
npm run tauri android build -- --apk
```

`scripts/android-signing.sh` has to run after init. Before init it only copies the keystore aside, because `keystore.properties` lives in the generated project.

Without `--split-per-abi` the four ABIs are packed into one universal APK. The file is under `src-tauri/gen/android/app/build/outputs/apk/`.
