import { describe, expect, it } from 'vitest';
import { detectPlatform, offerForRelease, pickAsset, type GithubRelease } from '../src/ui/updates';
import { buildLatestJson, platformKey } from '../scripts/latest-json.js';
import { versionCodeFor } from '../scripts/set-version.js';

const release: GithubRelease = {
  tag_name: 'v0.1.2',
  html_url: 'https://github.com/Specops13/nxos-evpn-sim/releases/tag/v0.1.2',
  assets: [
    { name: 'nxos-evpn-lab_0.1.2_x64-setup.exe', browser_download_url: 'https://github.com/Specops13/nxos-evpn-sim/releases/download/v0.1.2/nxos-evpn-lab_0.1.2_x64-setup.exe' },
    { name: 'nxos-evpn-lab_0.1.2_amd64.deb', browser_download_url: 'https://github.com/Specops13/nxos-evpn-sim/releases/download/v0.1.2/nxos-evpn-lab_0.1.2_amd64.deb' },
    { name: 'nxos-evpn-lab-android.apk', browser_download_url: 'https://github.com/Specops13/nxos-evpn-sim/releases/download/v0.1.2/nxos-evpn-lab-android.apk' },
    { name: 'nxos-evpn-lab-web.zip', browser_download_url: 'https://github.com/Specops13/nxos-evpn-sim/releases/download/v0.1.2/nxos-evpn-lab-web.zip' },
  ],
};

describe('update offers', () => {
  it('offers the matching installer only when the release is newer', () => {
    expect(offerForRelease('0.1.1', release, 'android')?.downloadUrl).toContain('/nxos-evpn-lab-android.apk');
    expect(offerForRelease('0.1.1', release, 'windows')?.assetName).toMatch(/\.exe$/);
    expect(offerForRelease('0.1.1', release, 'linux')?.assetName).toMatch(/\.deb$/);
    expect(offerForRelease('0.1.1', release, 'web')?.downloadUrl).toBeNull();
    expect(offerForRelease('0.1.2', release, 'android')).toBeNull();
    expect(offerForRelease('0.1.3', release, 'windows')).toBeNull();
    expect(offerForRelease('0.1.1', { ...release, tag_name: 'v0.1.0' }, 'android')).toBeNull();
    const tampered: GithubRelease = {
      ...release,
      html_url: 'https://evil.example/releases/v0.1.2',
      assets: [{ name: 'nxos-evpn-lab-android.apk', browser_download_url: 'http://evil.example/app.apk' }],
    };
    const offer = offerForRelease('0.1.1', tampered, 'android');
    expect(offer?.downloadUrl).toBeNull();
    expect(offer?.pageUrl).toBe('https://github.com/Specops13/nxos-evpn-sim/releases/latest');
  });

  it('detects the shell around the same web UI', () => {
    expect(detectPlatform('Mozilla Android', true)).toBe('android');
    expect(detectPlatform('Mozilla Android', false)).toBe('web');
    expect(detectPlatform('Windows NT', true)).toBe('windows');
    expect(detectPlatform('X11; Linux', true)).toBe('linux');
    expect(detectPlatform('Windows NT', false)).toBe('web');
    expect(pickAsset(release.assets, 'android')?.name).toBe('nxos-evpn-lab-android.apk');
  });

  it('keeps Android versionCode increasing and builds updater metadata from signatures', () => {
    expect(versionCodeFor('0.1.2')).toBeGreaterThan(versionCodeFor('0.1.1'));
    expect(versionCodeFor('0.1.1')).toBe(1001);
    expect(platformKey('nxos-evpn-lab_0.1.2_x64-setup.exe.sig')).toBe('windows-x86_64');
    expect(platformKey('nxos-evpn-lab_0.1.2_amd64.AppImage.sig')).toBe('linux-x86_64');
    expect(platformKey('nxos-evpn-lab_0.1.2_amd64.deb.sig')).toBeNull();
    const manifest = buildLatestJson({
      version: 'v0.1.2',
      notes: 'test',
      pubDate: '2026-10-30T00:00:00Z',
      repo: 'Specops13/nxos-evpn-sim',
      signatures: [
        { name: 'nxos-evpn-lab_0.1.2_x64-setup.exe', signature: 'sig-exe' },
        { name: 'nxos-evpn-lab_0.1.2_amd64.deb', signature: 'sig-deb' },
      ],
    });
    expect(manifest?.platforms['windows-x86_64']?.url).toContain('/releases/download/v0.1.2/');
    expect(manifest?.platforms['linux-x86_64']).toBeUndefined();
    expect(buildLatestJson({
      version: '0.1.2',
      notes: '',
      pubDate: '2026-10-30T00:00:00Z',
      repo: 'Specops13/nxos-evpn-sim',
      signatures: [],
    })).toBeNull();
  });
});
