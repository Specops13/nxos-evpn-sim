# Upgrading

The package name, app id, and Android certificate are what make an install upgrade in place. Do not rename `nxos-evpn-lab`, `com.nxosevpn.lab`, or the Windows `productName`. The Android certificate changed when the committed keystore was removed. Installs of v0.1.1 through v0.1.3 do not upgrade in place to a privately signed APK. Export, uninstall, install, then import. Later releases signed with the same private key upgrade in place.

Saved labs use one `localStorage` key, `nxos-evpn-lab-v1`, on every edition, plus `nxos-evpn-lab-v1-backup` after a migration. A v0.1.x file is `{ "version": 1, ... }`. This version reads that file, writes the original bytes to the backup key, then stores schema 2. A file from a newer schema is not overwritten. **Export** on the Devices tab (the phone's Devices pane, and the same side pane on a wide screen) downloads `nxos-evpn-saved-labs.json`: the current lab and the backup. **Import** restores both. An older file that is only one lab still imports and does not delete the backup. Import and `localStorage` are rejected when they are too large, contain `__proto__` / `constructor` / `prototype`, or put control characters or `<` `>` in names. A refused import leaves the saved labs where they are. The app version is shown in the header. **Check for updates** compares it with `https://api.github.com/repos/Specops13/nxos-evpn-sim/releases/latest` and ignores older tags. Download links are accepted only for this repository's GitHub Release files over HTTPS. The app does not fetch an installer and execute it.

`SHA256SUMS` on each release lists the SHA-256 of the files. The build jobs also publish GitHub build-provenance attestations.

## Windows

The NSIS installer uses `installMode: currentUser`, which is the default used for v0.1.1, and the same `productName`. Running a newer `.exe` upgrades that per-user install. It does not replace a copy that was installed for all users.

**Install update** calls the Tauri updater plugin (`tauri-plugin-updater`). The [plugin support table](https://v2.tauri.app/plugin/updater/) is Windows, Linux, and macOS. It verifies the minisign signature inside `latest.json` before it installs. Windows uses `installMode: passive`. The updater cannot be turned off and still install: Tauri requires the signature.

`createUpdaterArtifacts` stays false unless `TAURI_SIGNING_PRIVATE_KEY` is set, because the bundler stops when that variable is missing. The build then warns and ships the `.exe` without `latest.json`.

To turn self-update on:

```bash
npm run tauri signer generate -- -w "$HOME/nxos-evpn-lab.key"
```

The command prints a public key and writes a private key. Put the public key in `src-tauri/tauri.conf.json` at `plugins.updater.pubkey`. In the repository settings, **Secrets and variables → Actions**, add:

| Secret | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | The contents of the private key file, or its path on a self-hosted runner. Never commit this file. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password chosen for the key. Omit the secret only when the key has no password. |

Dependabot does not auto-merge. `@tauri-apps/cli` is ignored so it stays on 2.11.5.

The public key in the app and the private key in Actions have to be a pair. The first release that contains the public key cannot update itself from an older build that has no key. The following signed release can. This agent cannot store Actions secrets.

## Debian and AppImage

The `.deb` package name stays `nxos-evpn-lab`. A newer version installs over the old one:

```bash
sudo apt install ./nxos-evpn-lab_<version>_amd64.deb
# or
sudo dpkg -i nxos-evpn-lab_<version>_amd64.deb
```

CI installs the published v0.1.1 package and then a rebuilt package whose control file says `0.1.99`, and checks that `dpkg` reports `0.1.99` and `/usr/bin/nxos-evpn-sim` is still there.

An AppImage is attached for people who want the Tauri updater on Linux. `latest.json` points `linux-x86_64` at the AppImage, not the `.deb`. A `.deb` install should use the download link. An apt repository on GitHub Pages is not published: it would need a signed `Packages` index, a distribution key, and a stable URL, and a stale or unsigned index is worse than `apt install ./file.deb`.

## Android

Minimum version remains API 24. `versionCode` is `major * 1000000 + minor * 1000 + patch`, so `0.1.1` is `1001`, `0.1.2` is `1002`, and `0.1.3` is `1003`. The release compares the new APK with the previous published APK and fails if the code goes backwards. It also fails if `ANDROID_CERT_SHA256` is unset or the APK certificate does not match that variable.

The Tauri updater does not support Android. The phone shows the same release check and a link to the APK. After the private key is in use, Android's package installer accepts an upgrade only when the signing certificate is that same key.

### One-time uninstall

Releases through v0.1.3 used a keystore that was committed in git. That file is no longer in the tree. A new private key cannot upgrade those installs. Before uninstalling:

1. Open the app. On a phone, open the **Devices** tab. **Export** saves `nxos-evpn-saved-labs.json` (the current lab and the backup). Copy that file off the device. Desktop and the browser use the same **Export** button.
2. Uninstall `com.nxosevpn.lab`.
3. Install the new APK.
4. Open **Devices** and **Import** the file. The current lab and the backup are restored. If the file is refused, the labs already stored on the device are left in place.

### Private keystore

Generate the keystore yourself. Do not commit it. PKCS12 uses one password for the store and the key. RSA 4096, validity 10000 days or more.

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

Copy the keystore file and the password to an encrypted disk or a password manager that is not git. If that copy is lost, the next key is a different certificate and every phone has to uninstall and reinstall again. Export the labs first.

In **Settings → Secrets and variables → Actions**, add these secrets:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | The one-line base64 string (`base64 -w0` or the PowerShell command above) |
| `ANDROID_KEYSTORE_PASSWORD` | The PKCS12 password |
| `ANDROID_KEY_ALIAS` | The alias, `nxos-evpn-lab` in the command above |
| `ANDROID_KEY_PASSWORD` | The same password. Required by PKCS12. If the secret is empty, the workflow uses the store password. |

Add this repository variable (not a secret). The value is the 64 lowercase hex digits from the `SHA256` line, with the colons removed:

| Variable | Value |
| --- | --- |
| `ANDROID_CERT_SHA256` | SHA-256 fingerprint of the release certificate |

The release workflow runs `scripts/require-android-release.sh` before it chooses a version. Missing secrets or a missing or malformed `ANDROID_CERT_SHA256` fail that step, so no tag is pushed and no APK is signed with a different key. `scripts/verify-apk.sh` fails the Android job again if the built APK's certificate does not match the variable. Fork pull requests still compile a debug APK without these values.

## Web

The header shows the version. A newer GitHub release shows a notice and a link to the release page. The static files update when you deploy a new `nxos-evpn-lab-web.zip`. The browser keeps the saved lab and runs the same migration.
