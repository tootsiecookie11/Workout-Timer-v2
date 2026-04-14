import { useTimerStore } from '../store/timerStore';
import TimerDisplay from './TimerDisplay';
import type { LapRecord } from '../engine/types';
import { classifyFatigue, recommendedRestHours } from '../engine/fatigueEngine';

function formatSplit(ms: number): string {
  const s = Math.floor(ms / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// ─── Readiness Score Card ─────────────────────────────────────────────────────

function ReadinessScoreCard({ score }: { score: number }) {
  const category  = classifyFatigue(score);
  const isHigh    = score >= 7;
  const isMid     = score >= 5;
  const accentRgb = isHigh ? '255,132,129' : isMid ? '254,178,70' : '169,229,187';
  const accent    = isHigh
    ? 'var(--color-brand-tertiary)'
    : isMid
    ? 'var(--color-brand-secondary)'
    : 'var(--color-brand-primary)';
  const tagline   = isHigh
    ? 'Take it easy today'
    : isMid
    ? 'Moderate effort recommended'
    : "You're ready to train";

  return (
    <div
      className="flex items-center gap-4 px-4 py-3 rounded-2xl"
      style={{
        background: `rgba(${accentRgb},0.06)`,
        border:     `1px solid rgba(${accentRgb},0.14)`,
      }}
    >
      {/* Left: labels */}
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <span
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: `rgba(${accentRgb},0.5)` }}
        >
          Session Readiness
        </span>
        <div className="flex items-baseline gap-2">
          <span
            className="font-display font-bold capitalize"
            style={{ fontSize: '1.25rem', color: accent }}
          >
            {category}
          </span>
          <span className="text-[11px]" style={{ color: `rgba(${accentRgb},0.5)` }}>
            {score.toFixed(1)} fatigue
          </span>
        </div>
        <span className="text-[11px]" style={{ color: 'var(--color-brand-text-muted)' }}>
          {tagline}
        </span>
      </div>

      {/* Right: rest recommendation pill */}
      <div
        className="flex flex-col items-center gap-0.5 flex-shrink-0 px-3 py-2 rounded-xl"
        style={{ background: `rgba(${accentRgb},0.08)` }}
      >
        <span
          className="font-display font-bold tabular-nums"
          style={{ fontSize: '1.05rem', color: accent }}
        >
          {recommendedRestHours(score)}h
        </span>
        <span
          className="text-[9px] font-bold uppercase tracking-wider text-center"
          style={{ color: `rgba(${accentRgb},0.45)`, lineHeight: 1.2 }}
        >
          rec&rsquo;d<br />rest
        </span>
      </div>
    </div>
  );
}

// ─── Lap row ──────────────────────────────────────────────────────────────────

