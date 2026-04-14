import { useState } from 'react';
import type { TimerMode } from '../engine/types';
import { useTimerStore } from '../store/timerStore';
import { useSettingsStore } from '../store/settingsStore';
import { connectNotionOAuth } from '../lib/supabase';
import SettingsDrawer from './SettingsDrawer';

const MODES: { id: TimerMode; label: string; icon: string }[] = [
  { id: 'program',   label: 'Program',   icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z' },
  { id: 'preset',    label: 'Preset',    icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z' },
  { id: 'custom',    label: 'Custom',    icon: 'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z' },
  { id: 'stopwatch', label: 'Stopwatch', icon: 'M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61l1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42C16.07 4.74 14.12 4 12 4c-4.97 0-9 4.03-9 9s4.02 9 9 9 9-4.03 9-9c0-2.12-.74-4.07-1.97-5.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z' },
];

// SVG path for gear/settings icon
const GEAR_ICON = 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z';

export default function Navigation() {
  const mode        = useTimerStore((s) => s.mode);
  const engineState = useTimerStore((s) => s.engineState);
  const setMode     = useTimerStore((s) => s.setMode);

  const locked = engineState === 'ACTIVE' || engineState === 'PAUSED';

  const isSettingsOpen = useSettingsStore((s) => s.isSettingsOpen);
  const setIsSettingsOpen = useSettingsStore((s) => s.setIsSettingsOpen);

  const handleConnectNotion = async () => {
    try {
      await connectNotionOAuth();
    } catch (err) {
      console.warn('OAuth mock or unconfigured', err);
    }
  };

  return (
    <>
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
            background:    'rgba(35, 24, 38, 0.9)',
            border:        '1px solid rgba(255,255,255,0.06)',
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
                        color:      '#120b18',
                        boxShadow:  '0 0 20px rgba(169,229,187,0.25)',
                      }
                    : {
                        color:  locked ? 'rgba(237,228,250,0.25)' : 'rgba(237,228,250,0.55)',
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

        {/* Right-side actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleConnectNotion}
            className="hidden md:flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide transition-all"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border:     '1px solid rgba(255,255,255,0.1)',
              color:      'rgba(237,228,250,0.5)',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4 4h16v16H4V4zm2 4v10h12V8H6z" />
            </svg>
            Connect Notion
          </button>

          {/* Settings gear */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            aria-label="Open settings"
            style={{
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              width:          '36px',
              height:         '36px',
              borderRadius:   '10px',
              border:         '1px solid rgba(255,255,255,0.08)',
              background:     isSettingsOpen
                ? 'rgba(169,229,187,0.1)'
                : 'rgba(255,255,255,0.04)',
              color:          isSettingsOpen
                ? 'var(--color-brand-primary)'
                : 'rgba(237,228,250,0.5)',
              cursor:         'pointer',
              transition:     'background 180ms ease, color 180ms ease, border-color 180ms ease',
              outline:        'none',
              flexShrink:     0,
            }}
            onMouseEnter={(e) => {
              if (!isSettingsOpen) {
                const b = e.currentTarget as HTMLButtonElement;
                b.style.background = 'rgba(255,255,255,0.08)';
                b.style.color      = 'var(--color-brand-text)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isSettingsOpen) {
                const b = e.currentTarget as HTMLButtonElement;
                b.style.background = 'rgba(255,255,255,0.04)';
                b.style.color      = 'rgba(237,228,250,0.5)';
              }
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
              style={{
                transition: 'transform 400ms cubic-bezier(0.34,1.56,0.64,1)',
                transform:  isSettingsOpen ? 'rotate(60deg)' : 'rotate(0deg)',
              }}
            >
              <path d={GEAR_ICON} />
            </svg>
          </button>
        </div>
      </header>

      <SettingsDrawer open={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </>
  );
}
