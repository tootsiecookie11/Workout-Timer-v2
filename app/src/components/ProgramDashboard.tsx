import { useState } from 'react';
import { useTimerStore } from '../store/timerStore';
import { useSettingsStore } from '../store/settingsStore';
import { useProgramEngine } from '../hooks/useProgramEngine';
import { buildGraph } from '../engine/graphBuilder';
import { classifyFatigue } from '../engine/fatigueEngine';
import ProgramsListScreen from './ProgramsListScreen';
import type { WorkoutBlock } from '../engine/types';

// ─── Design-system accent helpers ────────────────────────────────────────────

const ACCENT = {
  green:  '169,229,187',
  amber:  '254,178,70',
  coral:  '255,132,129',
} as const;

type AccentKey = keyof typeof ACCENT;

function rgba(key: AccentKey, alpha: number) {
  return `rgba(${ACCENT[key]},${alpha})`;
}

// ─── Derived stats from the WorkoutAST block tree ─────────────────────────────

function deriveStats(blocks: WorkoutBlock[]): { totalMs: number; exerciseCount: number } {
  function sumMs(bs: WorkoutBlock[]): number {
    return bs.reduce((acc, b) => {
      const own      = b.duration_ms    ?? 0;
      const children = b.children       ? sumMs(b.children) : 0;
      const rest     = b.rest_after_ms  ?? 0;
      const rounds   = b.rounds         ?? 1;
      return acc + (own + children + rest) * rounds;
    }, 0);
  }
  function countEx(bs: WorkoutBlock[]): number {
    return bs.reduce((acc, b) => {
      if (b.type === 'exercise') return acc + 1;
      return acc + (b.children ? countEx(b.children) : 0);
    }, 0);
  }
  return { totalMs: sumMs(blocks), exerciseCount: countEx(blocks) };
}

function fmtDuration(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `~${m} min`;
  const h = Math.floor(m / 60), rem = m % 60;
  return rem ? `~${h}h ${rem}m` : `~${h}h`;
}

// ─── Coach profile ────────────────────────────────────────────────────────────

interface CoachProfile {
  headline:   string;
  subtext:    string;
  routeLabel: string;
  accent:     AccentKey;
}

/**
 * Derives a coaching recommendation from fatigue + readiness.
 * The resulting `accent` key also drives the ambient glow colour.
 *
 * The workout's DSL edge conditions (e.g. `fatigue_score < 4`) are evaluated
 * automatically by GraphEngine at runtime using the injected EvalContext —
 * this function only produces the human-readable message.
 */
function buildCoachProfile(fatigue: number, readiness: number): CoachProfile {
  // Combine fatigue (70 %) and inverted readiness (30 %) into a single stress score.
  const stress = fatigue * 0.65 + (10 - readiness) * 0.35;

  if (stress < 3.5) {
    return {
      headline:   `Fatigue is low (${fatigue.toFixed(1)}/10). Today we push for a PR.`,
      subtext:    'Recovery is optimal — the graph will route you to the performance variant.',
      routeLabel: 'Performance Path',
      accent:     'green',
    };
  }
  if (stress < 5.5) {
    return {
      headline:   `Fatigue is moderate (${fatigue.toFixed(1)}/10). Consistent effort today.`,
      subtext:    'Standard protocol active — focus on quality reps and clean form.',
      routeLabel: 'Standard Path',
      accent:     'amber',
    };
  }
  if (stress < 7.5) {
    return {
      headline:   `Fatigue is elevated (${fatigue.toFixed(1)}/10). Switching to the recovery variant.`,
      subtext:    'Volume is reduced. Leave something in the tank for tomorrow.',
      routeLabel: 'Recovery Variant',
      accent:     'amber',
    };
  }
  return {
    headline:   `Fatigue is high (${fatigue.toFixed(1)}/10). Deload protocol activated.`,
    subtext:    'Light movement and mobility only — your body is asking for rest.',
    routeLabel: 'Deload Protocol',
    accent:     'coral',
  };
}

