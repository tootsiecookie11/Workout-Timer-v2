import { useEffect, useRef, useState } from 'react';
import {
  useSettingsStore,
  type TransitionDuration,
  type NotionConfig,
} from '../store/settingsStore';
import { useTimerStore } from '../store/timerStore';
import { downloadVault, type ExportFormat } from '../lib/exportVault';

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

// ─── Vault / Export section ───────────────────────────────────────────────────

interface VaultButtonProps {
  format:      ExportFormat;
  label:       string;
  description: string;
  iconPath:    string;
  status:      ExportFormat | 'error' | null;
  onExport:    (f: ExportFormat) => void;
}

function VaultButton({ format, label, description, iconPath, status, onExport }: VaultButtonProps) {
  const isSuccess = status === format;
  const isError   = status === 'error';

  return (
    <div
      style={{
        display:      'flex',
        alignItems:   'center',
        gap:          '12px',
        padding:      '12px 14px',
        borderRadius: '12px',
        background:   isSuccess
          ? 'rgba(169,229,187,0.07)'
          : 'rgba(255,255,255,0.03)',
        border: `1px solid ${
          isSuccess ? 'rgba(169,229,187,0.2)'
          : isError ? 'rgba(255,132,129,0.15)'
          : 'rgba(255,255,255,0.06)'}`,
        transition: 'background 200ms ease, border-color 200ms ease',
      }}
    >
      {/* Format icon */}
      <span
        style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          width:          '34px',
          height:         '34px',
          borderRadius:   '8px',
          flexShrink:     0,
          background:     isSuccess ? 'rgba(169,229,187,0.14)' : 'rgba(255,255,255,0.05)',
          color:          isSuccess ? 'var(--color-brand-primary)' : 'rgba(237,228,250,0.4)',
          transition:     'background 200ms ease, color 200ms ease',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden>
          <path d={iconPath} />
        </svg>
      </span>

      {/* Label + description */}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          display:    'block',
          fontSize:   '13px',
          fontWeight: 600,
          color:      isSuccess ? 'var(--color-brand-primary)' : 'rgba(237,228,250,0.8)',
          transition: 'color 200ms ease',
        }}>
          {label}
        </span>
        <span style={{
          display:    'block',
          fontSize:   '11px',
          marginTop:  '2px',
          color:      'rgba(237,228,250,0.32)',
          lineHeight: 1.4,
        }}>
          {description}
        </span>
      </span>

      {/* Export button */}
      <button
        onClick={() => onExport(format)}
        style={{
          flexShrink:    0,
          padding:       '7px 13px',
          borderRadius:  '8px',
          fontSize:      '11px',
          fontWeight:    700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          cursor:        'pointer',
          border:        'none',
          transition:    'background 180ms ease, color 180ms ease, box-shadow 180ms ease',
          background:    isSuccess
            ? 'rgba(169,229,187,0.18)'
            : 'rgba(255,255,255,0.07)',
          color:   isSuccess ? 'var(--color-brand-primary)' : 'rgba(237,228,250,0.55)',
          boxShadow: isSuccess ? '0 0 10px rgba(169,229,187,0.1)' : 'none',
          outline: 'none',
        }}
      >
        {isSuccess ? '✓ Saved' : 'Export'}
      </button>
    </div>
  );
}

