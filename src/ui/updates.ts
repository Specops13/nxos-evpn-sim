import { compareSemver } from '../../scripts/next-version.js';

export const RELEASES_API = 'https://api.github.com/repos/Specops13/nxos-evpn-sim/releases/latest';
export const RELEASES_PAGE = 'https://github.com/Specops13/nxos-evpn-sim/releases/latest';
const MAX_RELEASE_BYTES = 1_048_576;
const ASSET_URL = /^https:\/\/github\.com\/Specops13\/nxos-evpn-sim\/releases\/download\/v\d+\.\d+\.\d+\/[A-Za-z0-9._+-]+$/;
const PAGE_URL = /^https:\/\/github\.com\/Specops13\/nxos-evpn-sim\/releases(?:\/|$)/;

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface GithubRelease {
  tag_name: string;
  html_url?: string;
  assets?: ReleaseAsset[];
}

export type UpdatePlatform = 'windows' | 'linux' | 'android' | 'web';

export interface UpdateOffer {
  latest: string;
  pageUrl: string;
  downloadUrl: string | null;
  assetName: string | null;
  platform: UpdatePlatform;
}

export function detectPlatform(userAgent: string, inTauri: boolean): UpdatePlatform {
  if (/android/i.test(userAgent)) return inTauri ? 'android' : 'web';
  if (!inTauri) return 'web';
  if (/windows/i.test(userAgent)) return 'windows';
  return 'linux';
}

export function trustedDownloadUrl(url: string, assetName: string): string | null {
  if (assetName.includes('/') || assetName.includes('..') || assetName.includes('\\')) return null;
  if (!ASSET_URL.test(url) || !url.endsWith(`/${assetName}`)) return null;
  return url;
}

export function pickAsset(assets: ReleaseAsset[] | undefined, platform: UpdatePlatform): ReleaseAsset | null {
  const list = assets ?? [];
  const match = platform === 'windows'
    ? list.find((asset) => /\.exe$/i.test(asset.name))
    : platform === 'android'
      ? list.find((asset) => /\.apk$/i.test(asset.name))
      : platform === 'linux'
        ? list.find((asset) => /\.deb$/i.test(asset.name))
        : undefined;
  if (!match) return null;
  const url = trustedDownloadUrl(match.browser_download_url, match.name);
  if (!url) return null;
  return { name: match.name, browser_download_url: url };
}

/** A newer GitHub release, or null when this build is current or the tag is not semver. */
export function offerForRelease(current: string, release: GithubRelease, platform: UpdatePlatform): UpdateOffer | null {
  const latest = String(release.tag_name ?? '').replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(latest) || compareSemver(latest, current) <= 0) return null;
  const asset = pickAsset(release.assets, platform);
  const page = release.html_url && PAGE_URL.test(release.html_url) ? release.html_url : RELEASES_PAGE;
  return {
    latest,
    pageUrl: page,
    downloadUrl: asset?.browser_download_url ?? null,
    assetName: asset?.name ?? null,
    platform,
  };
}

export async function fetchUpdateOffer(
  current: string,
  platform: UpdatePlatform,
  fetchImpl: typeof fetch = fetch,
): Promise<UpdateOffer | null> {
  const response = await fetchImpl(RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`GitHub releases returned ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_RELEASE_BYTES) throw new Error('Release response is too large');
  const body = JSON.parse(text) as GithubRelease;
  if (!body || typeof body.tag_name !== 'string' || (body.assets !== undefined && !Array.isArray(body.assets))) {
    throw new Error('Release response is not a GitHub release');
  }
  return offerForRelease(current, body, platform);
}
