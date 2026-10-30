import { describe, expect, it } from 'vitest';
import { keystoreProperties, patchReleaseSigning } from '../scripts/android-gradle.js';

const TEMPLATE = `import java.util.Properties

android {
    defaultConfig {
        minSdk = 24
    }
    buildTypes {
        getByName("debug") {
            isDebuggable = true
        }
        getByName("release") {
            isMinifyEnabled = true
        }
    }
}
`;

describe('android release signing', () => {
  it('writes a properties file Gradle can load', () => {
    const text = keystoreProperties({
      keyAlias: 'nxos-evpn-lab',
      password: 'store',
      keyPassword: 'key',
      storeFile: 'nxos-release.keystore',
    });
    expect(text).toContain('keyAlias=nxos-evpn-lab');
    expect(text).toContain('password=store');
    expect(text).toContain('keyPassword=key');
    expect(text).toContain('storeFile=nxos-release.keystore');
    expect(keystoreProperties({
      keyAlias: 'a',
      password: 'line\nbreak',
      keyPassword: 'slash\\x',
      storeFile: 'k',
    })).toContain('password=line\\nbreak');
  });

  it('inserts the release signing config and leaves a second run unchanged', () => {
    const once = patchReleaseSigning(TEMPLATE);
    expect(once).toContain('import java.io.FileInputStream');
    expect(once).toContain('signingConfigs');
    expect(once).toContain('rootProject.file("keystore.properties")');
    expect(once).toContain('signingConfig = signingConfigs.getByName("release")');
    expect(once.indexOf('signingConfigs')).toBeLessThan(once.indexOf('buildTypes'));
    const releaseAt = once.indexOf('getByName("release")');
    const signingAt = once.indexOf('signingConfig = signingConfigs.getByName("release")');
    expect(signingAt).toBeGreaterThan(releaseAt);
    expect(patchReleaseSigning(once)).toBe(once);
  });
});
