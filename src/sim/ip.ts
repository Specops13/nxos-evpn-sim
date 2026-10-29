/** IPv4 helpers. Addresses are dotted decimal; prefixes are CIDR strings "A.B.C.D/len". */

export function ipToInt(ip: string): number {
  const p = ip.split('.');
  if (p.length !== 4) return NaN;
  let n = 0;
  for (const oct of p) {
    if (!/^\d{1,3}$/.test(oct)) return NaN;
    const v = Number(oct);
    if (v > 255) return NaN;
    n = (n << 8) + v;
  }
  return n >>> 0;
}

export function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export function isIp(s: string): boolean {
  return Number.isFinite(ipToInt(s));
}

export function parseCidr(cidr: string): { ip: string; prefix: number; network: number; mask: number } | null {
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(cidr.trim());
  if (!m) return null;
  const ip = m[1];
  const prefix = Number(m[2]);
  if (!isIp(ip) || prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ipToInt(ip) & mask) >>> 0;
  return { ip, prefix, network, mask };
}

export function networkOf(ip: string, prefix: number): string {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return `${intToIp((ipToInt(ip) & mask) >>> 0)}/${prefix}`;
}

export function inSubnet(ip: string, cidr: string): boolean {
  const c = parseCidr(cidr);
  if (!c || !isIp(ip)) return false;
  return ((ipToInt(ip) & c.mask) >>> 0) === c.network;
}

export function sameSubnet(aIp: string, aPref: number, bIp: string, bPref: number): boolean {
  if (aPref !== bPref) return false;
  return networkOf(aIp, aPref) === networkOf(bIp, bPref);
}

/** Longest-prefix match. Returns the winning route or null. */
export function longest<T extends { prefix: string }>(routes: T[], ip: string): T | null {
  if (!isIp(ip)) return null;
  let best: T | null = null;
  let bestLen = -1;
  for (const r of routes) {
    const c = parseCidr(r.prefix);
    if (!c) continue;
    if (((ipToInt(ip) & c.mask) >>> 0) === c.network && c.prefix > bestLen) {
      best = r;
      bestLen = c.prefix;
    }
  }
  return best;
}

export function formatUptime(seconds: number): string {
  let s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  s %= 86400;
  const h = Math.floor(s / 3600);
  s %= 3600;
  const m = Math.floor(s / 60);
  s %= 60;
  if (d > 0) return `${d}d${String(h).padStart(2, '0')}h`;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function normalizeMac(input: string): string | null {
  const hex = input.trim().toLowerCase().replace(/[:.-]/g, '');
  if (!/^[0-9a-f]{12}$/.test(hex)) return null;
  return `${hex.slice(0, 4)}.${hex.slice(4, 8)}.${hex.slice(8, 12)}`;
}

/** 10-octet ESI displayed as five dotted hex groups (Cisco style). */
export function normalizeEsi(input: string): string | null {
  const hex = input.trim().toLowerCase().replace(/[:.]/g, '');
  if (!/^[0-9a-f]{20}$/.test(hex)) return null;
  const parts = hex.match(/.{4}/g);
  return parts ? parts.join('.') : null;
}

export function cmpIp(a: string, b: string): number {
  return ipToInt(a) - ipToInt(b);
}
