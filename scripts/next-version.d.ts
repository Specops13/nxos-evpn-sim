export function parseSemver(value: string): { major: number; minor: number; patch: number } | null;
export function formatSemver(version: { major: number; minor: number; patch: number }): string;
export function compareSemver(a: string | { major: number; minor: number; patch: number }, b: string | { major: number; minor: number; patch: number }): number;
export function bumpPatch(version: string): string;
export function nextReleaseVersion(packageVersion: string, tags: string[]): string;
