# Upgrading

The package name, app id, and Android certificate are what make an install upgrade in place. Do not rename `nxos-evpn-lab`, `com.nxosevpn.lab`, or the Windows `productName`.

Saved labs use one `localStorage` key, `nxos-evpn-lab-v1`, on every edition. A v0.1.x file is `{ "version": 1, ... }`. This version reads that file, writes the original bytes to `nxos-evpn-lab-v1-backup`, then stores schema 2. A file from a newer schema is not overwritten. Import and `localStorage` are rejected when they are too large, contain `__proto__` / `constructor` / `prototype`, or put control characters or `<` `>` in names. The app version is shown in the header. **Check for updates** compares it with `https://api.github.com/repos/Specops13/nxos-evpn-sim/releases/latest` and ignores older tags. Download links are accepted only for this repository's GitHub Release files over HTTPS. The app does not fetch an installer and execute it.

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

Minimum version remains API 24. `versionCode` is `major * 1000000 + minor * 1000 + patch`, so `0.1.1` is `1001` and `0.1.2` is `1002`. CI compares the new APK with the v0.1.1 APK and fails if the code goes backwards or the pinned certificate is missing.

The Tauri updater does not support Android. The phone shows the same release check and a link to the APK. Installing that APK is Android's package installer, which accepts it only when the signing certificate matches.

### The published key

v0.1.1 is signed by `src-tauri/android-signing/nxos-evpn-lab-debug.keystore`. That file is in git. Anyone can sign an APK that Android will install over this app. The SHA-256 of that certificate is pinned in `src-tauri/android-signing/expected-cert-sha256.txt`:

```text
af59f0f6b7d05b0e1c9e3506e6ddbae5a1013fc6d13dbf0c2d324bcab7058f6f
```

Gradle always signs with this key, so the v2 signature stays the one v0.1.1 already has.

### Rotation when you add a private key

If these Actions secrets are set, `scripts/android-rotate.sh` builds a SigningCertificateLineage with `apksigner rotate` and signs again:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 your.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | key password, if it differs from the store password |

The lineage keeps installed data (`--set-installed-data true`) and sets `--set-rollback false` on the old certificate. `--rotation-min-sdk-version 28` puts the new key in the v3 block used from Android 9. v2 is still the pinned key, which Android 7 and 8 verify.

`scripts/android-rotate.sh` runs that `apksigner` sequence when the secrets are present, then checks the certificate Android 7 (API 24) would verify. On build-tools 36.0.0 that check fails: `apksigner verify --min-sdk-version 24` reports the new certificate, and v3 cannot be appended onto the existing v2 block (`V3+ only supports a single signer and cannot be appended`). The script restores the pinned signature and fails the build instead of publishing an APK that v0.1.1 cannot upgrade to. The secrets are therefore not silently ignored and not silently substituted.

What that does and does not close:

- Android 9 and newer can upgrade v0.1.1 to the rotated APK, and `--set-rollback false` tells those versions not to accept a later APK signed only by the published key.
- Android 7 and 8 do not read v3 rotation. They keep trusting the published key. A person with the keystore in git can still upgrade those installs.
- Recent `apksigner` defaults to a v3.1 block that only Android 13 and newer use for the rotated key. This script sets the minimum to 28 so Android 9 through 12 are included. Android 7 and 8 are still outside v3.

Replacing the pinned certificate without a lineage fails the build. Shipping only the new key, with no v2 signature from the pinned key, would make current installs refuse the upgrade. That is a one-time uninstall and reinstall. This repository does not do that. Whether to drop the published key later, and accept that reinstall, is a decision for the owner.

## Web

The header shows the version. A newer GitHub release shows a notice and a link to the release page. The static files update when you deploy a new `nxos-evpn-lab-web.zip`. The browser keeps the saved lab and runs the same migration.
