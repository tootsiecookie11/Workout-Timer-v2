import { useEffect, useState } from 'react';
import { useTimerStore } from '../store/timerStore';
import TimerDisplay, { formatMs } from './TimerDisplay';
import { useNotionPoller } from '../hooks/useNotionPoller';
import type { WorkoutStep } from '../engine/types';

// ─── Sub-components ────────────────────────────────────────────────────────────

function StepTypeChip({ type }: { type: string }) {
  const isRest = type === 'rest';
  return (
    <span
      className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest"
      style={{
        background: isRest ? 'rgba(254,178,70,0.1)' : 'rgba(169,229,187,0.1)',
        color:      isRest ? 'var(--color-brand-secondary)' : 'var(--color-brand-primary)',
        border:     `1px solid ${isRest ? 'rgba(254,178,70,0.2)' : 'rgba(169,229,187,0.2)'}`,
      }}
    >
      {isRest ? 'Rest' : 'Work'}
    </span>
  );
}

/**
 * Segmented progress bar.
 * Past pills: filled, dimmed.
 * Active pill: full-width blinking gradient (no fill-tracking — same height as siblings).
 * Future pills: ghosted.
 */
function SegmentedProgressBar({
  steps,
  currentIndex,
}: {
  steps: WorkoutStep[];
  currentIndex: number;
}) {
  const MAX_VISIBLE = 28;
  const visible = steps.slice(0, MAX_VISIBLE);
  const extra   = steps.length - MAX_VISIBLE;

  return (
    <div className="flex items-center gap-[3px] w-full">
      <style>{`
        @keyframes activePillBlink {
          0%, 100% { opacity: 0.55; }
          50%       { opacity: 1;   }
        }
      `}</style>

      {visible.map((step, i) => {
        const isPast   = i < currentIndex;
        const isActive = i === currentIndex;
        const isRest   = step.type === 'rest';
        const activeColor = isRest ? '#FEB246' : '#A9E5BB';
        const pastColor   = isRest ? 'rgba(254,178,70,0.30)' : 'rgba(169,229,187,0.30)';
        const futureColor = 'rgba(255,255,255,0.08)';

        return (
          <div
            key={i}
            className="flex-1 rounded-full"
            style={{
              height:     5,
              background: isPast
                ? pastColor
                : isActive
                ? `linear-gradient(90deg, ${activeColor}66, ${activeColor})`
                : futureColor,
              boxShadow:  isActive ? `0 0 8px ${activeColor}88` : 'none',
              animation:  isActive ? 'activePillBlink 1.4s ease-in-out infinite' : 'none',
              transition: 'background 0.25s, box-shadow 0.25s',
            }}
          />
        );
      })}

      {extra > 0 && (
        <span
          className="text-[9px] ml-1 shrink-0 tabular-nums"
          style={{ color: 'var(--color-brand-text-muted)' }}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}

/** Label on top, value below. */
function StatCell({
  label,
  value,
  align = 'center',
}: {
  label: string;
  value: string;
  align?: 'left' | 'center' | 'right';
}) {
  const alignClass =
    align === 'left'  ? 'items-start'  :
    align === 'right' ? 'items-end'    :
                        'items-center';
  return (
    <div className={`flex flex-col gap-[3px] ${alignClass}`}>
      <span
        className="text-[9px] font-bold uppercase tracking-[0.18em]"
        style={{ color: 'var(--color-brand-text-muted)' }}
      >
        {label}
      </span>
      <span
        className="text-sm font-bold tabular-nums"
        style={{ color: 'var(--color-brand-text)' }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Control button ────────────────────────────────────────────────────────────

function SmallBtn({
  onClick,
  disabled,
  label,
  danger,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-90 disabled:opacity-25"
      style={{
        background: danger ? 'rgba(255,132,129,0.1)' : 'rgba(255,255,255,0.06)',
        border:     danger
          ? '1px solid rgba(255,132,129,0.22)'
          : '1px solid rgba(255,255,255,0.09)',
        color: danger ? 'var(--color-brand-tertiary)' : 'var(--color-brand-text-muted)',
      }}
    >
      {children}
    </button>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function WorkoutRuntime() {
  const isDirty         = useNotionPoller();
  const currentStep     = useTimerStore((s) => s.currentStep);
  const nextStepLabel   = useTimerStore((s) => s.nextStepLabel);
  const remaining_ms    = useTimerStore((s) => s.remaining_ms);
  const elapsed_ms      = useTimerStore((s) => s.elapsed_ms);
  const progress        = useTimerStore((s) => s.progress);
  const stepIndex       = useTimerStore((s) => s.stepIndex);
  const totalSteps      = useTimerStore((s) => s.totalSteps);
  const engineState     = useTimerStore((s) => s.engineState);
  const stepQueue       = useTimerStore((s) => s.stepQueue);
  const sessionStartedAt = useTimerStore((s) => s.sessionStartedAt);

  const pauseSession  = useTimerStore((s) => s.pauseSession);
  const resumeSession = useTimerStore((s) => s.resumeSession);
  const skipStep      = useTimerStore((s) => s.skipStep);
  const prevStep      = useTimerStore((s) => s.prevStep);
  const endSession    = useTimerStore((s) => s.endSession);

  // Settings for status indicators
  const enableVoice = useSettingsStore(s => s.enableVoiceCues);
  const enableHaptics = useSettingsStore(s => s.enableHaptics);

  const isPaused = engineState === 'PAUSED';
  const isRest   = currentStep?.type === 'rest';

  // Round info from step meta
  const round       = currentStep?.meta.round;
  const totalRounds = currentStep?.meta.total_rounds;
  const showRound   = round !== undefined && totalRounds !== undefined && totalRounds > 1;

  const accentColor = isRest ? 'var(--color-brand-secondary)' : 'var(--color-brand-primary)';

  // ── Wall-clock elapsed ──────────────────────────────────────────────────────
  // Ticks every 100 ms via a local interval. Never pauses — keeps running
  // through pause, prev-step, and next-step navigation.
  const [wallElapsed, setWallElapsed] = useState(0);

  useEffect(() => {
    if (!sessionStartedAt) {
      setWallElapsed(0);
      return;
    }
    // Tick immediately so there's no 100 ms blank at start
    setWallElapsed(Date.now() - sessionStartedAt);
    const id = setInterval(() => {
      setWallElapsed(Date.now() - sessionStartedAt);
    }, 100);
    return () => clearInterval(id);
  }, [sessionStartedAt]);

  const { main: elapsedFormatted } = formatMs(wallElapsed);

  // The segmented bar uses the full flat step queue; fall back to the current
  // step alone for graph sessions (which have no flat queue).
  const barSteps: WorkoutStep[] =
    stepQueue.length > 0 ? stepQueue : currentStep ? [currentStep] : [];

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--color-brand-bg)' }}
    >
      {/* Ambient glow */}
      <div
        className="pointer-events-none fixed inset-0 transition-all duration-1000"
        aria-hidden="true"
        style={{
          background: isRest
            ? 'radial-gradient(ellipse 60% 40% at 50% 38%, rgba(254,178,70,0.07) 0%, transparent 70%)'
            : 'radial-gradient(ellipse 60% 40% at 50% 38%, rgba(169,229,187,0.08) 0%, transparent 70%)',
        }}
      />

      {/* ── TOP: segmented bar + stats row ──────────────────────────────── */}
      <div className="relative z-10 px-5 pt-12 pb-3 flex flex-col gap-4">
        <SegmentedProgressBar steps={barSteps} currentIndex={stepIndex} />

        {/* Stats: Elapsed | Steps | Rounds */}
        <div className="flex items-start justify-between px-0.5">
          <StatCell label="Elapsed" value={elapsedFormatted} align="left" />
          <StatCell label="Steps"   value={`${stepIndex + 1} / ${totalSteps}`} />
          <StatCell
            label="Rounds"
            value={showRound ? `${round} / ${totalRounds}` : '—'}
            align="right"
          />
        </div>

        {/* Status Indicators: Audio | Haptics */}
        <div 
          className="flex items-center gap-3 px-1 mt-[-4px]"
          style={{ opacity: 0.5 }}
        >
          <div className="flex items-center gap-1">
            <svg 
              width="10" height="10" viewBox="0 0 24 24" 
              fill={enableVoice ? 'var(--color-brand-primary)' : 'currentColor'}
              style={{ color: enableVoice ? 'var(--color-brand-primary)' : 'rgba(255,255,255,0.2)' }}
            >
              <path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3zm-1 16.93A8.001 8.001 0 0 1 4.07 11h2.02A5.999 5.999 0 0 0 18 11h2.02A8.001 8.001 0 0 1 13 18.93V21h-2v-2.07z" />
            </svg>
            <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: enableVoice ? 'var(--color-brand-primary)' : 'rgba(255,255,255,0.2)' }}>
              {enableVoice ? 'Voice On' : 'Voice Off'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <svg 
              width="10" height="10" viewBox="0 0 24 24" 
              fill={enableHaptics ? 'var(--color-brand-primary)' : 'currentColor'}
              style={{ color: enableHaptics ? 'var(--color-brand-primary)' : 'rgba(255,255,255,0.2)' }}
            >
              <path d="M13.5 1.5C13.5.67 12.83 0 12 0s-1.5.67-1.5 1.5v4.25L8.5 3.25c-.59-.59-1.54-.59-2.12 0-.59.59-.59 1.54 0 2.12l5.24 5.24c.29.29.67.44 1.06.44h4.5c.83 0 1.5-.67 1.5-1.5v-3c0-.83-.67-1.5-1.5-1.5h-1.5V3.75c0-.83-.67-1.5-1.5-1.5H13.5V1.5zm-7 15v4c0 .83.67 1.5 1.5 1.5h6c.83 0 1.5-.67 1.5-1.5v-3c0-.83-.67-1.5-1.5-1.5h-1.5v-1.75c0-.83-.67-1.5-1.5-1.5-.83 0-1.5.67-1.5 1.5V15h-.5c-.83 0-1.5.67-1.5 1.5z" />
            </svg>
            <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: enableHaptics ? 'var(--color-brand-primary)' : 'rgba(255,255,255,0.2)' }}>
              {enableHaptics ? 'Haptics' : 'Silent'}
            </span>
          </div>
        </div>
      </div>

      {/* ── CENTER: step name → timer → progress line → next step ───────── */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center gap-5 px-6">
        <StepTypeChip type={currentStep?.type ?? 'exercise'} />

        <h1
          className="font-display font-bold leading-tight text-center"
          style={{
            fontSize: 'clamp(2rem, 9vw, 4.5rem)',
            color:    'var(--color-brand-text)',
          }}
        >
          {currentStep?.label ?? '—'}
        </h1>

        <style>{`
          @keyframes pausePulse {
            0%, 100% { opacity: 0.3; }
            50%       { opacity: 0.8; }
          }
        `}</style>
        {isPaused && (
          <span
            className="font-display font-bold uppercase"
            style={{
              fontSize:      '0.65rem',
              letterSpacing: '0.35em',
              color:         'var(--color-brand-text-muted)',
              animation:     'pausePulse 2s ease-in-out infinite',
            }}
            aria-live="polite"
          >
            Paused
          </span>
        )}

        {/* Big countdown / step-elapsed */}
        <TimerDisplay
          ms={currentStep?.duration_ms === 0 ? elapsed_ms : remaining_ms}
          size="xl"
          glowColor={accentColor}
          dimmed={isPaused}
        />

        {/* Step-level progress line */}
        {currentStep && currentStep.duration_ms > 0 && (
          <div
            className="w-full max-w-xs h-1 rounded-full overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.06)' }}
          >
            <div
              className="h-full rounded-full transition-all duration-100"
              style={{
                width:      `${progress * 100}%`,
                background: accentColor,
                boxShadow:  `0 0 8px ${accentColor}`,
              }}
            />
          </div>
        )}

        {nextStepLabel && (
          <p
            className="text-sm font-medium"
            style={{ color: 'var(--color-brand-text-muted)' }}
          >
            Next:{' '}
            <span style={{ color: 'var(--color-brand-text)' }}>{nextStepLabel}</span>
          </p>
        )}
      </div>

      {/* ── BOTTOM: dirty toast + controls ──────────────────────────────── */}
      <div className="relative z-10 flex flex-col items-center gap-5 px-5 pb-10">
        {isDirty && (
          <div
            className="w-full max-w-sm rounded-xl p-3 flex items-center gap-3"
            style={{
              background: 'rgba(255,132,129,0.15)',
              border:     '1px solid var(--color-brand-tertiary)',
              color:      'var(--color-brand-tertiary)',
            }}
          >
            <svg
              width="18" height="18" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9"  x2="12"   y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div className="flex flex-col text-left">
              <span className="text-sm font-bold uppercase tracking-wider">Reload Required</span>
              <span className="text-xs opacity-80">Workout updated in Notion</span>
            </div>
          </div>
        )}

        {/* Controls: Previous | Play/Pause | Stop | Next */}
        <div className="flex items-center justify-center gap-4">
          <SmallBtn onClick={prevStep} disabled={stepIndex === 0} label="Previous step">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
            </svg>
          </SmallBtn>

          {/* Play / Pause — large center */}
          <button
            onClick={isPaused ? resumeSession : pauseSession}
            aria-label={isPaused ? 'Resume' : 'Pause'}
            className="w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 active:scale-90"
            style={
              isPaused
                ? {
                    background: accentColor,
                    color:      '#120b18',
                    boxShadow:  `0 0 44px color-mix(in srgb, ${accentColor} 40%, transparent)`,
                  }
                : {
                    background: 'rgba(169,229,187,0.08)',
                    border:     `2px solid ${accentColor}`,
                    color:      accentColor,
                  }
            }
          >
            {isPaused ? (
              <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            ) : (
              <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            )}
          </button>

          <SmallBtn onClick={endSession} label="End session" danger>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="5" y="5" width="14" height="14" rx="2" />
            </svg>
          </SmallBtn>

          <SmallBtn onClick={skipStep} label="Next step">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z" />
            </svg>
          </SmallBtn>
        </div>
      </div>
    </div>
  );
}
