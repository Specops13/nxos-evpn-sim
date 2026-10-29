/** Semver helpers for the release workflow. Tags may be "v1.2.3" or "1.2.3". */

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function parseSemver(value) {
  const match = SEMVER.exec(String(value).trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function formatSemver(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

export function compareSemver(a, b) {
  const left = typeof a === 'string' ? parseSemver(a) : a;
  const right = typeof b === 'string' ? parseSemver(b) : b;
  if (!left || !right) return 0;
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

export function bumpPatch(version) {
  const parsed = typeof version === 'string' ? parseSemver(version) : version;
  if (!parsed) throw new Error(`Not a semver version: ${version}`);
  return formatSemver({ ...parsed, patch: parsed.patch + 1 });
}

/**
 * Next release version.
 * - No existing release tags: use the version already in package.json (v0.1.0 on the first release).
 * - package.json is already ahead of the latest tag (a previous release commit landed but the
 *   GitHub Release was not created): reuse that version instead of bumping again.
 * - Otherwise bump the patch of the latest tag.
 */
export function nextReleaseVersion(packageVersion, tags) {
  const current = parseSemver(packageVersion);
  if (!current) throw new Error(`package.json version is not semver: ${packageVersion}`);
  const released = (tags ?? [])
    .map((tag) => parseSemver(tag))
    .filter(Boolean)
    .sort(compareSemver);
  if (!released.length) return formatSemver(current);
  const latest = released[released.length - 1];
  if (compareSemver(current, latest) > 0) return formatSemver(current);
  return bumpPatch(latest);
}
