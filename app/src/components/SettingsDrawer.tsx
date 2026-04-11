import { useEffect, useRef } from 'react';
import {
  useSettingsStore,
  type TransitionDuration,
} from '../store/settingsStore';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  id: string;
}

function Toggle({ checked, onChange, id }: ToggleProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      id={id}
      onClick={() => onChange(!checked)}
      style={{
        position:       'relative',
        width:          '48px',
        height:         '26px',
        borderRadius:   '13px',
        border:         'none',
        cursor:         'pointer',
        flexShrink:     0,
        padding:        0,
        transition:     'background 200ms ease, box-shadow 200ms ease',
        background:     checked
          ? 'var(--color-brand-primary)'
          : 'rgba(255,255,255,0.1)',
        boxShadow:      checked
          ? '0 0 14px rgba(169,229,187,0.35)'
          : 'none',
        outline: 'none',
      }}
    >
      {/* Track ring */}
      <span
        aria-hidden
        style={{
          position:     'absolute',
          inset:        0,
          borderRadius: '13px',
          border:       `1px solid ${checked ? 'rgba(169,229,187,0.5)' : 'rgba(255,255,255,0.08)'}`,
          transition:   'border-color 200ms ease',
          pointerEvents: 'none',
        }}
      />
      {/* Thumb */}
      <span
        aria-hidden
        style={{
          position:     'absolute',
          top:          '3px',
          left:         checked ? '25px' : '3px',
          width:        '20px',
          height:       '20px',
          borderRadius: '50%',
          background:   checked ? '#120b18' : 'rgba(237,228,250,0.7)',
          transition:   'left 200ms cubic-bezier(0.34,1.56,0.64,1), background 200ms ease',
          boxShadow:    '0 1px 4px rgba(0,0,0,0.4)',
        }}
      />
    </button>
  );
}

// ─── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin:        '0 0 12px',
        fontSize:      '10px',
        fontWeight:    700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color:         'rgba(237,228,250,0.35)',
      }}
    >
      {children}
    </p>
  );
}

// ─── Toggle row ───────────────────────────────────────────────────────────────

interface ToggleRowProps {
  id:          string;
  label:       string;
  description: string;
  icon:        string;   // SVG path
  checked:     boolean;
  onChange:    (v: boolean) => void;
}

function ToggleRow({ id, label, description, icon, checked, onChange }: ToggleRowProps) {
  return (
    <label
      htmlFor={id}
      style={{
        display:       'flex',
        alignItems:    'center',
        gap:           '14px',
        padding:       '14px 16px',
        borderRadius:  '12px',
        cursor:        'pointer',
        background:    checked ? 'rgba(169,229,187,0.05)' : 'rgba(255,255,255,0.03)',
        border:        `1px solid ${checked ? 'rgba(169,229,187,0.12)' : 'rgba(255,255,255,0.05)'}`,
        transition:    'background 200ms ease, border-color 200ms ease',
        userSelect:    'none',
      }}
    >
      {/* Icon */}
      <span
        style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          width:          '36px',
          height:         '36px',
          borderRadius:   '9px',
          flexShrink:     0,
          background:     checked ? 'rgba(169,229,187,0.12)' : 'rgba(255,255,255,0.05)',
          color:          checked ? 'var(--color-brand-primary)' : 'rgba(237,228,250,0.4)',
          transition:     'background 200ms ease, color 200ms ease',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d={icon} />
        </svg>
      </span>

      {/* Text */}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display:    'block',
            fontSize:   '14px',
            fontWeight: 600,
            color:      checked ? 'var(--color-brand-text)' : 'rgba(237,228,250,0.7)',
            transition: 'color 200ms ease',
          }}
        >
          {label}
        </span>
        <span
          style={{
            display:    'block',
            fontSize:   '11px',
            marginTop:  '2px',
            color:      'rgba(237,228,250,0.35)',
            lineHeight: 1.4,
          }}
        >
          {description}
        </span>
      </span>

      <Toggle id={id} checked={checked} onChange={onChange} />
    </label>
  );
}

// ─── Transition duration segmented control ─────────────────────────────────────