// ─── WeekProgressBar ─────────────────────────────────────────────────────────

function WeekProgressBar({
  week, totalWeeks, day,
}: {
  week: number; totalWeeks: number; day: number;
}) {
  const weekPct = ((week - 1) / totalWeeks) * 100;

  return (
    <div className="flex flex-col gap-3">
      {/* Week label */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: 'var(--color-brand-text-muted)' }}>
          Week Progress
        </span>
        <span className="font-display text-sm font-bold"
          style={{ color: 'var(--color-brand-primary)' }}>
          Week {week}{' '}
          <span style={{ color: 'var(--color-brand-text-muted)' }}>of {totalWeeks}</span>
        </span>
      </div>

      {/* Week fill bar */}
      <div className="w-full h-2 rounded-full overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div className="h-full rounded-full transition-all duration-700"
          style={{
            width:      `${weekPct}%`,
            background: `linear-gradient(90deg, ${rgba('green', 0.65)}, ${rgba('green', 0.9)})`,
            boxShadow:  `0 0 8px ${rgba('green', 0.35)}`,
          }}
        />
      </div>

      {/* Day dots */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest mr-1 shrink-0"
          style={{ color: 'var(--color-brand-text-muted)' }}>
          Day
        </span>
        {Array.from({ length: 7 }, (_, i) => {
          const isToday = i + 1 === day;
          const isPast  = i + 1 < day;
          return (
            <div key={i} className="flex-1 h-1.5 rounded-full transition-all duration-300"
              style={{
                background: isToday ? rgba('green', 0.95)
                          : isPast  ? rgba('green', 0.32)
                          : 'rgba(255,255,255,0.07)',
                boxShadow: isToday ? `0 0 6px ${rgba('green', 0.5)}` : 'none',
              }}
            />
          );
        })}
        <span className="text-[10px] font-bold tabular-nums ml-1 shrink-0"
          style={{ color: 'var(--color-brand-text-muted)' }}>
          {day}/7
        </span>
      </div>
    </div>
  );
}

// ─── FatigueChip (inline) ─────────────────────────────────────────────────────

function FatigueChip({ score }: { score: number }) {
  const cat       = classifyFatigue(score);
  const key: AccentKey = score >= 7 ? 'coral' : score >= 4.5 ? 'amber' : 'green';
  const label     = cat.charAt(0).toUpperCase() + cat.slice(1);
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full self-start"
      style={{ background: rgba(key, 0.08), border: `1px solid ${rgba(key, 0.2)}` }}>
      <span className="w-1.5 h-1.5 rounded-full"
        style={{ background: rgba(key, 0.85), boxShadow: `0 0 5px ${rgba(key, 0.5)}` }} />
      <span className="text-[10px] font-bold uppercase tracking-widest tabular-nums"
        style={{ color: rgba(key, 0.8) }}>
        Fatigue {score.toFixed(1)}/10 — {label}
      </span>
    </div>
  );
}

// ─── SessionPreviewCard ───────────────────────────────────────────────────────