function VaultSection() {
  const sessionHistory  = useTimerStore((s) => s.sessionHistory);
  const customIntervals = useTimerStore((s) => s.customIntervals);
  const fatigueScore    = useTimerStore((s) => s.fatigueScore);

  const [exportStatus, setExportStatus] = useState<ExportFormat | 'error' | null>(null);

  function handleExport(format: ExportFormat) {
    try {
      downloadVault(format, {
        sessionHistory,
        customIntervals,
        fatigueScore,
        exportedAt: new Date().toISOString(),
      });
      setExportStatus(format);
      setTimeout(() => setExportStatus(null), 2200);
    } catch {
      setExportStatus('error');
      setTimeout(() => setExportStatus(null), 2200);
    }
  }

  const sessionCount = sessionHistory.length;
  const templateCount = customIntervals.length;

  return (
    <div>
      <p style={{
        margin:     '0 0 10px',
        fontSize:   '12px',
        lineHeight: 1.55,
        color:      'rgba(237,228,250,0.38)',
      }}>
        {sessionCount > 0 || templateCount > 0
          ? `${sessionCount} session${sessionCount !== 1 ? 's' : ''}${templateCount > 0 ? ` · ${templateCount} template${templateCount !== 1 ? 's' : ''}` : ''} ready to export.`
          : 'No sessions recorded yet — start a workout to populate your vault.'}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
        <VaultButton
          format="json"
          label="JSON"
          description="Structured backup — developer &amp; import-ready"
          iconPath="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M10 13l-2 2 2 2 M14 13l2 2-2 2"
          status={exportStatus}
          onExport={handleExport}
        />
        <VaultButton
          format="csv"
          label="CSV"
          description="Row-per-session table — Excel &amp; Google Sheets"
          iconPath="M3 3h18v4H3z M3 10h18v4H3z M3 17h18v4H3z"
          status={exportStatus}
          onExport={handleExport}
        />
        <VaultButton
          format="markdown"
          label="Markdown"
          description="Training log with YAML front matter — Obsidian &amp; Notion"
          iconPath="M4 7h16 M4 12h10 M4 17h12 M19 12l-3 3 3 3"
          status={exportStatus}
          onExport={handleExport}
        />
      </div>

      {exportStatus === 'error' && (
        <p style={{ marginTop: '8px', fontSize: '11px', color: 'rgba(255,132,129,0.75)' }}>
          Export failed — check browser download permissions.
        </p>
      )}
    </div>
  );
}

// ─── Notion Vault section ─────────────────────────────────────────────────────