const DURATION_OPTIONS: { value: TransitionDuration; label: string; sub: string }[] = [
  { value: 'short',  label: 'Quick',   sub: '0.6s' },
  { value: 'normal', label: 'Normal',  sub: '0.9s' },
  { value: 'long',   label: 'Cinematic', sub: '1.4s' },
];

function DurationPicker({
  value,
  onChange,
}: {
  value: TransitionDuration;
  onChange: (v: TransitionDuration) => void;
}) {
  return (
    <div
      style={{
        display:       'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap:           '6px',
      }}
    >
      {DURATION_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              padding:       '12px 8px',
              borderRadius:  '10px',
              border:        `1px solid ${active ? 'rgba(169,229,187,0.3)' : 'rgba(255,255,255,0.06)'}`,
              background:    active ? 'rgba(169,229,187,0.1)' : 'rgba(255,255,255,0.03)',
              cursor:        'pointer',
              transition:    'background 180ms ease, border-color 180ms ease, box-shadow 180ms ease',
              boxShadow:     active ? '0 0 12px rgba(169,229,187,0.15)' : 'none',
              textAlign:     'center',
              outline:       'none',
            }}
          >
            <span
              style={{
                display:    'block',
                fontSize:   '12px',
                fontWeight: 700,
                color:      active ? 'var(--color-brand-primary)' : 'rgba(237,228,250,0.55)',
                transition: 'color 180ms ease',
              }}
            >
              {opt.label}
            </span>
            <span
              style={{
                display:    'block',
                fontSize:   '10px',
                marginTop:  '3px',
                color:      active ? 'rgba(169,229,187,0.6)' : 'rgba(237,228,250,0.25)',
                fontWeight: 500,
              }}
            >
              {opt.sub}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Divider ──────────────────────────────────────────────────────────────────

function Divider() {
  return (
    <hr
      style={{
        border:    'none',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        margin:    '24px 0',
      }}
    />
  );
}

// ─── SVG icon paths ───────────────────────────────────────────────────────────

const ICONS = {
  voice:    'M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3zm-1 16.93A8.001 8.001 0 0 1 4.07 11h2.02A5.999 5.999 0 0 0 18 11h2.02A8.001 8.001 0 0 1 13 18.93V21h-2v-2.07z',
  beeps:    'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z',
  haptics:  'M13.5 1.5C13.5.67 12.83 0 12 0s-1.5.67-1.5 1.5v4.25L8.5 3.25c-.59-.59-1.54-.59-2.12 0-.59.59-.59 1.54 0 2.12l5.24 5.24c.29.29.67.44 1.06.44h4.5c.83 0 1.5-.67 1.5-1.5v-3c0-.83-.67-1.5-1.5-1.5h-1.5V3.75c0-.83-.67-1.5-1.5-1.5H13.5V1.5zm-7 15v4c0 .83.67 1.5 1.5 1.5h6c.83 0 1.5-.67 1.5-1.5v-3c0-.83-.67-1.5-1.5-1.5h-1.5v-1.75c0-.83-.67-1.5-1.5-1.5-.83 0-1.5.67-1.5 1.5V15h-.5c-.83 0-1.5.67-1.5 1.5z',
};

// ─── Main Drawer ──────────────────────────────────────────────────────────────

export default function SettingsDrawer({ open, onClose }: Props) {
  const enableBeeps        = useSettingsStore((s) => s.enableBeeps);
  const enableVoiceCues    = useSettingsStore((s) => s.enableVoiceCues);
  const enableHaptics      = useSettingsStore((s) => s.enableHaptics);
  const transitionDuration = useSettingsStore((s) => s.transitionDuration);

  const setEnableBeeps        = useSettingsStore((s) => s.setEnableBeeps);
  const setEnableVoiceCues    = useSettingsStore((s) => s.setEnableVoiceCues);
  const setEnableHaptics      = useSettingsStore((s) => s.setEnableHaptics);
  const setTransitionDuration = useSettingsStore((s) => s.setTransitionDuration);

  // Close on Escape
  const drawerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <>
      {/* ── Backdrop ──────────────────────────────────────────────────────── */}
      <div
        aria-hidden
        onClick={onClose}
        style={{
          position:   'fixed',
          inset:      0,
          zIndex:     90,
          background: 'rgba(18,11,24,0.65)',
          backdropFilter: 'blur(4px)',
          opacity:    open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 280ms ease',
        }}
      />

      {/* ── Drawer panel ──────────────────────────────────────────────────── */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal
        aria-label="Settings"
        style={{
          position:    'fixed',
          top:         0,
          right:       0,
          bottom:      0,
          zIndex:      100,
          width:       'min(380px, 92vw)',
          display:     'flex',
          flexDirection: 'column',
          background:  '#1a1120',
          borderLeft:  '1px solid rgba(74,59,77,0.6)',
          boxShadow:   '-24px 0 64px rgba(0,0,0,0.5)',
          transform:   open ? 'translateX(0)' : 'translateX(100%)',
          transition:  'transform 300ms cubic-bezier(0.32,0.72,0,1)',
          willChange:  'transform',
        }}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div
          style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
            padding:        '20px 20px 0',
            flexShrink:     0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'center',
                width:          '32px',
                height:         '32px',
                borderRadius:   '8px',
                background:     'rgba(169,229,187,0.1)',
                color:          'var(--color-brand-primary)',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
              </svg>
            </span>
            <span
              style={{
                fontSize:      '16px',
                fontWeight:    700,
                color:         'var(--color-brand-text)',
                letterSpacing: '-0.01em',
              }}
            >
              Settings
            </span>
          </div>

          <button
            onClick={onClose}
            aria-label="Close settings"
            style={{
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              width:          '32px',
              height:         '32px',
              borderRadius:   '8px',
              border:         '1px solid rgba(255,255,255,0.08)',
              background:     'rgba(255,255,255,0.04)',
              color:          'rgba(237,228,250,0.5)',
              cursor:         'pointer',
              transition:     'background 150ms ease, color 150ms ease',
              outline:        'none',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)';
              (e.currentTarget as HTMLButtonElement).style.color      = 'var(--color-brand-text)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)';
              (e.currentTarget as HTMLButtonElement).style.color      = 'rgba(237,228,250,0.5)';
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        {/* ── Scrollable body ──────────────────────────────────────────────── */}
        <div
          className="no-scrollbar"
          style={{
            flex:       1,
            overflowY:  'auto',
            padding:    '24px 20px 32px',
          }}
        >

          {/* ── Audio section ────────────────────────────────────────────── */}
          <SectionLabel>Audio</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <ToggleRow
              id="toggle-voice"
              label="Voice Cues"
              description="Announces next exercise during transitions"
              icon={ICONS.voice}
              checked={enableVoiceCues}
              onChange={setEnableVoiceCues}
            />
            <ToggleRow
              id="toggle-beeps"
              label="Countdown Beeps"
              description="Plays ticks, start ding, and step alerts"
              icon={ICONS.beeps}
              checked={enableBeeps}
              onChange={setEnableBeeps}
            />
          </div>

          <Divider />

          {/* ── Feedback section ─────────────────────────────────────────── */}
          <SectionLabel>Feedback</SectionLabel>
          <ToggleRow
            id="toggle-haptics"
            label="Haptic Feedback"
            description="Vibrates on step advances and session end"
            icon={ICONS.haptics}
            checked={enableHaptics}
            onChange={setEnableHaptics}
          />

          <Divider />

          {/* ── Timing section ───────────────────────────────────────────── */}
          <SectionLabel>Transition Speed</SectionLabel>
          <p
            style={{
              margin:     '0 0 12px',
              fontSize:   '12px',
              color:      'rgba(237,228,250,0.4)',
              lineHeight: 1.5,
            }}
          >
            How long the transition overlay stays visible before the next step begins.
          </p>
          <DurationPicker value={transitionDuration} onChange={setTransitionDuration} />

        </div>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <div
          style={{
            flexShrink:  0,
            padding:     '16px 20px',
            borderTop:   '1px solid rgba(255,255,255,0.05)',
            textAlign:   'center',
          }}
        >
          <span style={{ fontSize: '11px', color: 'rgba(237,228,250,0.2)', letterSpacing: '0.05em' }}>
            Settings are saved automatically
          </span>
        </div>
      </div>
    </>
  );
}
