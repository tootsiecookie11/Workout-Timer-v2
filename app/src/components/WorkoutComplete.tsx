import { useTimerStore } from '../store/timerStore';
import TimerDisplay from './TimerDisplay';

export default function WorkoutComplete() {
  const sessionResult = useTimerStore((s) => s.sessionResult);
  const endSession = useTimerStore((s) => s.endSession);
  const mode = useTimerStore((s) => s.mode);

  const durationMs = sessionResult?.duration_ms ?? 0;
  const stepsCompleted = sessionResult?.steps_completed ?? 0;
  const stepsSkipped = sessionResult?.steps_skipped ?? 0;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 pb-10 pt-24">
      {/* Confetti-esque ambient */}
      <div
        className="pointer-events-none fixed inset-0"
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(ellipse 60% 40% at 50% 40%, rgba(169,229,187,0.1) 0%, transparent 65%)',
        }}
      />

      <div className="w-full max-w-sm flex flex-col items-center gap-8 text-center relative">
        {/* Done badge */}
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{
            background: 'rgba(169,229,187,0.12)',
            border: '2px solid var(--color-brand-primary)',
            boxShadow: '0 0 60px rgba(169,229,187,0.2)',
          }}
        >
          <svg
            width="36"
            height="36"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-brand-primary)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
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
            Great work. Here's your session summary.
          </p>
        </div>

        {/* Total time */}
        <TimerDisplay ms={durationMs} size="lg" dimmed={false} />

        {/* Stats grid */}
        <div
          className="w-full grid grid-cols-2 gap-3"
          style={{}}
        >
          {[
            {
              label: 'Steps Done',
              value: stepsCompleted,
              color: 'var(--color-brand-primary)',
            },
            {
              label: 'Steps Skipped',
              value: stepsSkipped,
              color: stepsSkipped > 0 ? 'var(--color-brand-tertiary)' : 'var(--color-brand-text-muted)',
            },
            ...(mode === 'stopwatch' && sessionResult?.laps
              ? [
                  {
                    label: 'Laps',
                    value: sessionResult.laps.length,
                    color: 'var(--color-brand-secondary)',
                  },
                ]
              : []),
          ].map(({ label, value, color }) => (
            <div
              key={label}
              className="flex flex-col items-center gap-1.5 py-4 rounded-2xl"
              style={{
                background: 'rgba(35,24,38,0.8)',
                border: '1px solid rgba(255,255,255,0.06)',
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

        {/* Actions */}
        <div className="w-full flex flex-col gap-3">
          <button
            onClick={() => {
              if (mode === 'preset' && sessionResult) {
                // Workstream 3: Queue session for offline IndexedDB sync
                import('../lib/sync').then(({ queueSessionForSync }) => {
                  queueSessionForSync({
                    workout_id: 'active_workout_placeholder_id', // Would come from selected workout metadata
                    date: new Date().toISOString(),
                    pre_readiness_score: 5, // Placeholder, would come from pre-workout modal
                    post_fatigue_score: 7,  // Placeholder
                    completion_ratio: Math.round((stepsCompleted / Math.max(1, stepsCompleted + stepsSkipped)) * 100)
                  });
                });
              }
              endSession();
            }}
            className="w-full py-4 rounded-2xl font-bold text-sm uppercase tracking-widest transition-all duration-300 active:scale-98"
            style={{
              background: 'var(--color-brand-primary)',
              color: '#120b18',
              boxShadow: '0 0 40px rgba(169,229,187,0.25)',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
