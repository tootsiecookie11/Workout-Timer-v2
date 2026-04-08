import { useTimerStore } from '../store/timerStore';

// SVG ring that depletes over 1 second — keyed from parent to restart on each tick
const RING_R = 52;
const RING_CIRC = 2 * Math.PI * RING_R; // ≈ 326.73

function CountdownRing() {
  return (
    <svg
      width="140"
      height="140"
      className="absolute"
      style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}
      aria-hidden="true"
    >
      {/* Track */}
      <circle
        cx="70" cy="70" r={RING_R}
        fill="none"
        stroke="rgba(169,229,187,0.1)"
        strokeWidth="2.5"
      />
      {/* Depleting arc */}
      <circle
        cx="70" cy="70" r={RING_R}
        fill="none"
        stroke="var(--color-brand-primary)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={RING_CIRC}
        strokeDashoffset="0"
        transform="rotate(-90 70 70)"
        style={{
          animation: 'ringDeplete 1s linear forwards',
          filter: 'drop-shadow(0 0 5px rgba(169,229,187,0.45))',
        }}
      />
    </svg>
  );
}

/**
 * Immersive full-screen overlay system.
 *
 * COUNTDOWN  — 3-2-1 with SVG ring depletion + radiate rings + staggered "GET READY"
 * TRANSITION — color-aware ambient wash, blur-to-sharp name reveal, round dots,
 *              from-step ghost, directional accent hairlines
 *
 * Non-dismissible (PRD §5.7). Accessible via role="status" + aria-live="assertive".
 */
