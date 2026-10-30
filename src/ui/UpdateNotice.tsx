import { useCallback, useEffect, useState } from 'react';
import { APP_VERSION } from './version';
import { detectPlatform, fetchUpdateOffer, type UpdateOffer, type UpdatePlatform } from './updates';

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function installWithUpdater(): Promise<'installed' | 'none' | 'unavailable'> {
  try {
    const updater = await import('@tauri-apps/plugin-updater');
    const process = await import('@tauri-apps/plugin-process');
    const update = await updater.check();
    if (!update) return 'none';
    await update.downloadAndInstall();
    await process.relaunch();
    return 'installed';
  } catch {
    return 'unavailable';
  }
}

export function useUpdateCheck() {
  const [offer, setOffer] = useState<UpdateOffer | null>(null);
  const [message, setMessage] = useState('');
  const [platform, setPlatform] = useState<UpdatePlatform>('web');

  const check = useCallback(async (manual: boolean) => {
    const kind = detectPlatform(navigator.userAgent, inTauri());
    setPlatform(kind);
    try {
      const next = await fetchUpdateOffer(APP_VERSION, kind);
      setOffer(next);
      if (manual) {
        setMessage(next ? `Version ${next.latest} is available.` : 'This is the newest published release.');
      } else if (!next) {
        setMessage('');
      }
    } catch (err) {
      if (manual) setMessage(err instanceof Error ? err.message : 'Could not reach GitHub releases.');
    }
  }, []);

  const install = useCallback(async () => {
    setMessage('Downloading the update…');
    const result = await installWithUpdater();
    if (result === 'unavailable') {
      setMessage('The signed updater is not available. Download the package from the release instead.');
    } else if (result === 'none') {
      setMessage('This is the newest signed update.');
    }
  }, []);

  useEffect(() => {
    void check(false);
  }, [check]);

  return { offer, message, platform, check, install };
}

export function UpdateBar({ updates }: { updates: ReturnType<typeof useUpdateCheck> }) {
  const { offer, message, install } = updates;
  if (!offer && !message) return null;
  return (
    <div className="update-notice" data-testid="update-notice">
      {offer ? (
        <>
          <span>v{offer.latest} is available.</span>
          {offer.downloadUrl && (
            <a href={offer.downloadUrl} target="_blank" rel="noreferrer">
              Download {offer.assetName ?? 'release'}
            </a>
          )}
          <a href={offer.pageUrl} target="_blank" rel="noreferrer">Release notes</a>
          {(offer.platform === 'windows' || offer.platform === 'linux') && (
            <button type="button" onClick={() => { void install(); }}>Install update</button>
          )}
        </>
      ) : (
        <span>{message}</span>
      )}
      {offer && message && <span>{message}</span>}
    </div>
  );
}
