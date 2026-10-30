# Android build

The phone UI is the same web app. Below 768px it uses a single pane and a bottom tab bar (Topology, CLI, Devices). Tauri v2 wraps that UI in an APK.

Minimum Android version is API 24 (Android 7.0). `compileSdk` and `targetSdk` are 36, the newest stable platform the GitHub runner's `sdkmanager` installs. `@tauri-apps/cli` is pinned to 2.11.5: 2.12 generates `compileSdk` 37 and Android Gradle Plugin 9.3.1, and API 37 is not a stable `platforms;android-37` package. `minSdkVersion` stays 24. This project does not publish to the Play Store.

Upgrades, the pinned certificate, and v3 key rotation are in [UPGRADING.md](UPGRADING.md).

## Sideload signing

Release APKs are signed so Android will install them. If the repository secrets below are empty, CI signs with the committed throwaway keystore:

- file: `src-tauri/android-signing/nxos-evpn-lab-debug.keystore`
- alias: `nxos-evpn-lab`
- store password and key password: `nxos-evpn-lab`

That key is in git. Anyone can re-sign with it. Treat installs from it as a lab build, not a production identity. Android will warn that the package is from an unknown developer.

Gradle signs every APK with that committed key so an install of v0.1.1 can upgrade. A different certificate without a v3 lineage fails CI. To add a private key that Android 9 and newer can rotate to, set `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`. `scripts/android-rotate.sh` keeps the published key on the v2 signature and adds your key as the rotated v3 signer. Android 7 and 8 still trust the published key. The trade-off is in [UPGRADING.md](UPGRADING.md).

`scripts/android-signing.sh` writes `keystore.properties` for the pinned key after `tauri android init`. Gradle reads that file. The generated `gen/` tree is gitignored, so CI applies the patch on every build.

`versionCode` follows Tauri's formula `major * 1000000 + minor * 1000 + patch` and is written into `tauri.conf.json` by `scripts/set-version.js` on each release. `0.1.0` is version code `1000`.

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
