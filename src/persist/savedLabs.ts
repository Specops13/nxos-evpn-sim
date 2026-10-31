/**
 * One file that carries every saved lab across a reinstall.
 *
 * The app keeps the current lab in `nxos-evpn-lab-v1` and, after a migration,
 * the previous bytes in `nxos-evpn-lab-v1-backup`. Export writes both.
 * Import restores both, and leaves storage untouched when the file is refused.
 */
import { Lab } from '../sim/lab';
import { LAB_BACKUP_KEY, LAB_STORAGE_KEY } from './migrate';

export const SAVED_LABS_KIND = 'nxos-evpn-saved-labs';

/** Current lab plus its backup. Two max-size documents, plus the wrapper. */
const BUNDLE_MAX_BYTES = 1_048_576 * 2 + 8_192;

const UNSAFE_KEY = new Set(['__proto__', 'prototype', 'constructor']);

export interface LabStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export function exportSavedLabs(storage: LabStorage, current: unknown, savedWith: string): string {
  return JSON.stringify(
    {
      kind: SAVED_LABS_KIND,
      savedWith,
      lab: current,
      backup: storage.get(LAB_BACKUP_KEY),
    },
    null,
    2,
  );
}

function parseBundle(text: string): unknown {
  if (text.length > BUNDLE_MAX_BYTES) throw new Error('Saved labs file is too large');
  return JSON.parse(text, (key, value) => {
    if (UNSAFE_KEY.has(key)) throw new Error('Saved labs file contains an unsafe key');
    return value;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Load a saved-labs file or an older single-lab export.
 * Storage is written only after the lab document is accepted.
 * A single-lab export does not remove an existing backup.
 */
export function importSavedLabs(text: string, storage: LabStorage, savedWith: string): Lab {
  const parsed = parseBundle(text);
  let document: unknown;
  let restoreBackup = false;
  let backup: string | null = null;
  if (isRecord(parsed) && parsed.kind === SAVED_LABS_KIND) {
    if (!('lab' in parsed)) throw new Error('Saved labs file has no lab');
    document = parsed.lab;
    if (parsed.backup !== null && typeof parsed.backup !== 'string') {
      throw new Error('Saved labs backup is invalid');
    }
    backup = typeof parsed.backup === 'string' ? parsed.backup : null;
    if (backup !== null && backup.length > 1_048_576) throw new Error('Saved labs backup is too large');
    restoreBackup = true;
  } else {
    document = parsed;
  }
  // Validate before any write. Future schemas and bad documents throw here.
  const lab = Lab.fromJSON(document);
  if (restoreBackup) {
    if (backup === null) storage.remove(LAB_BACKUP_KEY);
    else storage.set(LAB_BACKUP_KEY, backup);
  }
  storage.set(LAB_STORAGE_KEY, JSON.stringify({ ...lab.toJSON(), savedWith }));
  return lab;
}
