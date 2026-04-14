/**
 * OfflineBanner — Gym-proof reliability indicator.
 *
 * Shows a non-intrusive fixed pill at the bottom of the screen in two states:
 *
 *   • OFFLINE  — device has no connectivity; session data is safe in IDB
 *   • SYNCING  — came back online; flushing the pending queue to Notion
 *
 * Mounts invisibly when online and queue is empty; unmounts itself after a
 * 3-second "Synced" confirmation flash so it never lingers.
 */

import { useEffect, useRef, useState } from 'react';
import { getSyncQueueCount, triggerBackgroundSync } from '../lib/sync';

type BannerState = 'hidden' | 'offline' | 'syncing' | 'synced';

export default function OfflineBanner() {
  const [state,        setState]        = useState<BannerState>('hidden');
  const [pendingCount, setPendingCount] = useState(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Poll queue length + listen for online/offline events ──────────────────

  useEffect(() => {
    let cancelled = false;

    async function evaluate() {
      if (cancelled) return;

      const count   = await getSyncQueueCount();
      const isOnline = navigator.onLine;

      if (!isOnline) {
        setPendingCount(count);
        setState('offline');
        return;
      }

      // Back online
      if (count > 0) {
        setState('syncing');
        setPendingCount(count);

        // Kick off the sync; re-evaluate after a short delay
        triggerBackgroundSync().then(async () => {
          if (cancelled) return;
          const remaining = await getSyncQueueCount();
          if (remaining === 0) {
            setState('synced');
            // Auto-hide after 3s
            hideTimer.current = setTimeout(() => {
              if (!cancelled) setState('hidden');
            }, 3000);
          } else {
            setPendingCount(remaining);
            setState('offline'); // still has items → treat as offline-pending
          }
        });
      } else {
        // Online + nothing pending — stay hidden (or clear after synced flash)
        if (state !== 'synced') setState('hidden');
      }
    }

    void evaluate();

    const handleOffline = () => {
      setState('offline');
      void evaluate();
    };

    const handleOnline = () => {
      void evaluate();
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online',  handleOnline);

    // Re-poll every 30 s so the count stays fresh without hammering IDB
    const interval = setInterval(() => void evaluate(), 30_000);

    return () => {
      cancelled = true;
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online',  handleOnline);
      clearInterval(interval);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === 'hidden') return null;

  // ── Appearance per state ──────────────────────────────────────────────────

  const config = {
    offline: {
      bg:    'rgba(254,178,70,0.12)',
      border: 'rgba(254,178,70,0.28)',
      dot:   '#fEB246',
      label: pendingCount > 0
        ? `No signal · ${pendingCount} session${pendingCount !== 1 ? 's' : ''} saved locally`
        : 'No signal · session data saved locally',
    },
    syncing: {
      bg:    'rgba(169,229,187,0.08)',
      border: 'rgba(169,229,187,0.22)',
      dot:   'rgba(169,229,187,0.8)',
      label: `Back online · syncing ${pendingCount} session${pendingCount !== 1 ? 's' : ''}…`,
    },
    synced: {
      bg:    'rgba(169,229,187,0.1)',
      border: 'rgba(169,229,187,0.25)',
      dot:   'var(--color-brand-primary)',
      label: 'Synced to Notion',
    },
  } as const;

  const { bg, border, dot, label } = config[state === 'hidden' ? 'offline' : state];

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-24 inset-x-0 flex justify-center z-50 pointer-events-none px-4"
    >
      <div
        className="flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold"
        style={{
          background:   bg,
          border:       `1px solid ${border}`,
          backdropFilter: 'blur(12px)',
          color:        'rgba(237,228,250,0.85)',
          boxShadow:    '0 4px 24px rgba(0,0,0,0.3)',
        }}
      >
        {/* Animated status dot */}
        <span
          className={state === 'syncing' ? 'animate-pulse' : ''}
          style={{
            display:      'inline-block',
            width:        7,
            height:       7,
            borderRadius: '50%',
            background:   dot,
            flexShrink:   0,
          }}
        />
        {label}
      </div>
    </div>
  );
}
