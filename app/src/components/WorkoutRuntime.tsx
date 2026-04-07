import { useTimerStore } from '../store/timerStore';
import TimerDisplay from './TimerDisplay';

function StepTypeChip({ type }: { type: string }) {
  const isRest = type === 'rest';
  return (
    <span
      className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest"
      style={{
        background: isRest ? 'rgba(254,178,70,0.1)' : 'rgba(169,229,187,0.1)',
        color: isRest ? 'var(--color-brand-secondary)' : 'var(--color-brand-primary)',
        border: `1px solid ${isRest ? 'rgba(254,178,70,0.2)' : 'rgba(169,229,187,0.2)'}`,
      }}
    >
      {isRest ? 'Rest' : 'Work'}
    </span>
  );
}

export default function WorkoutRuntime() {
  const currentStep = useTimerStore((s) => s.currentStep);
  const nextStepLabel = useTimerStore((s) => s.nextStepLabel);
  const remaining_ms = useTimerStore((s) => s.remaining_ms);
  const elapsed_ms = useTimerStore((s) => s.elapsed_ms);
  const progress = useTimerStore((s) => s.progress);
  const stepIndex = useTimerStore((s) => s.stepIndex);
  const totalSteps = useTimerStore((s) => s.totalSteps);
  const engineState = useTimerStore((s) => s.engineState);
  const stepQueue = useTimerStore((s) => s.stepQueue);
  const pauseSession = useTimerStore((s) => s.pauseSession);
  const resumeSession = useTimerStore((s) => s.resumeSession);
  const skipStep = useTimerStore((s) => s.skipStep);
  const endSession = useTimerStore((s) => s.endSession);

  const isPaused = engineState === 'PAUSED';
  const isRest = currentStep?.type === 'rest';

  // Round info from meta
  const round = currentStep?.meta.round;
  const totalRounds = currentStep?.meta.total_rounds;
  const showRound = round !== undefined && totalRounds !== undefined && totalRounds > 1;

  return (
    <div className="min-h-screen flex flex-col pt-20 pb-8 px-5">
      {/* Ambient glow — changes color for rest vs work */}
      <div
        className="pointer-events-none fixed inset-0 transition-all duration-1000"
        aria-hidden="true"
        style={{
          background: isRest
            ? 'radial-gradient(ellipse 55% 35% at 50% 40%, rgba(254,178,70,0.06) 0%, transparent 70%)'
            : 'radial-gradient(ellipse 55% 35% at 50% 40%, rgba(169,229,187,0.07) 0%, transparent 70%)',
        }}
      />

      {/* Step progress bar (top) */}
      <div
        className="fixed top-0 left-0 right-0 h-0.5 z-50"
        style={{ background: 'rgba(255,255,255,0.06)' }}
      >
        <div
          className="h-full transition-all duration-100"
          style={{
            width: `${(stepIndex / Math.max(totalSteps - 1, 1)) * 100}%`,
            background: 'var(--color-brand-primary)',
            boxShadow: '0 0 8px var(--color-brand-primary)',
          }}
        />
      </div>

      {/* Step counter */}
      <div className="flex items-center justify-between pt-14 px-1 mb-4">
        <span
          className="text-xs font-bold uppercase tracking-widest"
          style={{ color: 'var(--color-brand-text-muted)' }}
        >
          Step {stepIndex + 1} / {totalSteps}
        </span>
        {showRound && (
          <span
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: 'var(--color-brand-text-muted)' }}
          >
            Round {round} / {totalRounds}
          </span>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 relative">
        {/* Step type + label */}
        <div className="flex flex-col items-center gap-3 text-center">
          <StepTypeChip type={currentStep?.type ?? 'exercise'} />
          <h1
            className="font-display font-bold leading-tight"
            style={{
              fontSize: 'clamp(1.75rem, 7vw, 3.5rem)',
              color: 'var(--color-brand-text)',
            }}
          >
            {currentStep?.label ?? '—'}
          </h1>
        </div>

        {/* Timer */}
        <TimerDisplay
          ms={currentStep?.duration_ms === 0 ? elapsed_ms : remaining_ms}
          size="xl"
          glowColor={isRest ? 'var(--color-brand-secondary)' : 'var(--color-brand-primary)'}
        />

        {/* Progress arc (step-level) */}
        {currentStep && currentStep.duration_ms > 0 && (
          <div
            className="w-full max-w-xs h-1 rounded-full overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.06)' }}
          >
            <div
              className="h-full rounded-full transition-all duration-100"
              style={{
                width: `${progress * 100}%`,
                background: isRest ? 'var(--color-brand-secondary)' : 'var(--color-brand-primary)',
                boxShadow: isRest
                  ? '0 0 8px var(--color-brand-secondary)'
                  : '0 0 8px var(--color-brand-primary)',
              }}
            />
          </div>
        )}

        {/* Next up */}
        {nextStepLabel && (
          <p
            className="text-xs font-medium"
            style={{ color: 'var(--color-brand-text-muted)' }}
          >
            Next: <span style={{ color: 'var(--color-brand-text)' }}>{nextStepLabel}</span>
          </p>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-6 pt-4">
        {/* End session */}
        <button
          onClick={endSession}
          className="w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-90"
          style={{
            background: 'rgba(255,132,129,0.1)',
            border: '1px solid rgba(255,132,129,0.2)',
            color: 'var(--color-brand-tertiary)',
          }}
          aria-label="End session"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>

        {/* Pause / Resume (large center) */}
        <button
          onClick={isPaused ? resumeSession : pauseSession}
          className="w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 active:scale-90"
          style={
            isPaused
              ? {
                  background: 'var(--color-brand-primary)',
                  color: '#120b18',
                  boxShadow: '0 0 40px rgba(169,229,187,0.35)',
                }
              : {
                  background: 'rgba(169,229,187,0.1)',
                  border: '2px solid var(--color-brand-primary)',
                  color: 'var(--color-brand-primary)',
                }
          }
          aria-label={isPaused ? 'Resume' : 'Pause'}
        >
          {isPaused ? (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          ) : (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          )}
        </button>

        {/* Skip */}
        <button
          onClick={skipStep}
          className="w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-90"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'var(--color-brand-text-muted)',
          }}
          aria-label="Skip step"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z" />
          </svg>
        </button>
      </div>

      {/* Mini step queue preview */}
      {stepQueue.length > 0 && (
        <div className="mt-6 overflow-x-auto no-scrollbar">
          <div className="flex gap-2 px-1">
            {stepQueue.slice(0, 12).map((step, i) => (
              <div
                key={step.step_index}
                className="flex-shrink-0 w-8 h-1.5 rounded-full"
                style={{
                  background:
                    i === stepIndex
                      ? 'var(--color-brand-primary)'
                      : i < stepIndex
                      ? 'rgba(169,229,187,0.25)'
                      : step.type === 'rest'
                      ? 'rgba(254,178,70,0.25)'
                      : 'rgba(255,255,255,0.1)',
                }}
              />
            ))}
            {stepQueue.length > 12 && (
              <span className="text-[10px] self-center" style={{ color: 'var(--color-brand-text-muted)' }}>
                +{stepQueue.length - 12}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