function SessionPreviewCard({
  name, blocks, fatigueScore, loading,
}: {
  name: string; blocks: WorkoutBlock[]; fatigueScore: number | null; loading: boolean;
}) {
  const { totalMs, exerciseCount } = deriveStats(blocks);
  const chips = blocks.filter((b) => b.type !== 'rest').slice(0, 5).map((b) => b.label);
  const extra = blocks.filter((b) => b.type !== 'rest').length - 5;

  return (
    <div className="w-full rounded-2xl px-5 py-4 flex flex-col gap-3"
      style={{ background: 'rgba(35,24,38,0.8)', border: '1px solid rgba(255,255,255,0.07)' }}>

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: 'var(--color-brand-text-muted)' }}>
            Today's Lift
          </span>
          <h2 className="font-display text-lg font-bold leading-tight"
            style={{ color: 'var(--color-brand-text)' }}>
            {name || '—'}
          </h2>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {totalMs > 0 && (
            <span className="text-xs font-bold tabular-nums px-2.5 py-1 rounded-full"
              style={{
                background: rgba('green', 0.09),
                border:     `1px solid ${rgba('green', 0.2)}`,
                color:      rgba('green', 0.85),
              }}>
              {fmtDuration(totalMs)}
            </span>
          )}
          {exerciseCount > 0 && (
            <span className="text-[10px] font-bold uppercase tracking-widest"
              style={{ color: 'var(--color-brand-text-muted)' }}>
              {exerciseCount} exercise{exerciseCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Exercise preview chips */}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((label) => (
            <span key={label}
              className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border:     '1px solid rgba(255,255,255,0.08)',
                color:      'rgba(237,228,250,0.5)',
              }}>
              {label}
            </span>
          ))}
          {extra > 0 && (
            <span className="text-[10px] font-bold px-2 py-1"
              style={{ color: 'var(--color-brand-text-muted)' }}>
              +{extra} more
            </span>
          )}
        </div>
      )}

      {/* Fatigue chip */}
      {loading ? (
        <div className="h-6 w-36 rounded-full animate-pulse"
          style={{ background: 'rgba(255,255,255,0.05)' }} />
      ) : fatigueScore !== null ? (
        <FatigueChip score={fatigueScore} />
      ) : null}
    </div>
  );
}

// ─── CoachCard ────────────────────────────────────────────────────────────────

function CoachCard({ profile }: { profile: CoachProfile }) {
  const { headline, subtext, routeLabel, accent } = profile;
  return (
    <div className="w-full rounded-2xl px-5 py-4 flex flex-col gap-3 relative overflow-hidden"
      style={{
        background: `linear-gradient(135deg, rgba(35,24,38,0.92) 0%, ${rgba(accent, 0.07)} 100%)`,
        border:     `1px solid ${rgba(accent, 0.2)}`,
      }}>

      {/* Corner glow */}
      <div className="pointer-events-none absolute -top-8 -right-8 w-28 h-28 rounded-full blur-3xl"
        style={{ background: rgba(accent, 0.15) }} />

      {/* Icon + label */}
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: rgba(accent, 0.12), border: `1px solid ${rgba(accent, 0.25)}` }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
            stroke={`rgba(${ACCENT[accent]},0.85)`} strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: rgba(accent, 0.65) }}>
          Coach
        </span>
      </div>

      {/* Headline + subtext */}
      <p className="text-sm font-medium leading-relaxed"
        style={{ color: 'var(--color-brand-text)' }}>
        {headline}
      </p>
      <p className="text-xs leading-relaxed"
        style={{ color: 'var(--color-brand-text-muted)' }}>
        {subtext}
      </p>

      {/* Route pill */}
      <div className="inline-flex items-center gap-2 self-start px-3 py-1.5 rounded-full"
        style={{ background: rgba(accent, 0.1), border: `1px solid ${rgba(accent, 0.25)}` }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: rgba(accent, 0.85) }} />
        <span className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: rgba(accent, 0.85) }}>
          {routeLabel}
        </span>
      </div>
    </div>
  );
}

// ─── ReadinessDial ────────────────────────────────────────────────────────────

const READINESS_LABELS: Record<number, string> = {
  0: 'Terrible', 1: 'Very poor', 2: 'Poor', 3: 'Below avg',
  4: 'Average',  5: 'OK',        6: 'Good', 7: 'Great',
  8: 'Very good', 9: 'Excellent', 10: 'Peak',
};

