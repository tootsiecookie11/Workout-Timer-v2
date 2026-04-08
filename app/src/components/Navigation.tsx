import type { TimerMode } from '../engine/types';
import { useTimerStore } from '../store/timerStore';

const MODES: { id: TimerMode; label: string; icon: string }[] = [
  { id: 'preset', label: 'Preset', icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z' },
  { id: 'custom', label: 'Custom', icon: 'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z' },
  { id: 'stopwatch', label: 'Stopwatch', icon: 'M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61l1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42C16.07 4.74 14.12 4 12 4c-4.97 0-9 4.03-9 9s4.02 9 9 9 9-4.03 9-9c0-2.12-.74-4.07-1.97-5.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z' },
];

import { connectNotionOAuth } from '../lib/supabase';

export default function Navigation() {
  const mode = useTimerStore((s) => s.mode);
  const engineState = useTimerStore((s) => s.engineState);
  const setMode = useTimerStore((s) => s.setMode);

  const locked = engineState === 'ACTIVE' || engineState === 'PAUSED';

  const handleConnectNotion = async () => {
    try {
      await connectNotionOAuth();
    } catch (err) {
      console.warn("OAuth mock or unconfigured", err);
    }
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 md:px-10">
      {/* Wordmark */}
      <span
        className="font-display text-xl font-bold tracking-tighter uppercase"
        style={{ color: 'var(--color-brand-primary)' }}
      >
        Galawgaw
      </span>

      {/* Mode tabs */}
      <nav
        className="flex items-center gap-0.5 rounded-full p-1"
        style={{
          background: 'rgba(35, 24, 38, 0.9)',
          border: '1px solid rgba(255,255,255,0.06)',
          backdropFilter: 'blur(12px)',
        }}
        aria-label="Timer mode"
      >
        {MODES.map(({ id, label, icon }) => {
          const isActive = mode === id;
          return (
            <button
              key={id}
              onClick={() => !locked && setMode(id)}
              disabled={locked && !isActive}
              aria-pressed={isActive}
              className="flex items-center gap-2 px-5 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all duration-300"
              style={
                isActive
                  ? {
                      background: 'var(--color-brand-primary)',
                      color: '#120b18',
                      boxShadow: '0 0 20px rgba(169,229,187,0.25)',
                    }
                  : {
                      color: locked ? 'rgba(237,228,250,0.25)' : 'rgba(237,228,250,0.55)',
                      cursor: locked && !isActive ? 'not-allowed' : 'pointer',
                    }
              }
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d={icon} />
              </svg>
              <span className="hidden sm:inline">{label}</span>
            </button>
          );
        })}
      </nav>

      <button 
        onClick={handleConnectNotion}
        className="hidden md:flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide transition-all"
        style={{
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)',
          color: 'var(--color-text-secondary)'
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4 4h16v16H4V4zm2 4v10h12V8H6z" />
        </svg>
        Connect Notion
      </button>
    </header>
  );
}