export default function TransitionOverlay() {
  const countdownSeconds   = useTimerStore((s) => s.countdownSeconds);
  const transitionVisible  = useTimerStore((s) => s.transitionVisible);
  const transitionToStep   = useTimerStore((s) => s.transitionToStep);
  const transitionFromStep = useTimerStore((s) => s.transitionFromStep);
  const transitionContext  = useTimerStore((s) => s.transitionContext);
  const engineState        = useTimerStore((s) => s.engineState);

  const showCountdown  = engineState === 'COUNTDOWN' && countdownSeconds !== null;
  const showTransition = transitionVisible && transitionToStep !== null && !showCountdown;

  if (!showCountdown && !showTransition) return null;

  const isToRest  = transitionContext === 'to-rest';
  const isToFirst = transitionContext === 'to-first';
  const accentColor = isToRest ? 'var(--color-brand-secondary)' : 'var(--color-brand-primary)';
  const accentRgb   = isToRest ? '254,178,70' : '169,229,187';

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col items-center justify-center overflow-hidden"
      style={{
        background: 'rgba(18,10,22,0.97)',
        backdropFilter: 'blur(14px)',
        animation: 'overlayIn 0.16s ease-out forwards',
      }}
      role="status"
      aria-live="assertive"
    >
      <style>{`
        @keyframes overlayIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }

        /* Countdown number — scale + blur pop */
        @keyframes countdownEnter {
          0%   { transform: scale(0.42); opacity: 0; filter: blur(12px); }
          55%  { transform: scale(1.07); opacity: 1; filter: blur(0); }
          100% { transform: scale(1);    opacity: 1; filter: blur(0); }
        }

        /* Pulse rings radiating from countdown center */
        @keyframes radiate {
          0%   { transform: scale(0.25); opacity: 0.65; }
          100% { transform: scale(4.2);  opacity: 0; }
        }

        /* SVG ring depletion */
        @keyframes ringDeplete {
          from { stroke-dashoffset: 0; }
          to   { stroke-dashoffset: ${RING_CIRC}; }
        }

        /* Step name: slide up + blur-to-sharp */
        @keyframes nameReveal {
          0%   { transform: translateY(26px); opacity: 0; filter: blur(10px); }
          100% { transform: translateY(0);    opacity: 1; filter: blur(0); }
        }

        /* Context / secondary labels */
        @keyframes labelFade {
          from { opacity: 0; transform: translateY(9px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* Ambient color wash wipe-up (rest transitions) */
        @keyframes ambientWipe {
          from { opacity: 0; transform: scaleY(0.2); }
          to   { opacity: 1; transform: scaleY(1); }
        }

        /* Duration / round info entrance */
        @keyframes durationIn {
          from { opacity: 0; transform: translateY(11px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* GET READY letter stagger */
        @keyframes letterUp {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* ── COUNTDOWN ────────────────────────────────────────────────────────── */}
      {showCountdown && (
        <>
          {/* Radiate rings */}
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            aria-hidden="true"
          >
            {[0, 1, 2].map((i) => (
              <div
                key={`r-${countdownSeconds}-${i}`}
                className="absolute rounded-full"
                style={{
                  width: 100,
                  height: 100,
                  border: `1.5px solid rgba(169,229,187,${0.52 - i * 0.14})`,
                  animation: `radiate ${0.82 + i * 0.24}s ease-out ${i * 0.14}s forwards`,
                }}
              />
            ))}
          </div>

          {/* SVG ring + number (keyed together so animation restarts each second) */}
          <div
            className="relative flex items-center justify-center"
            style={{ width: 140, height: 140 }}
          >
            <CountdownRing key={`ring-${countdownSeconds}`} />
            <span
              key={`n-${countdownSeconds}`}
              className="font-display font-light select-none tabular-nums relative z-10"
              style={{
                fontSize: 'clamp(4rem, 15vw, 6.5rem)',
                lineHeight: 1,
                color: 'var(--color-brand-primary)',
                textShadow: '0 0 48px rgba(169,229,187,0.55), 0 0 16px rgba(169,229,187,0.3)',
                animation: 'countdownEnter 0.3s cubic-bezier(0.22,1,0.36,1) forwards',
              }}
            >
              {countdownSeconds}
            </span>
          </div>

          {/* GET READY — staggered letter entrance */}
          <div className="mt-10 flex" aria-hidden="true">
            {'GET READY'.split('').map((ch, i) => (
              <span
                key={i}
                className="font-display font-bold"
                style={{
                  fontSize: '0.6rem',
                  letterSpacing: '0.32em',
                  color: 'rgba(169,229,187,0.38)',
                  display: 'inline-block',
                  animation: `letterUp 0.26s ease-out ${0.07 + i * 0.038}s both`,
                }}
              >
                {ch === ' ' ? '\u00A0\u00A0' : ch}
              </span>
            ))}
          </div>
        </>
      )}

      {/* ── TRANSITION ───────────────────────────────────────────────────────── */}
      {showTransition && transitionToStep && (
        <>
          {/* Ambient radial color wash — origin bottom, type-aware color */}
          <div
            aria-hidden="true"
            className="absolute inset-0 origin-bottom pointer-events-none"
            style={{
              background: `radial-gradient(ellipse 75% 55% at 50% 105%, rgba(${accentRgb},0.09) 0%, transparent 65%)`,
              animation: 'ambientWipe 0.55s ease-out forwards',
            }}
          />

          {/* Top accent hairline */}
          <div
            aria-hidden="true"
            className="absolute top-0 left-0 right-0 h-px"
            style={{
              background: `linear-gradient(90deg, transparent 0%, rgba(${accentRgb},0.55) 40%, rgba(${accentRgb},0.55) 60%, transparent 100%)`,
            }}
          />

          {/* Bottom accent hairline (dimmer) */}
          <div
            aria-hidden="true"
            className="absolute bottom-0 left-0 right-0 h-px"
            style={{
              background: `linear-gradient(90deg, transparent 0%, rgba(${accentRgb},0.18) 50%, transparent 100%)`,
            }}
          />

          {/* Main content stack */}
          <div className="flex flex-col items-center gap-4 px-10 text-center relative z-10">

            {/* Context label */}
            <span
              className="font-display font-bold uppercase"
              style={{
                fontSize: '0.57rem',
                letterSpacing: '0.38em',
                color: `rgba(${accentRgb},0.48)`,
                animation: 'labelFade 0.26s ease-out 0.04s both',
              }}
            >
              {isToFirst ? '— Starting —' : isToRest ? '— Rest —' : '— Next Up —'}
            </span>

            {/* Step name */}
            <h2
              className="font-display font-bold leading-tight"
              style={{
                fontSize: 'clamp(2rem, 9vw, 4.5rem)',
                color: 'var(--color-brand-text)',
                animation: 'nameReveal 0.42s cubic-bezier(0.22,1,0.36,1) 0.06s both',
              }}
            >
              {transitionToStep.label}
            </h2>

            {/* Duration */}
            {transitionToStep.duration_ms > 0 && (
              <div
                className="flex items-baseline gap-2"
                style={{ animation: 'durationIn 0.3s ease-out 0.17s both' }}
              >
                <span
                  className="font-display font-light tabular-nums"
                  style={{
                    fontSize: 'clamp(1.75rem, 6vw, 3rem)',
                    color: accentColor,
                    textShadow: `0 0 26px rgba(${accentRgb},0.38)`,
                  }}
                >
                  {Math.round(transitionToStep.duration_ms / 1000)}
                </span>
                <span
                  className="font-bold uppercase"
                  style={{
                    fontSize: '0.58rem',
                    letterSpacing: '0.22em',
                    color: `rgba(${accentRgb},0.42)`,
                  }}
                >
                  sec
                </span>
              </div>
            )}

            {/* Round progress dots */}
            {transitionToStep.meta.round !== undefined &&
              transitionToStep.meta.total_rounds !== undefined &&
              transitionToStep.meta.total_rounds > 1 && (
                <div
                  className="flex gap-2 mt-1"
                  style={{ animation: 'durationIn 0.3s ease-out 0.25s both' }}
                  aria-label={`Round ${transitionToStep.meta.round} of ${transitionToStep.meta.total_rounds}`}
                >
                  {Array.from({ length: transitionToStep.meta.total_rounds }, (_, i) => (
                    <div
                      key={i}
                      className="rounded-full"
                      style={{
                        width: 7,
                        height: 7,
                        background:
                          i < (transitionToStep.meta.round ?? 0)
                            ? accentColor
                            : `rgba(${accentRgb},0.16)`,
                        boxShadow:
                          i < (transitionToStep.meta.round ?? 0)
                            ? `0 0 6px rgba(${accentRgb},0.4)`
                            : 'none',
                      }}
                    />
                  ))}
                </div>
              )}
          </div>

          {/* From-step ghost label at bottom */}
          {transitionFromStep && !isToFirst && (
            <div
              className="absolute bottom-12 text-center px-8 pointer-events-none"
              style={{ animation: 'labelFade 0.28s ease-out 0.1s both' }}
              aria-hidden="true"
            >
              <span
                className="font-bold uppercase"
                style={{
                  fontSize: '0.58rem',
                  letterSpacing: '0.15em',
                  color: 'rgba(237,228,250,0.16)',
                }}
              >
                {transitionFromStep.label} ↑
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