const NOTION_FIELDS: {
  key:         keyof NotionConfig;
  label:       string;
  placeholder: string;
}[] = [
  { key: 'workoutsDatabaseId', label: 'Workouts DB',  placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
  { key: 'blocksDatabaseId',   label: 'Blocks DB',    placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
  { key: 'programsDatabaseId', label: 'Programs DB',  placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
  { key: 'sessionsDatabaseId', label: 'Sessions DB',  placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
];

const EYE_ON  = 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z';
const EYE_OFF = 'M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z';

function NotionVaultSection() {
  const notionConfig          = useSettingsStore((s) => s.notionConfig);
  const setWorkoutsDatabaseId = useSettingsStore((s) => s.setWorkoutsDatabaseId);
  const setBlocksDatabaseId   = useSettingsStore((s) => s.setBlocksDatabaseId);
  const setProgramsDatabaseId = useSettingsStore((s) => s.setProgramsDatabaseId);
  const setSessionsDatabaseId = useSettingsStore((s) => s.setSessionsDatabaseId);

  const [revealed, setRevealed] = useState<Partial<Record<keyof NotionConfig, boolean>>>({});

  const setters: Record<keyof NotionConfig, (id: string) => void> = {
    workoutsDatabaseId: setWorkoutsDatabaseId,
    blocksDatabaseId:   setBlocksDatabaseId,
    programsDatabaseId: setProgramsDatabaseId,
    sessionsDatabaseId: setSessionsDatabaseId,
  };

  function toggleReveal(key: keyof NotionConfig) {
    setRevealed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const filledCount = NOTION_FIELDS.filter(({ key }) => notionConfig[key].trim() !== '').length;

  return (
    <div>
      {/* Subtitle */}
      <p style={{
        margin:     '0 0 14px',
        fontSize:   '12px',
        lineHeight: 1.55,
        color:      'rgba(237,228,250,0.38)',
      }}>
        {filledCount === 0
          ? 'Paste your Notion database IDs to enable sync. IDs are stored locally only.'
          : `${filledCount} of 4 database${filledCount !== 1 ? 's' : ''} configured.`}
      </p>

      {/* ID inputs */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {NOTION_FIELDS.map(({ key, label, placeholder }) => {
          const value    = notionConfig[key];
          const isSet    = value.trim() !== '';
          const isShown  = !!revealed[key];

          return (
            <div key={key}>
              {/* Field label */}
              <p style={{
                margin:        '0 0 5px',
                fontSize:      '11px',
                fontWeight:    600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color:         isSet ? 'rgba(169,229,187,0.6)' : 'rgba(237,228,250,0.3)',
                transition:    'color 200ms ease',
              }}>
                {label}
                {isSet && (
                  <span style={{
                    marginLeft:  '6px',
                    fontSize:    '9px',
                    fontWeight:  700,
                    color:       'var(--color-brand-primary)',
                    verticalAlign: 'middle',
                  }}>
                    ✓ SET
                  </span>
                )}
              </p>

              {/* Input row */}
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type={isShown ? 'text' : 'password'}
                  value={value}
                  onChange={(e) => setters[key](e.target.value)}
                  placeholder={placeholder}
                  autoComplete="off"
                  spellCheck={false}
                  style={{
                    flex:          1,
                    padding:       '10px 44px 10px 13px',
                    borderRadius:  '10px',
                    border:        `1px solid ${isSet ? 'rgba(169,229,187,0.2)' : 'rgba(255,255,255,0.07)'}`,
                    background:    isSet ? 'rgba(169,229,187,0.04)' : 'rgba(255,255,255,0.03)',
                    color:         'rgba(237,228,250,0.85)',
                    fontSize:      '13px',
                    fontFamily:    'monospace',
                    letterSpacing: isShown ? '0.02em' : '0.12em',
                    outline:       'none',
                    transition:    'border-color 200ms ease, background 200ms ease',
                    width:         '100%',
                    boxSizing:     'border-box',
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(169,229,187,0.35)';
                    e.currentTarget.style.background  = 'rgba(169,229,187,0.06)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = isSet ? 'rgba(169,229,187,0.2)' : 'rgba(255,255,255,0.07)';
                    e.currentTarget.style.background  = isSet ? 'rgba(169,229,187,0.04)' : 'rgba(255,255,255,0.03)';
                  }}
                />

                {/* Reveal / hide toggle */}
                <button
                  type="button"
                  onClick={() => toggleReveal(key)}
                  aria-label={isShown ? `Hide ${label}` : `Reveal ${label}`}
                  style={{
                    position:       'absolute',
                    right:          '10px',
                    display:        'flex',
                    alignItems:     'center',
                    justifyContent: 'center',
                    width:          '26px',
                    height:         '26px',
                    borderRadius:   '6px',
                    border:         'none',
                    background:     'transparent',
                    color:          isShown ? 'rgba(169,229,187,0.55)' : 'rgba(237,228,250,0.25)',
                    cursor:         'pointer',
                    transition:     'color 150ms ease',
                    outline:        'none',
                    padding:        0,
                    flexShrink:     0,
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = 'rgba(237,228,250,0.7)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = isShown
                      ? 'rgba(169,229,187,0.55)'
                      : 'rgba(237,228,250,0.25)';
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d={isShown ? EYE_OFF : EYE_ON} />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Helper link */}
      <a
        href="https://developers.notion.com/docs/working-with-databases"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display:        'inline-flex',
          alignItems:     'center',
          gap:            '4px',
          marginTop:      '12px',
          fontSize:       '11px',
          fontWeight:     600,
          color:          'rgba(169,229,187,0.5)',
          textDecoration: 'none',
          transition:     'color 150ms ease',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLAnchorElement).style.color = 'var(--color-brand-primary)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLAnchorElement).style.color = 'rgba(169,229,187,0.5)';
        }}
      >
        How to find IDs?
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
        </svg>
      </a>
    </div>
  );
}

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
  const settingsScrollTarget  = useSettingsStore((s) => s.settingsScrollTarget);
  const setSettingsScrollTarget = useSettingsStore((s) => s.setSettingsScrollTarget);

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
    
    // Handle targeted scrolling when drawer opens
    if (open && settingsScrollTarget) {
      // Small timeout to ensure the drawer animation has started/layout is ready
      const timer = setTimeout(() => {
        const element = document.getElementById(settingsScrollTarget);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
          // Clear the target after scrolling so it doesn't re-scroll on next open
          setSettingsScrollTarget(null);
        }
      }, 350); // Matches drawer animation duration slightly
      return () => clearTimeout(timer);
    }

    return () => { document.body.style.overflow = ''; };
  }, [open, settingsScrollTarget, setSettingsScrollTarget]);

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

          <Divider />

          {/* ── Vault section ─────────────────────────────────────────────── */}
          <SectionLabel>Vault</SectionLabel>
          <VaultSection />

          <Divider />

          {/* ── Notion Vault section ──────────────────────────────────────── */}
          <div id="notion-vault">
            <SectionLabel>Notion Vault</SectionLabel>
            <NotionVaultSection />
          </div>

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
