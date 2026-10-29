import { readFileSync, writeFileSync } from 'node:fs';
import { parseSemver } from './next-version.js';

/** Keep package.json, the npm lockfile, tauri.conf.json, and the Cargo package version in sync. */
export function setProjectVersion(root, version) {
  if (!parseSemver(version)) throw new Error(`Refusing to write non-semver version: ${version}`);

  const pkgPath = `${root}/package.json`;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.version = version;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  const lockPath = `${root}/package-lock.json`;
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  lock.version = version;
  if (lock.packages?.['']) lock.packages[''].version = version;
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  const tauriPath = `${root}/src-tauri/tauri.conf.json`;
  const tauri = JSON.parse(readFileSync(tauriPath, 'utf8'));
  tauri.version = version;
  writeFileSync(tauriPath, `${JSON.stringify(tauri, null, 2)}\n`);

  const cargoPath = `${root}/src-tauri/Cargo.toml`;
  const cargo = readFileSync(cargoPath, 'utf8').replace(
    /(\[package\][\s\S]*?^version = ")[^"]+(")/m,
    `$1${version}$2`,
  );
  writeFileSync(cargoPath, cargo);

  const cargoLockPath = `${root}/src-tauri/Cargo.lock`;
  const cargoLock = readFileSync(cargoLockPath, 'utf8').replace(
    /(name = "nxos-evpn-sim"\nversion = ")[^"]+(")/,
    `$1${version}$2`,
  );
  writeFileSync(cargoLockPath, cargoLock);
}
