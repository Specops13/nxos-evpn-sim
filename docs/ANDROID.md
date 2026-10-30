# Android build

The phone UI is the same web app. Below 768px it uses a single pane and a bottom tab bar (Topology, CLI, Devices). Tauri v2 wraps that UI in an APK.

Minimum Android version is API 24 (Android 7.0), which is Tauri's default `minSdkVersion`. This project does not publish to the Play Store.

## Sideload signing

Release APKs are signed so Android will install them. If the repository secrets below are empty, CI signs with the committed throwaway keystore:

- file: `src-tauri/android-signing/nxos-evpn-lab-debug.keystore`
- alias: `nxos-evpn-lab`
- store password and key password: `nxos-evpn-lab`

That key is in git. Anyone can re-sign with it. Treat installs from it as a lab build, not a production identity. Android will warn that the package is from an unknown developer. Replacing the key later means uninstalling the old app before installing the new one.

To sign with your own key, add Actions secrets:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 your.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | key password (defaults to the store password) |

`scripts/android-signing.sh` selects that key. After `tauri android init` it writes `src-tauri/gen/android/keystore.properties` and adds the release `signingConfig` to `app/build.gradle.kts`. Gradle reads that file; it does not read `TAURI_ANDROID_SIGNING_*`. The generated `gen/` tree is gitignored, so CI applies the patch on every build. The release and CI workflows run the script after init and before `tauri android build`.

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
