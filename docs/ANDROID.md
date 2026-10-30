# Android build

The phone UI is the same web app. Below 768px it uses a single pane and a bottom tab bar (Topology, CLI, Devices). Tauri v2 wraps that UI in an APK.

Minimum Android version is API 24 (Android 7.0). `compileSdk` and `targetSdk` are 36, the newest stable platform the GitHub runner's `sdkmanager` installs. `@tauri-apps/cli` is pinned to 2.11.5: 2.12 generates `compileSdk` 37 and Android Gradle Plugin 9.3.1, and API 37 is not a stable `platforms;android-37` package. `minSdkVersion` stays 24. This project does not publish to the Play Store.

Releases through v0.1.3 were signed by a keystore that was stored in git. That keystore is gone. Android will not install a privately signed APK over those versions. Export the saved labs, uninstall, install the new APK, then import. The steps are below and in [UPGRADING.md](UPGRADING.md).

## Release signing

A published APK is signed only with the private keystore in Actions secrets. Nothing in this repository is a signing key. If `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, or `ANDROID_KEY_ALIAS` is missing, the release workflow stops before it bumps the version. It does not sign with another key.

Pull-request CI, including CI from a fork, does not have those secrets. That job builds a debug APK and does not check the release certificate. Debug builds use the Android SDK debug keystore created on the runner. They are not release artifacts.

`scripts/android-signing.sh` runs after `tauri android init`. It decodes the secret, writes `keystore.properties`, and adds the release `signingConfig`. Gradle reads that file. The generated `gen/` tree is gitignored. `scripts/verify-apk.sh` then requires `ANDROID_CERT_SHA256` and refuses the APK when the fingerprint differs. `versionCode` is still `major * 1000000 + minor * 1000 + patch` (`scripts/set-version.js`). `0.1.0` is `1000`, `0.1.1` is `1001`, `0.1.3` is `1003`. The next release has to be greater than or equal to the previous APK.

### Generate the keystore

PKCS12 stores one password for the store and the key. Use the same value for both. Validity is 10000 days or more. RSA 4096.

Keep a copy of the `.keystore` file and the password outside this git repo: an encrypted disk or a password manager. Losing the keystore means the next key is a different certificate, and every install has to be uninstalled and reinstalled again. Export the labs before that.

Debian:

```bash
keytool -genkeypair -v -storetype PKCS12 \
  -keystore nxos-evpn-lab-release.keystore \
  -alias nxos-evpn-lab \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass 'YOUR_PASSWORD' -keypass 'YOUR_PASSWORD' \
  -dname 'CN=NX-OS EVPN Lab, OU=Lab, O=Lab, C=US'

base64 -w0 nxos-evpn-lab-release.keystore

keytool -list -v -keystore nxos-evpn-lab-release.keystore \
  -alias nxos-evpn-lab -storepass 'YOUR_PASSWORD' \
  | sed -n 's/^[[:space:]]*SHA256: //p' | tr -d ':' | tr 'A-F' 'a-f'
```

Windows PowerShell:

```powershell
keytool -genkeypair -v -storetype PKCS12 `
  -keystore nxos-evpn-lab-release.keystore `
  -alias nxos-evpn-lab `
  -keyalg RSA -keysize 4096 -validity 10000 `
  -storepass 'YOUR_PASSWORD' -keypass 'YOUR_PASSWORD' `
  -dname 'CN=NX-OS EVPN Lab, OU=Lab, O=Lab, C=US'

[Convert]::ToBase64String([IO.File]::ReadAllBytes("nxos-evpn-lab-release.keystore"))

$line = keytool -list -v -keystore nxos-evpn-lab-release.keystore -alias nxos-evpn-lab -storepass 'YOUR_PASSWORD' | Select-String -Pattern '^\s*SHA256:'
($line.ToString() -replace '.*SHA256:\s*','' -replace ':','').ToLower()
```

`base64 -w0` and `[Convert]::ToBase64String` both produce one line. That line is the secret value, not a file you commit.

### Actions secrets and the certificate variable

Repository **Settings → Secrets and variables → Actions**.

Secrets:

| Name | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | The one-line base64 of the keystore |
| `ANDROID_KEYSTORE_PASSWORD` | The PKCS12 password |
| `ANDROID_KEY_ALIAS` | `nxos-evpn-lab`, unless you chose another alias in `keytool` |
| `ANDROID_KEY_PASSWORD` | The same password. PKCS12 requires it. If this secret is empty, the workflow uses `ANDROID_KEYSTORE_PASSWORD`. |

Variable (not a secret):

| Name | Value |
| --- | --- |
| `ANDROID_CERT_SHA256` | The 64 hex digits printed above, lowercase, with no colons |

The release fails when `ANDROID_CERT_SHA256` is missing or when the APK certificate is different.

### One-time reinstall

1. Open the installed app. On a phone, open the **Devices** tab. **Export** downloads `nxos-evpn-saved-labs.json`. That file is the current lab and the backup copy. Copy it off the phone.
2. Uninstall the app. The privately signed APK is a different certificate, so Android will not upgrade v0.1.1, v0.1.2, or v0.1.3 in place.
3. Install the new APK from the GitHub release.
4. Open **Devices** and **Import** the JSON file. An older single-lab export still imports. A file this version does not understand is refused, and the labs already on the device stay in place.

## Local APK

Install JDK 17, the Android SDK, and an NDK. A local release build uses the same secrets as CI. Without them, build the debug APK.

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
export ANDROID_HOME="$HOME/Android/Sdk"
export NDK_HOME="$ANDROID_HOME/ndk/<version>"
export ANDROID_KEYSTORE_BASE64="$(base64 -w0 nxos-evpn-lab-release.keystore)"
export ANDROID_KEYSTORE_PASSWORD='YOUR_PASSWORD'
export ANDROID_KEY_ALIAS='nxos-evpn-lab'
export ANDROID_KEY_PASSWORD='YOUR_PASSWORD'
npm run tauri android init -- --ci
bash scripts/android-signing.sh
npm run tauri android build -- --apk
```

`scripts/android-signing.sh` has to run after init, because `keystore.properties` lives in the generated project. Do not commit the keystore. `src-tauri/.gitignore` ignores `android-signing/*.keystore`.

Without the four variables, skip `android-signing.sh` and run `npm run tauri android build -- --apk --debug`.

Without `--split-per-abi` the four ABIs are packed into one universal APK. The file is under `src-tauri/gen/android/app/build/outputs/apk/`.
