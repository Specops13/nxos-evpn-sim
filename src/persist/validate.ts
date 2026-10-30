const ROLES = new Set(['super-spine', 'spine', 'leaf', 'border-gateway', 'host']);
const MAX_BYTES = 1_048_576;
const MAX_DEVICES = 64;
const MAX_LINKS = 256;
const MAX_STRING = 4_000;

const UNSAFE_KEY = new Set(['__proto__', 'prototype', 'constructor']);

/** Reject control characters and markup so names cannot escape text or the terminal. */
const UNSAFE_TEXT = /[\u0000-\u001f\u007f<>]/;

export function parseStoredJson(raw: string): unknown {
  if (raw.length > MAX_BYTES) throw new Error('Saved lab is too large');
  return JSON.parse(raw, (key, value) => {
    if (UNSAFE_KEY.has(key)) throw new Error('Saved lab contains an unsafe key');
    return value;
  });
}

export function validateLabDocument(document: Record<string, unknown>): string | null {
  const encoded = JSON.stringify(document);
  if (encoded.length > MAX_BYTES) return 'Saved lab is too large';
  if (findUnsafeKey(document)) return 'Saved lab contains an unsafe key';
  if (typeof document.name !== 'string' || document.name.length > 200 || UNSAFE_TEXT.test(document.name)) {
    return 'Lab name is invalid';
  }
  if (!Array.isArray(document.devices) || document.devices.length > MAX_DEVICES) return 'Device list is invalid';
  if (!Array.isArray(document.links) || document.links.length > MAX_LINKS) return 'Link list is invalid';
  for (const device of document.devices) {
    const problem = validateDevice(device);
    if (problem) return problem;
  }
  for (const link of document.links) {
    const problem = validateLink(link);
    if (problem) return problem;
  }
  return null;
}

function validateDevice(device: unknown): string | null {
  if (!device || typeof device !== 'object' || Array.isArray(device)) return 'Device is invalid';
  const record = device as Record<string, unknown>;
  if (!isShortId(record.id) || !isShortId(record.systemMac)) return 'Device id is invalid';
  if (typeof record.role !== 'string' || !ROLES.has(record.role)) return 'Device role is invalid';
  if (!isCoord(record.x) || !isCoord(record.y)) return 'Device position is invalid';
  if (!record.config || typeof record.config !== 'object' || Array.isArray(record.config)) return 'Device config is invalid';
  const config = record.config as Record<string, unknown>;
  if (typeof config.hostname !== 'string' || config.hostname.length > 80 || UNSAFE_TEXT.test(config.hostname)) {
    return 'Hostname is invalid';
  }
  if (JSON.stringify(config).length > 65_536) return 'Device config is too large';
  if (findUnsafeText(config)) return 'Device config contains unsafe text';
  if (record.host !== undefined) {
    if (!record.host || typeof record.host !== 'object' || Array.isArray(record.host)) return 'Host config is invalid';
    if (findUnsafeText(record.host)) return 'Host config contains unsafe text';
  }
  return null;
}

function validateLink(link: unknown): string | null {
  if (!link || typeof link !== 'object' || Array.isArray(link)) return 'Link is invalid';
  const record = link as Record<string, unknown>;
  for (const key of ['aDevice', 'bDevice', 'aIntf', 'bIntf']) {
    const value = record[key];
    if (typeof value !== 'string' || value.length > 80 || UNSAFE_TEXT.test(value)) return 'Link endpoint is invalid';
  }
  return null;
}

function isShortId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 80 && !UNSAFE_TEXT.test(value);
}

function isCoord(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= -1_000_000 && value <= 1_000_000;
}

function findUnsafeKey(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  for (const key of Object.keys(value as object)) {
    if (UNSAFE_KEY.has(key)) return true;
    if (findUnsafeKey((value as Record<string, unknown>)[key])) return true;
  }
  return false;
}

function findUnsafeText(value: unknown): boolean {
  if (typeof value === 'string') return value.length > MAX_STRING || UNSAFE_TEXT.test(value);
  if (Array.isArray(value)) return value.some((item) => findUnsafeText(item));
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((item) => findUnsafeText(item));
  }
  return false;
}
