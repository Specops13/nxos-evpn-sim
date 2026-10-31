# Upgrading

The package name, app id, and Android certificate are what make an install upgrade in place. Do not rename `nxos-evpn-lab`, `com.nxosevpn.lab`, or the Windows `productName`.

Saved labs use one `localStorage` key, `nxos-evpn-lab-v1`, on every edition, plus `nxos-evpn-lab-v1-backup` after a migration. A v0.1.x file is `{ "version": 1, ... }`. This version reads that file, writes the original bytes to the backup key, then stores schema 2. A file from a newer schema is not overwritten. **Export** on the Devices tab (the phone's Devices pane, and the same side pane on a wide screen) downloads `nxos-evpn-saved-labs.json`: the current lab and the backup. **Import** restores both. An older file that is only one lab still imports and does not delete the backup. Import and `localStorage` are rejected when they are too large, contain `__proto__` / `constructor` / `prototype`, or put control characters or `<` `>` in names. A refused import leaves the saved labs where they are. The app version is shown in the header. **Check for updates** compares it with `https://api.github.com/repos/Specops13/nxos-evpn-sim/releases/latest` and ignores older tags. Download links are accepted only for this repository's GitHub Release files over HTTPS. The app opens that page or asset in the browser. It does not fetch an installer and execute it.

`SHA256SUMS` on each release lists the SHA-256 of the files. The build jobs also publish GitHub build-provenance attestations.

## Windows

The NSIS installer uses `installMode: currentUser`, which is the default used for v0.1.1, and the same `productName`. Running a newer `.exe` upgrades that per-user install. It does not replace a copy that was installed for all users.

When a newer release exists, the header shows the version and a link to the `.exe` on this repository's GitHub Release, plus a link to the release page. Download that installer and run it. The same notice is used on every edition.

## Debian and AppImage

The `.deb` package name stays `nxos-evpn-lab`. A newer version installs over the old one:

```bash
sudo apt install ./nxos-evpn-lab_<version>_amd64.deb
# or
sudo dpkg -i nxos-evpn-lab_<version>_amd64.deb
```

CI installs the published v0.1.1 package and then a rebuilt package whose control file says `0.1.99`, and checks that `dpkg` reports `0.1.99` and `/usr/bin/nxos-evpn-sim` is still there.

An AppImage is attached as another way to run the Linux build. The in-app download link for Linux points at the `.deb`, which upgrades a package install in place. An apt repository on GitHub Pages is not published: it would need a signed `Packages` index, a distribution key, and a stable URL, and a stale or unsigned index is worse than `apt install ./file.deb`.

## Android

Minimum version remains API 24. `versionCode` is `major * 1000000 + minor * 1000 + patch`, so `0.1.1` is `1001`, `0.1.2` is `1002`, and `0.1.3` is `1003`. CI compares the new APK with the v0.1.1 APK and fails if the code goes backwards or the pinned certificate is missing.

The phone shows the same release check and a link to the APK. Installing that APK is Android's package installer, which accepts it when the signing certificate matches the one already installed.

Releases are signed by `src-tauri/android-signing/nxos-evpn-lab-debug.keystore`. That file is in git, and so is its password. The SHA-256 of that certificate is pinned in `src-tauri/android-signing/expected-cert-sha256.txt`:

```text
af59f0f6b7d05b0e1c9e3506e6ddbae5a1013fc6d13dbf0c2d324bcab7058f6f
```

Gradle always signs with this key, so the certificate stays the one v0.1.1 already has and upgrades install in place. No signing secret is required.

## Web

The header shows the version. A newer GitHub release shows a notice and a link to the release page. The static files update when you deploy a new `nxos-evpn-lab-web.zip`. The browser keeps the saved lab and runs the same migration.
