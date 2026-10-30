import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nextReleaseVersion } from '../scripts/next-version.js';
import { setProjectVersion } from '../scripts/set-version.js';

describe('release version', () => {
  it('starts at the package version when nothing has been released', () => {
    expect(nextReleaseVersion('0.1.0', [])).toBe('0.1.0');
  });

  it('bumps the patch after the latest tag', () => {
    expect(nextReleaseVersion('0.1.0', ['v0.1.0', 'v0.1.2', 'v0.1.1'])).toBe('0.1.3');
  });

  it('reuses a package.json version that is already ahead of the latest tag', () => {
    expect(nextReleaseVersion('0.1.4', ['v0.1.0', 'v0.1.3'])).toBe('0.1.4');
  });

  it('writes the same version into package.json, the lockfile, tauri, and Cargo', () => {
    const root = mkdtempSync(join(tmpdir(), 'nxos-ver-'));
    mkdirSync(join(root, 'src-tauri'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'nxos-evpn-sim', version: '0.1.0' }, null, 2));
    writeFileSync(
      join(root, 'package-lock.json'),
      JSON.stringify({ name: 'nxos-evpn-sim', version: '0.1.0', packages: { '': { version: '0.1.0' } } }, null, 2),
    );
    writeFileSync(join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ version: '0.1.0', productName: 'nxos-evpn-lab' }, null, 2));
    writeFileSync(join(root, 'src-tauri/Cargo.toml'), '[package]\nname = "nxos-evpn-sim"\nversion = "0.1.0"\n\n[dependencies]\ntauri = { version = "2" }\n');
    writeFileSync(join(root, 'src-tauri/Cargo.lock'), '[[package]]\nname = "nxos-evpn-sim"\nversion = "0.1.0"\n');
    setProjectVersion(root, '0.1.3');
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version).toBe('0.1.3');
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
    expect(lock.version).toBe('0.1.3');
    expect(lock.packages[''].version).toBe('0.1.3');
    const tauri = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
    expect(tauri.version).toBe('0.1.3');
    expect(tauri.bundle.android.versionCode).toBe(1003);
    expect(readFileSync(join(root, 'src-tauri/Cargo.toml'), 'utf8')).toContain('version = "0.1.3"');
    expect(readFileSync(join(root, 'src-tauri/Cargo.toml'), 'utf8')).toContain('version = "2"');
    expect(readFileSync(join(root, 'src-tauri/Cargo.lock'), 'utf8')).toContain('version = "0.1.3"');
    rmSync(root, { recursive: true, force: true });
  });
});