function LapRow({ lap, isLatest }: { lap: LapRecord; isLatest: boolean }) {
  return (
    <div
      className="flex items-center justify-between py-3 px-4 rounded-xl"
      style={{
        background: isLatest ? 'rgba(169,229,187,0.07)' : 'rgba(255,255,255,0.03)',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}
    >
      <span
        className="text-xs font-bold uppercase tracking-widest"
        style={{ color: isLatest ? 'var(--color-brand-primary)' : 'var(--color-brand-text-muted)' }}
      >
        Lap {lap.lap_index + 1}
      </span>
      <span
        className="font-display text-sm tabular-nums"
        style={{ color: isLatest ? 'var(--color-brand-text)' : 'var(--color-brand-text-muted)' }}
      >
        {formatSplit(lap.split_ms)}
      </span>
      <span
        className="font-display text-sm tabular-nums"
        style={{ color: 'var(--color-brand-text-muted)' }}
      >
        {formatSplit(lap.elapsed_ms)}
      </span>
    </div>
  );
}

export default function StopwatchScreen() {
  const engineState    = useTimerStore((s) => s.engineState);
  const elapsed_ms     = useTimerStore((s) => s.elapsed_ms);
  const laps           = useTimerStore((s) => s.laps);
  const fatigueScore   = useTimerStore((s) => s.fatigueScore);
  const startStopwatch  = useTimerStore((s) => s.startStopwatch);
  const pauseStopwatch  = useTimerStore((s) => s.pauseStopwatch);
  const resumeStopwatch = useTimerStore((s) => s.resumeStopwatch);
  const resetStopwatch  = useTimerStore((s) => s.resetStopwatch);
  const lapStopwatch    = useTimerStore((s) => s.lapStopwatch);

  const isRunning  = engineState === 'ACTIVE';
  const isPaused   = engineState === 'PAUSED';
  const hasStarted = isRunning || isPaused;

  return (
    <div className="flex flex-col items-center min-h-screen pt-24 pb-10 px-6">
      {/* Ambient glow */}
      <div
        className="pointer-events-none fixed inset-0"
        aria-hidden="true"
        style={{
          background: 'radial-gradient(ellipse 60% 40% at 50% 45%, rgba(169,229,187,0.06) 0%, transparent 70%)',
        }}
      />

      {/* Timer */}
      <div className="flex-1 flex flex-col items-center justify-center gap-8">
        <TimerDisplay ms={elapsed_ms} showCs size="xl" />

        {/* Status badge */}
        <div
          className="flex items-center gap-2.5 px-6 py-2 rounded-full text-xs font-bold uppercase tracking-[0.18em]"
          style={{
            background: 'rgba(35, 24, 38, 0.8)',
            border: '1px solid rgba(255,255,255,0.06)',
            color: isRunning
              ? 'var(--color-brand-primary)'
              : isPaused
              ? 'var(--color-brand-secondary)'
              : 'var(--color-brand-text-muted)',
          }}
        >
          {isRunning && (
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: 'var(--color-brand-primary)' }}
            />
          )}
          {isRunning ? 'Running' : isPaused ? 'Paused' : 'Standby'}
        </div>
      </div>

      {/* Controls */}
      <div className="w-full max-w-sm space-y-6">
        {/* Primary action row */}
        <div className="flex items-center justify-center gap-8">
          {/* Lap / Reset (left) */}
          <button
            onClick={hasStarted ? lapStopwatch : undefined}
            disabled={!hasStarted}
            className="w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 active:scale-90"
            style={{
              background: hasStarted ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: hasStarted ? 'var(--color-brand-text)' : 'rgba(237,228,250,0.2)',
              cursor: hasStarted ? 'pointer' : 'default',
            }}
            aria-label="Lap"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11 2v2.07C7.06 4.56 4 7.92 4 12c0 4.42 3.58 8 8 8s8-3.58 8-8c0-3.92-2.82-7.19-6.56-7.87L15 2.57V2h-4zm2 0v2H9V2h4zM12 6c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6 2.69-6 6-6zm1 1h-2v5.25l4.5 2.67.75-1.23-3.25-1.92V7z" />
            </svg>
          </button>

          {/* Start / Pause (center — large) */}
          <button
            onClick={isRunning ? pauseStopwatch : isPaused ? resumeStopwatch : startStopwatch}
            className="w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 active:scale-90"
            style={{
              background: isRunning
                ? 'rgba(169,229,187,0.12)'
                : 'var(--color-brand-primary)',
              border: isRunning
                ? '2px solid var(--color-brand-primary)'
                : 'none',
              color: isRunning ? 'var(--color-brand-primary)' : '#120b18',
              boxShadow: isRunning
                ? '0 0 40px rgba(169,229,187,0.15)'
                : '0 0 40px rgba(169,229,187,0.35)',
            }}
            aria-label={isRunning ? 'Pause' : 'Start'}
          >
            {isRunning ? (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Reset (right) */}
          <button
            onClick={hasStarted ? resetStopwatch : undefined}
            disabled={!hasStarted}
            className="w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 active:scale-90"
            style={{
              background: hasStarted ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: hasStarted ? 'var(--color-brand-tertiary)' : 'rgba(237,228,250,0.2)',
              cursor: hasStarted ? 'pointer' : 'default',
            }}
            aria-label="Reset"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
            </svg>
          </button>
        </div>

        {/* Readiness card — shown on idle home state when session history exists */}
        {!hasStarted && fatigueScore > 0 && (
          <ReadinessScoreCard score={fatigueScore} />
        )}

        {/* Lap list */}
        {laps.length > 0 && (
          <div
            className="rounded-2xl overflow-hidden"
            style={{ background: 'rgba(35,24,38,0.7)', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <div
              className="flex justify-between px-4 py-2 text-[10px] font-bold uppercase tracking-widest"
              style={{ color: 'var(--color-brand-text-muted)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
            >
              <span>Lap</span>
              <span>Split</span>
              <span>Total</span>
            </div>
            <div className="max-h-56 overflow-y-auto">
              {[...laps].reverse().map((lap, i) => (
                <LapRow key={lap.lap_index} lap={lap} isLatest={i === 0} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
