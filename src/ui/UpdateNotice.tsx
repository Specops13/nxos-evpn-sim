import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { APP_VERSION } from './version';
import { detectPlatform, fetchUpdateOffer, type UpdateOffer } from './updates';

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function openReleaseUrl(url: string) {
  if (inTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function useUpdateCheck() {
  const [offer, setOffer] = useState<UpdateOffer | null>(null);
  const [message, setMessage] = useState('');

  const check = useCallback(async (manual: boolean) => {
    const kind = detectPlatform(navigator.userAgent, inTauri());
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

  useEffect(() => {
    void check(false);
  }, [check]);

  return { offer, message, check, openReleaseUrl };
}

export function UpdateBar({ updates }: { updates: ReturnType<typeof useUpdateCheck> }) {
  const { offer, message, openReleaseUrl } = updates;
  if (!offer && !message) return null;
  const open = (url: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (!inTauri()) return;
    event.preventDefault();
    void openReleaseUrl(url);
  };
  return (
    <div className="update-notice" data-testid="update-notice">
      {offer ? (
        <>
          <span>v{offer.latest} is available.</span>
          {offer.downloadUrl && (
            <a href={offer.downloadUrl} target="_blank" rel="noreferrer" onClick={open(offer.downloadUrl)}>
              Download {offer.assetName ?? 'release'}
            </a>
          )}
          <a href={offer.pageUrl} target="_blank" rel="noreferrer" onClick={open(offer.pageUrl)}>Release notes</a>
        </>
      ) : (
        <span>{message}</span>
      )}
      {offer && message && <span>{message}</span>}
    </div>
  );
}
