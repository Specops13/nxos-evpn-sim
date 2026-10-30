import { describe, expect, it } from 'vitest';
import { exampleClosIbgp } from '../src/sim/examples';
import { Lab } from '../src/sim/lab';
import { FutureSaveError, SCHEMA_VERSION, openSavedLab } from '../src/persist/migrate';

function memorySink() {
  const writes: string[] = [];
  const backups: string[] = [];
  return {
    backups,
    writes,
    sink: {
      backup(original: string) {
        backups.push(original);
      },
      write(next: string) {
        writes.push(next);
      },
    },
  };
}

describe('saved lab migrations', () => {
  it('loads a v0.1.x save and keeps devices, links, and BGP config', () => {
    const current = exampleClosIbgp();
    const exported = current.toJSON() as { schema?: number; name: string; devices: unknown[]; links: unknown[] };
    const legacy = {
      version: 1,
      name: exported.name,
      devices: exported.devices,
      links: exported.links,
    };
    const loaded = Lab.fromJSON(legacy);
    expect(loaded.name).toBe(current.name);
    expect(loaded.devices.map((device) => device.id)).toEqual(current.devices.map((device) => device.id));
    expect(loaded.links.length).toBe(current.links.length);
    expect(loaded.device('spine1')?.config.bgp?.asn).toBe(65001);
    expect(loaded.device('leaf1')?.config.hostname).toBe(current.device('leaf1')?.config.hostname);
    const host = loaded.devices.find((device) => device.role === 'host');
    const originalHost = current.devices.find((device) => device.role === 'host');
    expect(host?.host?.ip).toBe(originalHost?.host?.ip);
  });

  it('backs up the original document before writing schema 2', () => {
    const legacy = JSON.stringify({
      version: 1,
      name: 'kept',
      extra: 'do-not-drop',
      devices: [],
      links: [],
    });
    const store = memorySink();
    const opened = openSavedLab(legacy, store.sink, '0.1.2');
    expect(opened.migratedFrom).toBe(1);
    expect(opened.future).toBe(false);
    expect(store.backups).toEqual([legacy]);
    const written = JSON.parse(store.writes[0] ?? '{}') as { schema: number; extra: string; savedWith: string; version?: number };
    expect(written.schema).toBe(SCHEMA_VERSION);
    expect(written.extra).toBe('do-not-drop');
    expect(written.savedWith).toBe('0.1.2');
    expect(written.version).toBeUndefined();
    expect(store.writes).toHaveLength(1);
  });

  it('does not rewrite a newer schema or unreadable JSON', () => {
    const future = JSON.stringify({ schema: 99, name: 'later', devices: [], links: [], token: 'keep' });
    const store = memorySink();
    const opened = openSavedLab(future, store.sink, '0.1.2');
    expect(opened.future).toBe(true);
    expect(store.backups).toEqual([]);
    expect(store.writes).toEqual([]);
    expect(() => Lab.fromJSON(JSON.parse(future))).toThrow(FutureSaveError);
    const shown = Lab.fromJSON(JSON.parse(future), { allowFuture: true });
    expect(shown.name).toBe('later');

    const broken = memorySink();
    const unreadable = openSavedLab('{', broken.sink, '0.1.2');
    expect(unreadable.unreadable).toBe(true);
    expect(broken.writes).toEqual([]);
  });

  it('rejects prototype pollution, markup in hostnames, and oversized saves without writing', () => {
    const store = memorySink();
    const polluted = '{"version":1,"name":"lab","devices":[],"links":[],"__proto__":{"admin":true}}';
    expect(openSavedLab(polluted, store.sink, '0.1.2').unreadable).toBe(true);
    expect(store.writes).toEqual([]);

    const markup = JSON.stringify({
      version: 1,
      name: 'lab',
      devices: [{
        id: 'leaf1',
        role: 'leaf',
        x: 1,
        y: 1,
        systemMac: '5000.0000.0001',
        config: { hostname: '<img src=x onerror=alert(1)>' },
      }],
      links: [],
    });
    expect(openSavedLab(markup, store.sink, '0.1.2').unreadable).toBe(true);
    expect(store.writes).toEqual([]);
    expect(openSavedLab('x'.repeat(1_048_577), store.sink, '0.1.2').unreadable).toBe(true);
  });

  it('stops the migration when the backup cannot be stored', () => {
    const legacy = JSON.stringify({ version: 1, name: 'kept', devices: [], links: [] });
    expect(() =>
      openSavedLab(
        legacy,
        {
          backup() {
            throw new Error('storage full');
          },
          write() {
            throw new Error('should not replace the original');
          },
        },
        '0.1.2',
      ),
    ).toThrow('storage full');
  });
});
