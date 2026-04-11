import { useState } from 'react';
import { useTimerStore } from '../store/timerStore';
import TimerDisplay, { formatMs } from './TimerDisplay';

// ─── Post-fatigue labels (mirror PreWorkoutReadiness readiness labels) ─────────

const FATIGUE_LABELS: Record<number, string> = {
  0:  'None',       1: 'Minimal',   2: 'Very light',
  3:  'Light',      4: 'Mild',      5: 'Moderate',
  6:  'Noticeable', 7: 'High',      8: 'Very high',
  9:  'Exhausted', 10: 'Wrecked',
};

// ─── Post-fatigue dial ────────────────────────────────────────────────────────

function FatigueDial({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="w-full flex flex-col gap-3">
      {/* Label row */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium" style={{ color: 'var(--color-brand-text)' }}>
          How fatigued do you feel?
        </span>
        <div className="flex items-baseline gap-1.5">
          <span
            className="font-display font-bold tabular-nums"
            style={{
              fontSize: '1.3rem',
              color:
                value >= 8 ? 'var(--color-brand-tertiary)'
                : value >= 5 ? 'var(--color-brand-secondary)'
                : 'var(--color-brand-primary)',
            }}
          >
            {value}
          </span>
          <span className="text-xs" style={{ color: 'var(--color-brand-text-muted)' }}>
            &mdash;&nbsp;{FATIGUE_LABELS[value]}
          </span>
        </div>
      </div>

      {/* 0–10 tap grid */}
      <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(11, 1fr)' }}>
        {Array.from({ length: 11 }, (_, i) => {
          const isSelected = i === value;
          const accent =
            i >= 8 ? 'var(--color-brand-tertiary)'
            : i >= 5 ? 'var(--color-brand-secondary)'
            : 'var(--color-brand-primary)';
          const accentRgb =
            i >= 8 ? '255,132,129'
            : i >= 5 ? '254,178,70'
            : '169,229,187';

          return (
            <button
              key={i}
              onClick={() => onChange(i)}
              className="aspect-square rounded-xl flex items-center justify-center text-xs font-bold transition-all duration-150 active:scale-90"
              aria-label={`Post-fatigue ${i} — ${FATIGUE_LABELS[i]}`}
              aria-pressed={isSelected}
              style={{
                background: isSelected
                  ? accent
                  : i <= value
                  ? `rgba(${accentRgb},0.12)`
                  : 'rgba(255,255,255,0.05)',
                color: isSelected
                  ? '#120b18'
                  : i <= value
                  ? `rgba(${accentRgb},0.7)`
                  : 'var(--color-brand-text-muted)',
                border: isSelected ? 'none' : '1px solid rgba(255,255,255,0.07)',
                boxShadow: isSelected ? `0 0 16px rgba(${accentRgb},0.28)` : 'none',
                fontWeight: isSelected ? 800 : 600,
              }}
            >
              {i}
            </button>
          );
        })}
      </div>

      {/* Band labels */}
      <div className="flex justify-between px-0.5" aria-hidden="true">
        <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'rgba(169,229,187,0.45)' }}>
          Fresh
        </span>
        <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'rgba(254,178,70,0.4)' }}>
          Moderate
        </span>
        <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'rgba(255,132,129,0.45)' }}>
          Wrecked
        </span>
      </div>
    </div>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function WorkoutComplete() {
  const sessionResult    = useTimerStore((s) => s.sessionResult);
  const endSession       = useTimerStore((s) => s.endSession);
  const mode             = useTimerStore((s) => s.mode);
  const evalContext      = useTimerStore((s) => s.evalContext);
  const activeWorkoutId  = useTimerStore((s) => s.activeWorkoutId);

  const [postFatigue, setPostFatigue] = useState(5);
  const [syncing,     setSyncing]     = useState(false);

  const sessionWallElapsed_ms = useTimerStore((s) => s.sessionWallElapsed_ms);
  const sessionIdleTime_ms    = useTimerStore((s) => s.sessionIdleTime_ms);

  const durationMs      = sessionResult?.duration_ms     ?? 0;
  const stepsCompleted  = sessionResult?.steps_completed ?? 0;
  const stepsSkipped    = sessionResult?.steps_skipped   ?? 0;
  const completionRatio = stepsCompleted / Math.max(1, stepsCompleted + stepsSkipped);

  const displayElapsed = sessionWallElapsed_ms ?? durationMs;
  const { main: idleFormatted } = formatMs(sessionIdleTime_ms ?? 0);

  // readiness was set by PreWorkoutReadiness before the session started
  const preReadiness = evalContext?.readiness ?? null;

  const isPresetMode = mode === 'preset';

  async function handleDone() {
    if (isPresetMode && sessionResult && activeWorkoutId) {
      setSyncing(true);
      try {
        const { queueSessionForSync } = await import('../lib/sync');
        await queueSessionForSync({
          workout_id:          activeWorkoutId,
          date:                new Date(sessionResult.completed_at).toISOString(),
          pre_readiness_score: preReadiness ?? 5,
          post_fatigue_score:  postFatigue,
          completion_ratio:    Math.round(completionRatio * 100) / 100,
          duration_ms:         durationMs,
        });
      } catch (err) {
        // Sync failure is non-blocking — session data is queued in IDB
        console.warn('[sync] queueSessionForSync failed:', err);
      } finally {
        setSyncing(false);
      }
    }

    endSession();
  }

  return (
    <div className="min-h-screen flex flex-col items-center px-6 pb-10 pt-24">
      {/* Ambient glow */}
      <div
        className="pointer-events-none fixed inset-0"
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(ellipse 60% 40% at 50% 40%, rgba(169,229,187,0.1) 0%, transparent 65%)',
        }}
      />

      <div className="w-full max-w-sm flex flex-col items-center gap-7 text-center relative">

        {/* Done badge */}
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{
            background: 'rgba(169,229,187,0.12)',
            border:     '2px solid var(--color-brand-primary)',
            boxShadow:  '0 0 60px rgba(169,229,187,0.2)',
          }}
        >
          <svg
            width="36" height="36" viewBox="0 0 24 24" fill="none"
            stroke="var(--color-brand-primary)" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        <div className="space-y-2">
          <h1
            className="font-display text-3xl font-bold tracking-tight"
            style={{ color: 'var(--color-brand-text)' }}
          >
            Workout Complete
          </h1>
          <p className="text-sm" style={{ color: 'var(--color-brand-text-muted)' }}>
            Great work. Here&rsquo;s your session summary.
          </p>
        </div>

        {/* Elapsed time (wall-clock, never paused) */}
        <TimerDisplay ms={displayElapsed} size="lg" dimmed={false} />

        {/* Stats grid */}
        <div className="w-full grid grid-cols-2 gap-3">
          {[
            {
              label: 'Exercises Done',
              value: String(stepsCompleted),
              color: 'var(--color-brand-primary)',
            },
            {
              label: 'Idle Time',
              value: idleFormatted,
              color: sessionIdleTime_ms && sessionIdleTime_ms > 0
                ? 'var(--color-brand-secondary)'
                : 'var(--color-brand-text-muted)',
            },
            ...(mode === 'stopwatch' && sessionResult?.laps
              ? [{ label: 'Laps', value: String(sessionResult.laps.length), color: 'var(--color-brand-secondary)' }]
              : []),
            // Show pre-readiness in the grid if it was recorded
            ...(preReadiness !== null
              ? [{ label: 'Pre-Readiness', value: String(preReadiness), color: 'rgba(169,229,187,0.7)' }]
              : []),
          ].map(({ label, value, color }) => (
            <div
              key={label}
              className="flex flex-col items-center gap-1.5 py-4 rounded-2xl"
              style={{
                background: 'rgba(35,24,38,0.8)',
                border:     '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <span className="font-display text-3xl font-bold" style={{ color }}>
                {value}
              </span>
              <span
                className="text-[10px] font-bold uppercase tracking-widest"
                style={{ color: 'var(--color-brand-text-muted)' }}
              >
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Post-fatigue dial — only for preset sessions that will be synced */}
        {isPresetMode && activeWorkoutId && (
          <div
            className="w-full text-left rounded-2xl px-4 py-4"
            style={{
              background: 'rgba(35,24,38,0.8)',
              border:     '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <FatigueDial value={postFatigue} onChange={setPostFatigue} />
          </div>
        )}

        {/* Sync note — only shown for preset sessions */}
        {isPresetMode && activeWorkoutId && (
          <p className="text-xs text-center" style={{ color: 'rgba(255,255,255,0.2)' }}>
            Session data will sync to your Notion workspace.
          </p>
        )}

        {/* Actions */}
        <div className="w-full flex flex-col gap-3">
          <button
            onClick={handleDone}
            disabled={syncing}
            className="w-full py-4 rounded-2xl font-bold text-sm uppercase tracking-widest transition-all duration-300 active:scale-[0.98] disabled:opacity-70"
            style={{
              background: 'var(--color-brand-primary)',
              color:      '#120b18',
              boxShadow:  '0 0 40px rgba(169,229,187,0.25)',
            }}
          >
            {syncing ? 'Saving…' : 'Done'}
          </button>

          <button
            onClick={async () => {
              const { generateWorkoutRecap, shareSession } = await import('../lib/share');
              const text = generateWorkoutRecap(
                'Today\'s Session', // In a full app, we'd pull the real workout name
                sessionResult!,
                preReadiness,
                postFatigue
              );
              await shareSession({
                title: 'My Galawgaw Workout',
                text
              });
            }}
            className="w-full py-4 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all border border-white/10 text-white/60 active:bg-white/5"
          >
            Share Recap
          </button>
        </div>
      </div>
    </div>
  );
}
