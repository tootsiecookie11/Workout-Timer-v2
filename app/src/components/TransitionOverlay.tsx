import { useTimerStore } from '../store/timerStore';

/**
 * Full-screen overlay that appears between steps and during 3-2-1 countdown.
 * Non-dismissible during countdown (PRD §5.7).
 */
export default function TransitionOverlay() {
  const countdownSeconds = useTimerStore((s) => s.countdownSeconds);
  const transitionVisible = useTimerStore((s) => s.transitionVisible);
  const transitionToStep = useTimerStore((s) => s.transitionToStep);
  const engineState = useTimerStore((s) => s.engineState);

  const showCountdown = engineState === 'COUNTDOWN' && countdownSeconds !== null;
  const showTransition = transitionVisible && transitionToStep !== null && !showCountdown;

  if (!showCountdown && !showTransition) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col items-center justify-center"
      style={{
        background: showCountdown
          ? 'rgba(45,30,47,0.97)'
          : 'rgba(45,30,47,0.85)',
        backdropFilter: 'blur(8px)',
        animation: 'overlayIn 0.2s ease-out',
      }}
      role="status"
      aria-live="assertive"
    >
      <style>{`
        @keyframes overlayIn {
          from { opacity: 0; transform: scale(0.97); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes countdownPop {
          0%   { transform: scale(0.6); opacity: 0; }
          60%  { transform: scale(1.05); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      {showCountdown && (
        <div className="flex flex-col items-center gap-6">
          <span
            key={countdownSeconds}
            className="font-display font-light select-none tabular-nums"
            style={{
              fontSize: 'clamp(7rem, 30vw, 18rem)',
              lineHeight: 1,
              color: 'var(--color-brand-primary)',
              textShadow: '0 0 80px rgba(169,229,187,0.45)',
              animation: 'countdownPop 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards',
            }}
          >
            {countdownSeconds}
          </span>
          <p
            className="text-xs font-bold uppercase tracking-[0.3em]"
            style={{ color: 'rgba(169,229,187,0.5)' }}
          >
            Get Ready
          </p>
        </div>
      )}

      {showTransition && transitionToStep && (
        <div className="flex flex-col items-center gap-4 px-8 text-center">
          <span
            className="text-[10px] font-bold uppercase tracking-[0.3em] mb-2"
            style={{ color: 'var(--color-brand-text-muted)' }}
          >
            {transitionToStep.type === 'rest' ? 'Rest' : 'Next Up'}
          </span>
          <p
            className="font-display font-bold leading-tight"
            style={{
              fontSize: 'clamp(2rem, 8vw, 4rem)',
              color: transitionToStep.type === 'rest'
                ? 'var(--color-brand-secondary)'
                : 'var(--color-brand-text)',
            }}
          >
            {transitionToStep.label}
          </p>
          {transitionToStep.duration_ms > 0 && (
            <span
              className="text-sm font-medium"
              style={{ color: 'var(--color-brand-text-muted)' }}
            >
              {Math.round(transitionToStep.duration_ms / 1000)}s
            </span>
          )}
        </div>
      )}
    </div>
  );
}
