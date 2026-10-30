import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function run(script: string, env: Record<string, string>) {
  return spawnSync('bash', [script], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

const emptySecrets = {
  ANDROID_KEYSTORE_BASE64: '',
  ANDROID_KEYSTORE_PASSWORD: '',
  ANDROID_KEY_ALIAS: '',
  ANDROID_KEY_PASSWORD: '',
  ANDROID_CERT_SHA256: '',
  GITHUB_OUTPUT: '',
  GITHUB_ENV: '',
};

describe('android release signing requires secrets', () => {
  it('does not keep a committed keystore or the old certificate pin', () => {
    const signing = readFileSync('scripts/android-signing.sh', 'utf8');
    const verify = readFileSync('scripts/verify-apk.sh', 'utf8');
    const release = readFileSync('.github/workflows/release.yml', 'utf8');
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(signing).toContain('Refusing to sign');
    expect(signing).not.toContain('af59f0f6');
    expect(signing).not.toMatch(/store_pass="nxos-evpn-lab"/);
    expect(verify).not.toContain('expected-cert-sha256.txt');
    expect(verify).not.toContain('af59f0f6');
    expect(release).not.toContain('android-rotate.sh');
    expect(ci).not.toContain('android-rotate.sh');
    expect(release).toContain('ANDROID_SIGNING_REQUIRED');
    expect(release).toContain('vars.ANDROID_CERT_SHA256');
    expect(ci).toContain('--debug');
  });

  it('fails a release when the secrets are missing and builds debug CI without them', () => {
    const required = run('scripts/android-signing.sh', {
      ...emptySecrets,
      ANDROID_SIGNING_REQUIRED: '1',
    });
    expect(required.status).not.toBe(0);
    expect(required.stderr).toMatch(/ANDROID_KEYSTORE_BASE64/);
    expect(required.stderr).toMatch(/No keystore is committed/);

    const optional = run('scripts/android-signing.sh', emptySecrets);
    expect(optional.status).toBe(0);
    expect(optional.stdout).toMatch(/debug APK/);

    const partial = run('scripts/android-signing.sh', {
      ...emptySecrets,
      ANDROID_KEYSTORE_BASE64: 'aaaa',
    });
    expect(partial.status).not.toBe(0);
    expect(partial.stderr).toMatch(/together/);

    const gate = run('scripts/require-android-release.sh', emptySecrets);
    expect(gate.status).not.toBe(0);
    expect(gate.stderr).toMatch(/ANDROID_KEYSTORE_BASE64/);
    expect(gate.stderr).toMatch(/ANDROID_CERT_SHA256/);

    const badPin = run('scripts/require-android-release.sh', {
      ...emptySecrets,
      ANDROID_KEYSTORE_BASE64: 'present',
      ANDROID_KEYSTORE_PASSWORD: 'present',
      ANDROID_KEY_ALIAS: 'present',
      ANDROID_CERT_SHA256: 'abcd',
    });
    expect(badPin.status).not.toBe(0);
    expect(badPin.stderr).toMatch(/64 hex/);
  });
});
