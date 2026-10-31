import { describe, expect, it } from 'vitest';
import { exampleClosIbgp } from '../src/sim/examples';
import { FutureSaveError, LAB_BACKUP_KEY, LAB_STORAGE_KEY } from '../src/persist/migrate';
import { exportSavedLabs, importSavedLabs, type LabStorage } from '../src/persist/savedLabs';

function memory(): LabStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      values.set(key, value);
    },
    remove: (key) => {
      values.delete(key);
    },
  };
}

describe('saved lab export and import', () => {
  it('round-trips the current lab and the backup', () => {
    const current = exampleClosIbgp();
    const backup = JSON.stringify({
      backedUpAt: '2026-10-30T00:00:00.000Z',
      raw: JSON.stringify({ version: 1, name: 'before', devices: [], links: [] }),
    });
    const source = memory();
    source.set(LAB_BACKUP_KEY, backup);
    const file = exportSavedLabs(source, { ...current.toJSON(), savedWith: '0.1.3' }, '0.1.3');

    const dest = memory();
    dest.set(LAB_STORAGE_KEY, 'previous-lab');
    dest.set(LAB_BACKUP_KEY, 'previous-backup');
    const loaded = importSavedLabs(file, dest, '0.1.3');
    expect(loaded.name).toBe(current.name);
    expect(loaded.devices.map((device) => device.id)).toEqual(current.devices.map((device) => device.id));
    expect(loaded.links.length).toBe(current.links.length);
    expect(loaded.device('leaf1')?.config.hostname).toBe(current.device('leaf1')?.config.hostname);
    expect(dest.get(LAB_BACKUP_KEY)).toBe(backup);
    const stored = JSON.parse(dest.get(LAB_STORAGE_KEY) ?? '{}') as { name: string; schema: number };
    expect(stored.name).toBe(current.name);
    expect(stored.schema).toBe(2);
  });

  it('imports an older single-lab file without deleting the backup', () => {
    const current = exampleClosIbgp();
    const dest = memory();
    dest.set(LAB_BACKUP_KEY, 'keep-me');
    const loaded = importSavedLabs(JSON.stringify(current.toJSON()), dest, '0.1.3');
    expect(loaded.devices.length).toBe(current.devices.length);
    expect(dest.get(LAB_BACKUP_KEY)).toBe('keep-me');
  });

  it('leaves storage unchanged when the file is refused', () => {
    const dest = memory();
    dest.set(LAB_STORAGE_KEY, 'keep-lab');
    dest.set(LAB_BACKUP_KEY, 'keep-backup');
    expect(() => importSavedLabs('{', dest, '0.1.3')).toThrow();
    expect(() =>
      importSavedLabs(
        JSON.stringify({
          kind: 'nxos-evpn-saved-labs',
          savedWith: '9',
          lab: { schema: 99, name: 'later', devices: [], links: [] },
          backup: 'would-replace',
        }),
        dest,
        '0.1.3',
      ),
    ).toThrow(FutureSaveError);
    expect(() =>
      importSavedLabs(
        '{"kind":"nxos-evpn-saved-labs","lab":{"version":1,"name":"lab","devices":[],"links":[]},"__proto__":{"admin":true}}',
        dest,
        '0.1.3',
      ),
    ).toThrow(/unsafe key/);
    expect(dest.get(LAB_STORAGE_KEY)).toBe('keep-lab');
    expect(dest.get(LAB_BACKUP_KEY)).toBe('keep-backup');
  });
});