function ReadinessDial({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-widest"
          style={{ color: 'var(--color-brand-text-muted)' }}>
          How ready are you?
        </span>
        <div className="flex items-baseline gap-1.5">
          <span className="font-display font-bold tabular-nums"
            style={{
              fontSize: '1.1rem',
              color: value >= 7 ? rgba('green', 0.95)
                   : value >= 4 ? rgba('amber', 0.95)
                   : rgba('coral', 0.95),
            }}>
            {value}
          </span>
          <span className="text-xs" style={{ color: 'var(--color-brand-text-muted)' }}>
            — {READINESS_LABELS[value]}
          </span>
        </div>
      </div>

      <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(11, 1fr)' }}>
        {Array.from({ length: 11 }, (_, i) => {
          const isSelected = i === value;
          const key: AccentKey = i >= 7 ? 'green' : i >= 4 ? 'amber' : 'coral';
          return (
            <button key={i} onClick={() => onChange(i)}
              aria-pressed={isSelected}
              className="aspect-square rounded-xl flex items-center justify-center text-xs font-bold transition-all duration-150 active:scale-90"
              style={{
                background: isSelected ? `rgba(${ACCENT[key]},0.9)`
                          : i <= value ? rgba(key, 0.12)
                          : 'rgba(255,255,255,0.04)',
                color:      isSelected ? '#120b18'
                          : i <= value ? rgba(key, 0.7)
                          : 'var(--color-brand-text-muted)',
                border:    isSelected ? 'none' : '1px solid rgba(255,255,255,0.06)',
                boxShadow: isSelected ? `0 0 12px ${rgba(key, 0.3)}` : 'none',
                fontWeight: isSelected ? 800 : 600,
              }}>
              {i}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── GateCard ─────────────────────────────────────────────────────────────────

function GateCard({
  icon, title, body, cta, onCta,
}: {
  icon:   React.ReactNode;
  title:  string;
  body:   string;
  cta?:   string;
  onCta?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-5 text-center py-10">
      <div className="w-16 h-16 rounded-full flex items-center justify-center"
        style={{ background: 'rgba(169,229,187,0.08)', border: '1px solid rgba(169,229,187,0.2)' }}>
        {icon}
      </div>
      <div className="space-y-2">
        <h2 className="font-display text-xl font-bold"
          style={{ color: 'var(--color-brand-text)' }}>{title}</h2>
        <p className="text-sm max-w-xs" style={{ color: 'var(--color-brand-text-muted)' }}>{body}</p>
      </div>
      {cta && onCta && (
        <button onClick={onCta}
          className="px-6 py-3 rounded-2xl font-bold text-sm uppercase tracking-widest transition-all active:scale-[0.98]"
          style={{ background: 'var(--color-brand-primary)', color: '#120b18' }}>
          {cta}
        </button>
      )}
    </div>
  );
}

// ─── Mobility recovery preset ────────────────────────────────────────────────

const MOBILITY_BLOCKS: WorkoutBlock[] = [
  { id: 'mob-1',  type: 'exercise', label: 'Cat-Cow',            duration_ms: 60_000 },
  { id: 'mob-r1', type: 'rest',     label: 'Rest',               duration_ms: 15_000 },
  { id: 'mob-2',  type: 'exercise', label: 'Hip Circles',        duration_ms: 45_000 },
  { id: 'mob-r2', type: 'rest',     label: 'Rest',               duration_ms: 15_000 },
  { id: 'mob-3',  type: 'exercise', label: 'Thoracic Rotation',  duration_ms: 45_000 },
  { id: 'mob-r3', type: 'rest',     label: 'Rest',               duration_ms: 15_000 },
  { id: 'mob-4',  type: 'exercise', label: 'Hip Flexor Stretch', duration_ms: 60_000 },
  { id: 'mob-r4', type: 'rest',     label: 'Rest',               duration_ms: 15_000 },
  { id: 'mob-5',  type: 'exercise', label: "Child's Pose",       duration_ms: 60_000 },
];

const MOBILITY_LABELS = ['Cat-Cow', 'Hip Circles', 'Thoracic Rotation', 'Hip Flexor Stretch', "Child's Pose"];

// ─── ActiveRecoveryCard ───────────────────────────────────────────────────────

function ActiveRecoveryCard({ onStart }: { onStart: () => void }) {
  return (
    <div className="w-full rounded-2xl px-5 py-4 flex flex-col gap-4 relative overflow-hidden"
      style={{ background: 'rgba(35,24,38,0.9)', border: `1px solid ${rgba('amber', 0.2)}` }}>

      {/* Corner glow */}
      <div className="pointer-events-none absolute -top-6 -right-6 w-24 h-24 rounded-full blur-2xl"
        style={{ background: rgba('amber', 0.12) }} />

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: rgba('amber', 0.1), border: `1px solid ${rgba('amber', 0.22)}` }}>
          {/* stretch/body icon */}
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
            stroke={`rgba(${ACCENT.amber},0.85)`} strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="5" r="1.5" />
            <path d="M9 12l3-7 3 7" />
            <path d="M6 17c1.5-2 3-3 6-3s4.5 1 6 3" />
            <path d="M8 22l2-4 2 1 2-1 2 4" />
          </svg>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: rgba('amber', 0.6) }}>
            Suggested Active Recovery
          </p>
          <p className="text-sm font-bold leading-tight"
            style={{ color: 'var(--color-brand-text)' }}>
            5-min Mobility Routine
          </p>
        </div>
      </div>

      {/* Exercise chips */}
      <div className="flex flex-wrap gap-1.5">
        {MOBILITY_LABELS.map((ex) => (
          <span key={ex}
            className="text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide"
            style={{
              background: rgba('amber', 0.07),
              border:     `1px solid ${rgba('amber', 0.15)}`,
              color:      rgba('amber', 0.65),
            }}>
            {ex}
          </span>
        ))}
      </div>

      {/* Launch button */}
      <button
        onClick={onStart}
        className="w-full py-3 rounded-xl font-bold text-sm uppercase tracking-widest transition-all duration-200 active:scale-[0.97]"
        style={{
          background: rgba('amber', 0.12),
          border:     `1px solid ${rgba('amber', 0.28)}`,
          color:      rgba('amber', 0.9),
          boxShadow:  `0 0 24px ${rgba('amber', 0.08)}`,
        }}>
        Start 5-min Mobility
      </button>
    </div>
  );
}

// ─── NoProgramGuide ───────────────────────────────────────────────────────────

const PROGRAM_STEPS = [
  {
    n: '01',
    title: 'Open your Notion workspace',
    body:  'Navigate to your Programs database within your duplicated Galawgaw template.',
  },
  {
    n: '02',
    title: 'Create or open a program page',
    body:  'Add a name, goal, duration in weeks, start date, and a list of program days.',
  },
  {
    n: '03',
    title: 'Activate from the app',
    body:  'Tap "Browse Programs" below to select and activate a program directly in the app.',
  },
];

function NoProgramGuide({ onRefresh, onBrowse }: { onRefresh: () => void; onBrowse: () => void }) {
  return (
    <div className="flex flex-col gap-6 py-2">
      {/* Icon */}
      <div className="flex justify-center">
        <div className="w-16 h-16 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(169,229,187,0.07)', border: '1px solid rgba(169,229,187,0.18)' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
            stroke="rgba(169,229,187,0.65)" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
      </div>

      {/* Title + subtitle */}
      <div className="text-center space-y-2">
        <h2 className="font-display text-xl font-bold"
          style={{ color: 'var(--color-brand-text)' }}>
          No active program
        </h2>
        <p className="text-sm leading-relaxed max-w-xs mx-auto"
          style={{ color: 'var(--color-brand-text-muted)' }}>
          Create a training program in Notion, then activate it here or mark it Active in Notion.
        </p>
      </div>

      {/* Step-by-step guide */}
      <div className="flex flex-col gap-2">
        {PROGRAM_STEPS.map(({ n, title, body }) => (
          <div key={n}
            className="flex gap-4 rounded-xl px-4 py-3"
            style={{ background: 'rgba(35,24,38,0.8)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <span className="font-display text-xs font-bold tabular-nums shrink-0 pt-0.5"
              style={{ color: 'rgba(169,229,187,0.45)' }}>
              {n}
            </span>
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-bold" style={{ color: 'var(--color-brand-text)' }}>
                {title}
              </p>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--color-brand-text-muted)' }}>
                {body}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Browse Programs CTA (primary) */}
      <button
        onClick={onBrowse}
        className="w-full py-3.5 rounded-2xl font-bold text-sm uppercase tracking-widest transition-all active:scale-[0.98]"
        style={{
          background: 'var(--color-brand-primary)',
          color:      '#120b18',
        }}>
        Browse Programs
      </button>

      {/* Refresh (secondary) */}
      <button
        onClick={onRefresh}
        className="w-full py-3 rounded-2xl font-bold text-sm uppercase tracking-widest transition-all active:scale-[0.98]"
        style={{
          background: 'rgba(169,229,187,0.06)',
          border:     '1px solid rgba(169,229,187,0.18)',
          color:      'rgba(169,229,187,0.6)',
        }}>
        Check Again
      </button>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="flex flex-col gap-4 animate-pulse">
      {[72, 100, 116, 96, 60].map((h, i) => (
        <div key={i} className="w-full rounded-2xl"
          style={{ height: h, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.05)' }} />
      ))}
    </div>
  );
}

// ─── ProgramDashboard ─────────────────────────────────────────────────────────

export default function ProgramDashboard() {
  const {
    status, allPrograms, program, today,
    workoutAST, astLoading,
    fatigueScore, todayCompleted,
    loading, error,
    connectNotion, refresh,
  } = useProgramEngine();

  const startGraphSession = useTimerStore((s) => s.startGraphSession);
  const startSession      = useTimerStore((s) => s.startSession);
  const storeFatigueScore = useTimerStore((s) => s.setFatigueScore);

  const [readiness,        setReadiness]        = useState(7);
  const [launching,        setLaunching]        = useState(false);
  const [launchError,      setLaunchError]      = useState<string | null>(null);
  const [showProgramsList, setShowProgramsList] = useState(false);

  // ── Derived ──────────────────────────────────────────────────────────────
  const effectiveFatigue = fatigueScore ?? 0;
  const coach            = buildCoachProfile(effectiveFatigue, readiness);
  const hasWorkout       = !!(workoutAST?.blocks?.length);

  // ── Launch ────────────────────────────────────────────────────────────────
  async function handleLaunch() {
    if (!hasWorkout || !workoutAST) return;
    setLaunchError(null);
    setLaunching(true);
    try {
      // Build a WorkoutGraph from the flat block tree so GraphEngine can
      // traverse conditional edges — DSL conditions like `fatigue_score >= 6`
      // are evaluated automatically against the EvalContext we inject here.
      const graph = buildGraph(workoutAST.blocks);

      // Persist fatigue in the store so PreWorkoutReadiness + overlays see it
      storeFatigueScore(effectiveFatigue);

      // startGraphSession threads workoutId → activeWorkoutId so WorkoutComplete
      // can sync the session back to Notion when it finishes.
      startGraphSession(
        graph,
        { fatigue_score: effectiveFatigue, readiness },
        today?.day_info?.workout_template_id ?? undefined,
      );
      // Screen transitions away on success — no need to set launching=false
    } catch (e: unknown) {
      setLaunchError(e instanceof Error ? e.message : 'Failed to build workout graph');
      setLaunching(false);
    }
  }

  // ── Programs browse overlay ───────────────────────────────────────────────

  if (showProgramsList) {
    return (
      <ProgramsListScreen
        programs={allPrograms}
        loading={loading}
        onBack={() => setShowProgramsList(false)}
      />
    );
  }

  // ── Gate states ───────────────────────────────────────────────────────────

  if (status === 'checking' || loading) {
    return (
      <main className="min-h-screen flex flex-col items-center px-6 pb-10 pt-28">
        <div className="w-full max-w-sm"><Skeleton /></div>
      </main>
    );
  }

  if (status === 'no_config') {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <GateCard
            icon={<svg width="28" height="28" viewBox="0 0 24 24" fill="none"
              stroke="rgba(169,229,187,0.65)" strokeWidth="2" strokeLinecap="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>}
            title="Notion Vault Required"
            body="To track your progress via Notion, you need to link your program data in the Settings."
            cta="Open Notion Vault"
            onCta={() => useSettingsStore.getState().openSettings('notion-vault')}
          />
        </div>
      </main>
    );
  }

  if (status === 'no_auth') {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <GateCard
            icon={<svg width="28" height="28" viewBox="0 0 24 24" fill="none"
              stroke="rgba(169,229,187,0.65)" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4h16v16H4V4zm2 4v10h12V8H6z"/>
            </svg>}
            title="Connect Notion"
            body="Sign in with Notion to load your active training program and track your progress."
            cta="Connect Notion"
            onCta={connectNotion}
          />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <GateCard
            icon={<svg width="28" height="28" viewBox="0 0 24 24" fill="none"
              stroke="rgba(255,132,129,0.7)" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>}
            title="Couldn't load program"
            body={error}
            cta="Try Again"
            onCta={refresh}
          />
        </div>
      </main>
    );
  }

  if (!program) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-6 pt-20 pb-12">
        <div className="w-full max-w-sm">
          <NoProgramGuide onRefresh={refresh} onBrowse={() => setShowProgramsList(true)} />
        </div>
      </main>
    );
  }

  if (!today) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <GateCard
            icon={<svg width="28" height="28" viewBox="0 0 24 24" fill="none"
              stroke="rgba(254,178,70,0.65)" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="4" width="18" height="18" rx="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>}
            title="Program not active today"
            body={`${program.name} hasn't started yet or has finished its ${program.duration_weeks}-week run.`}
          />
        </div>
      </main>
    );
  }

  // ── Full dashboard ────────────────────────────────────────────────────────

  const isRestDay = today.is_rest_day;

  return (
    <main className="min-h-screen flex flex-col items-center px-6 pb-10 pt-24">
      {/* Ambient glow — colour shifts with coach accent */}
      <div className="pointer-events-none fixed inset-0" aria-hidden="true"
        style={{
          background: `radial-gradient(ellipse 55% 35% at 50% 30%, rgba(${ACCENT[coach.accent]},0.07) 0%, transparent 70%)`,
          transition: 'background 0.8s ease',
        }}
      />

      <div className="w-full max-w-sm flex flex-col gap-5 relative">

        {/* Program name + status badges */}
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight truncate"
            style={{ color: 'var(--color-brand-text)' }}>
            {program.name}
          </h1>
          <div className="flex items-center gap-2 shrink-0">
            {isRestDay && (
              <span className="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full"
                style={{ background: rgba('amber', 0.1), border: `1px solid ${rgba('amber', 0.25)}`, color: rgba('amber', 0.8) }}>
                Rest Day
              </span>
            )}
            {todayCompleted && !isRestDay && (
              <span className="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full"
                style={{ background: rgba('green', 0.1), border: `1px solid ${rgba('green', 0.25)}`, color: rgba('green', 0.8) }}>
                ✓ Done
              </span>
            )}
            {/* Change program */}
            <button
              onClick={() => setShowProgramsList(true)}
              className="w-8 h-8 rounded-xl flex items-center justify-center transition-all active:scale-90"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border:     '1px solid rgba(255,255,255,0.1)',
              }}
              title="Browse programs"
              aria-label="Browse programs"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                stroke="rgba(237,228,250,0.5)" strokeWidth="2.5"
                strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6"  x2="21" y2="6"  />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Week / Day progress */}
        <div className="w-full rounded-2xl px-5 py-4"
          style={{ background: 'rgba(35,24,38,0.8)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <WeekProgressBar week={today.week} totalWeeks={today.total_weeks} day={today.day} />
        </div>

        {/* Rest day card */}
        {isRestDay && (
          <div className="w-full rounded-2xl px-5 py-7 flex flex-col items-center gap-3 text-center"
            style={{ background: 'rgba(35,24,38,0.8)', border: `1px solid ${rgba('amber', 0.14)}` }}>
            <span style={{ fontSize: '2rem' }}>🛋️</span>
            <p className="font-display text-base font-bold" style={{ color: 'var(--color-brand-text)' }}>
              Active Recovery Day
            </p>
            <p className="text-sm" style={{ color: 'var(--color-brand-text-muted)' }}>
              {today.day_info?.notes || 'Stretch, walk, and prepare for the next training day.'}
            </p>
          </div>
        )}

        {/* Active recovery suggestion — shown on rest days */}
        {isRestDay && (
          <ActiveRecoveryCard onStart={() => startSession(MOBILITY_BLOCKS)} />
        )}

        {/* Session preview */}
        {!isRestDay && (hasWorkout || astLoading) && (
          <SessionPreviewCard
            name={workoutAST?.name ?? '…'}
            blocks={workoutAST?.blocks ?? []}
            fatigueScore={fatigueScore}
            loading={astLoading}
          />
        )}

        {/* No template linked */}
        {!isRestDay && !hasWorkout && !astLoading && (
          <div className="w-full rounded-2xl px-5 py-4 text-center"
            style={{ background: 'rgba(35,24,38,0.8)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <p className="text-sm" style={{ color: 'var(--color-brand-text-muted)' }}>
              No workout template linked to Week {today.week}, Day {today.day}.
            </p>
          </div>
        )}

        {/* Coach card — visible once we have a fatigue reading */}
        {!isRestDay && fatigueScore !== null && (
          <CoachCard profile={coach} />
        )}

        {/* Readiness dial */}
        {!isRestDay && hasWorkout && (
          <div className="w-full rounded-2xl px-5 py-4"
            style={{ background: 'rgba(35,24,38,0.8)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <ReadinessDial value={readiness} onChange={setReadiness} />
          </div>
        )}

        {/* Launch error */}
        {launchError && (
          <p className="text-xs text-center" style={{ color: rgba('coral', 0.8) }}>
            {launchError}
          </p>
        )}

        {/* Start button */}
        {!isRestDay && hasWorkout && (
          <button
            onClick={handleLaunch}
            disabled={launching || astLoading}
            className="w-full py-4 rounded-2xl font-bold text-sm uppercase tracking-widest transition-all duration-300 active:scale-[0.98] disabled:opacity-60"
            style={{
              background: todayCompleted
                ? rgba('green', 0.14)
                : 'var(--color-brand-primary)',
              color:     todayCompleted ? rgba('green', 0.8) : '#120b18',
              border:    todayCompleted ? `1px solid ${rgba('green', 0.28)}` : 'none',
              boxShadow: todayCompleted ? 'none' : '0 0 40px rgba(169,229,187,0.18)',
            }}
          >
            {launching   ? 'Loading…'
             : astLoading ? 'Preparing…'
             : todayCompleted ? 'Start Again'
             : `Start — Week ${today.week}, Day ${today.day}`}
          </button>
        )}

        {/* Sync note */}
        {!isRestDay && hasWorkout && (
          <p className="text-xs text-center" style={{ color: 'rgba(255,255,255,0.17)' }}>
            Session data syncs to Notion · {program.name} W{today.week}D{today.day}
          </p>
        )}

      </div>
    </main>
  );
}
