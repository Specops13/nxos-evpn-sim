/**
 * Saved-lab schema.
 *
 * v0.1.x wrote `{ version: 1, name, devices, links }` with no `schema` field.
 * Schema 2 is that same document plus `schema: 2`. Extra keys are copied
 * through so a migration does not drop fields the current build does not use.
 */
export const SCHEMA_VERSION = 2;

import { parseStoredJson, validateLabDocument } from './validate';

export const LAB_STORAGE_KEY = 'nxos-evpn-lab-v1';
export const LAB_BACKUP_KEY = 'nxos-evpn-lab-v1-backup';

export interface MigrateResult {
  document: Record<string, unknown>;
  /** Set when the document was rewritten from an older shape. */
  migratedFrom: number | null;
  /** A newer schema than this build understands. The caller must not rewrite it. */
  future: boolean;
}

export class FutureSaveError extends Error {
  constructor() {
    super('Saved lab uses a newer schema than this version understands');
    this.name = 'FutureSaveError';
  }
}

export function migrateDocument(input: unknown): MigrateResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Saved lab is not a JSON object');
  }
  const obj = input as Record<string, unknown>;
  if (typeof obj.schema === 'number') {
    if (obj.schema > SCHEMA_VERSION) {
      return { document: obj, migratedFrom: null, future: true };
    }
    if (obj.schema === SCHEMA_VERSION) {
      return { document: obj, migratedFrom: null, future: false };
    }
    return migrateLegacy(obj, obj.schema);
  }
  if (Array.isArray(obj.devices) && Array.isArray(obj.links)) {
    const from = typeof obj.version === 'number' ? obj.version : 0;
    if (from > 1) {
      return { document: obj, migratedFrom: null, future: true };
    }
    return migrateLegacy(obj, from);
  }
  throw new Error('Saved lab has no devices');
}

function migrateLegacy(obj: Record<string, unknown>, from: number): MigrateResult {
  const { version: _version, ...rest } = obj;
  return {
    document: { ...rest, schema: SCHEMA_VERSION },
    migratedFrom: from,
    future: false,
  };
}

export interface SaveSink {
  /** Persist the untouched original before the migrated copy is written. */
  backup(original: string): void;
  write(next: string): void;
}

export interface OpenResult {
  document: Record<string, unknown> | null;
  migratedFrom: number | null;
  future: boolean;
  unreadable: boolean;
}

/**
 * Read a stored lab. Older documents are backed up and then replaced.
 * Unreadable JSON and newer schemas are left in storage.
 */
export function openSavedLab(raw: string | null, sink: SaveSink | null, appVersion: string): OpenResult {
  if (!raw) return { document: null, migratedFrom: null, future: false, unreadable: false };
  let parsed: unknown;
  try {
    parsed = parseStoredJson(raw);
  } catch {
    return { document: null, migratedFrom: null, future: false, unreadable: true };
  }
  let result: MigrateResult;
  try {
    result = migrateDocument(parsed);
  } catch {
    return { document: null, migratedFrom: null, future: false, unreadable: true };
  }
  if (result.future) {
    if (validateLabDocument(result.document)) {
      return { document: null, migratedFrom: null, future: true, unreadable: false };
    }
    return { document: result.document, migratedFrom: null, future: true, unreadable: false };
  }
  if (validateLabDocument(result.document)) {
    return { document: null, migratedFrom: null, future: false, unreadable: true };
  }
  if (result.migratedFrom === null || !sink) {
    return { document: result.document, migratedFrom: null, future: false, unreadable: false };
  }
  const next = { ...result.document, savedWith: appVersion };
  sink.backup(raw);
  sink.write(JSON.stringify(next));
  return { document: next, migratedFrom: result.migratedFrom, future: false, unreadable: false };
}
