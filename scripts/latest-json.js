/** Build the static latest.json file described by the Tauri v2 updater. */

export function platformKey(filename) {
  const base = filename.replace(/\.sig$/i, '');
  if (/\.exe$/i.test(base)) return 'windows-x86_64';
  if (/\.AppImage$/i.test(base)) return 'linux-x86_64';
  return null;
}

/**
 * @param {{ version: string, notes: string, pubDate: string, repo: string, signatures: { name: string, signature: string }[] }} input
 * `name` is the installer filename (no `.sig`). The signature is the `.sig` file contents.
 */
export function buildLatestJson(input) {
  const platforms = {};
  for (const file of input.signatures) {
    const key = platformKey(file.name);
    if (!key || !file.signature.trim()) continue;
    const version = input.version.replace(/^v/, '');
    platforms[key] = {
      signature: file.signature.trim(),
      url: `https://github.com/${input.repo}/releases/download/v${version}/${file.name}`,
    };
  }
  if (!Object.keys(platforms).length) return null;
  return {
    version: input.version.replace(/^v/, ''),
    notes: input.notes,
    pub_date: input.pubDate,
    platforms,
  };
}
