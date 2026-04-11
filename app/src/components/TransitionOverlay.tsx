import { useMemo } from 'react';
import { useTimerStore } from '../store/timerStore';

// ─── Constants ────────────────────────────────────────────────────────────────

const RING_R    = 52;
const RING_CIRC = 2 * Math.PI * RING_R; // ≈ 326.73

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format milliseconds as m:ss (e.g. 90 000 → "1:30") or plain seconds ("45"). */
function formatDuration(ms: number): { value: string; unit: string } {
  const totalSec = Math.round(ms / 1000);
  const min      = Math.floor(totalSec / 60);
  const sec      = totalSec % 60;
  if (min > 0) {
    return { value: `${min}:${String(sec).padStart(2, '0')}`, unit: 'min' };
  }
  return { value: String(totalSec), unit: 'sec' };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** SVG ring that depletes over exactly 1 s — remount via `key` restarts animation. */
function CountdownRing() {
  return (
    <svg
      width="140" height="140"
      className="absolute"
      style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}
      aria-hidden="true"
    >
      {/* Track */}
      <circle cx="70" cy="70" r={RING_R} fill="none"
        stroke="rgba(169,229,187,0.1)" strokeWidth="2.5" />
      {/* Depleting arc */}
      <circle cx="70" cy="70" r={RING_R} fill="none"
        stroke="var(--color-brand-primary)" strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={RING_CIRC}
        strokeDashoffset="0"
        transform="rotate(-90 70 70)"
        style={{
          animation: 'ringDeplete 1s linear forwards',
          filter: 'drop-shadow(0 0 6px rgba(169,229,187,0.55))',
        }}
      />
    </svg>
  );
}

/** Particle burst — 12 dots fly outward on transition enter. */
interface ParticleSpec { dx: number; dy: number; delay: number; size: number; dur: number; }

function ParticleBurst({ accentRgb }: { accentRgb: string }) {
  const particles = useMemo<ParticleSpec[]>(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const angle  = (i / 12) * 360 + (Math.random() - 0.5) * 25;
      const dist   = 55 + Math.random() * 90;
      const rad    = (angle * Math.PI) / 180;
      return {
        dx:    Math.cos(rad) * dist,
        dy:    Math.sin(rad) * dist,
        delay: Math.random() * 0.12,
        size:  1.5 + Math.random() * 2.5,
        dur:   0.45 + Math.random() * 0.3,
      };
    });
  }, []); // one set per mount

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden" aria-hidden="true">
      {particles.map((p, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            width:  p.size,
            height: p.size,
            background: `rgba(${accentRgb},0.75)`,
            boxShadow:  `0 0 ${p.size * 2}px rgba(${accentRgb},0.4)`,
            animationName:           'particleFly',
            animationDuration:       `${p.dur}s`,
            animationDelay:          `${p.delay}s`,
            animationFillMode:       'both',
            animationTimingFunction: 'ease-out',
            // CSS custom props for the per-particle transform
            ['--p-dx' as string]: `${p.dx}px`,
            ['--p-dy' as string]: `${p.dy}px`,
          }}
        />
      ))}
    </div>
  );
}

/** Step-type badge pill — "WORK" or "REST". */
function StepBadge({ isRest, accentRgb, accentColor }: { isRest: boolean; accentRgb: string; accentColor: string }) {
  return (
    <div
      className="flex items-center gap-1.5 px-3 py-0.5 rounded-full"
      style={{
        border:    `1px solid rgba(${accentRgb},0.35)`,
        background:`rgba(${accentRgb},0.07)`,
        animation: 'labelFade 0.22s ease-out both',
      }}
    >
      {/* Pulse dot */}
      <div
        className="rounded-full"
        style={{
          width: 5, height: 5,
          background: accentColor,
          boxShadow: `0 0 5px rgba(${accentRgb},0.6)`,
          animation: 'pulseDot 1.6s ease-in-out infinite',
        }}
      />
      <span
        className="font-display font-bold"
        style={{
          fontSize: '0.5rem',
          letterSpacing: '0.36em',
          color: `rgba(${accentRgb},0.72)`,
        }}
      >
        {isRest ? 'REST' : 'WORK'}
      </span>
    </div>
  );
}

// ─── Main overlay ─────────────────────────────────────────────────────────────

/**
 * Immersive full-screen overlay — non-dismissible (PRD §5.7).
 *
 * COUNTDOWN  — 3-2-1 with SVG ring depletion + radiate rings + "GET READY"
 * TRANSITION — particle burst, step badge, context-aware label, blur-to-sharp
 *              name reveal, scan-line, mm:ss duration, round dots, fatigue bar,
 *              from-step ghost
 */
export default function TransitionOverlay() {
  const countdownSeconds   = useTimerStore((s) => s.countdownSeconds);
  const transitionVisible  = useTimerStore((s) => s.transitionVisible);
  const transitionToStep   = useTimerStore((s) => s.transitionToStep);
  const transitionFromStep = useTimerStore((s) => s.transitionFromStep);
  const transitionContext  = useTimerStore((s) => s.transitionContext);
  const engineState        = useTimerStore((s) => s.engineState);
  const fatigueScore       = useTimerStore((s) => s.fatigueScore);

  const showCountdown  = engineState === 'COUNTDOWN' && countdownSeconds !== null;
  const showTransition = transitionVisible && transitionToStep !== null && !showCountdown;

  if (!showCountdown && !showTransition) return null;

  const isToRest  = transitionContext === 'to-rest';
  const isToFirst = transitionContext === 'to-first';
  const accentColor = isToRest ? 'var(--color-brand-secondary)' : 'var(--color-brand-primary)';
  const accentRgb   = isToRest ? '254,178,70' : '169,229,187';

  const contextLabel =
    isToFirst ? 'READY TO START'
    : isToRest ? 'STAY TUNED'
    : 'NEXT EXERCISE';

  const showFatigueBar = fatigueScore > 0 && showTransition;

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col items-center justify-center overflow-hidden"
      style={{
        background:    'rgba(18,10,22,0.97)',
        backdropFilter:'blur(14px)',
        animation:     'overlayIn 0.14s ease-out forwards',
      }}
      role="status"
      aria-live="assertive"
    >
      <style>{`
        /* ── Core entrance ─────────────────────────────────────────── */
        @keyframes overlayIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }

        /* ── Countdown ─────────────────────────────────────────────── */
        @keyframes countdownEnter {
          0%   { transform: scale(0.42); opacity: 0; filter: blur(14px); }
          55%  { transform: scale(1.07); opacity: 1; filter: blur(0); }
          100% { transform: scale(1);    opacity: 1; filter: blur(0); }
        }
        @keyframes radiate {
          0%   { transform: scale(0.25); opacity: 0.65; }
          100% { transform: scale(4.2);  opacity: 0; }
        }
        @keyframes ringDeplete {
          from { stroke-dashoffset: 0; }
          to   { stroke-dashoffset: ${RING_CIRC}; }
        }
        @keyframes letterUp {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* ── Transition ─────────────────────────────────────────────── */
        @keyframes particleFly {
          0%   { transform: translate(0, 0) scale(1); opacity: 0.85; }
          100% { transform: translate(var(--p-dx), var(--p-dy)) scale(0); opacity: 0; }
        }
        @keyframes ambientWipe {
          from { opacity: 0; transform: scaleY(0.2); }
          to   { opacity: 1; transform: scaleY(1); }
        }
        @keyframes labelFade {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* Work transitions: slide from right */
        @keyframes nameRevealWork {
          0%   { transform: translateX(32px); opacity: 0; filter: blur(12px); }
          100% { transform: translateX(0);    opacity: 1; filter: blur(0); }
        }
        /* Rest transitions: float up */
        @keyframes nameRevealRest {
          0%   { transform: translateY(28px); opacity: 0; filter: blur(12px); }
          100% { transform: translateY(0);    opacity: 1; filter: blur(0); }
        }

        /* Scan-line sweep across the step name */
        @keyframes scanLine {
          0%   { transform: translateX(-110%); opacity: 0.55; }
          70%  { opacity: 0.55; }
          100% { transform: translateX(110%);  opacity: 0; }
        }

        @keyframes durationIn {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulseDot {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50%       { opacity: 1;   transform: scale(1.35); }
        }
        @keyframes fatigueBarIn {
          from { transform: scaleX(0); opacity: 0; }
          to   { transform: scaleX(1); opacity: 1; }
        }
        @keyframes restPulse {
          0%, 100% { opacity: 0.97; }
          50%       { opacity: 0.88; }
        }
      `}</style>

      {/* ── COUNTDOWN ────────────────────────────────────────────────────────── */}
      {showCountdown && (
        <>
          {/* Radiate rings */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div
                key={`r-${countdownSeconds}-${i}`}
                className="absolute rounded-full"
                style={{
                  width: 100, height: 100,
                  border: `1.5px solid rgba(169,229,187,${0.52 - i * 0.14})`,
                  animation: `radiate ${0.82 + i * 0.24}s ease-out ${i * 0.14}s forwards`,
                }}
              />
            ))}
          </div>

          {/* Ring + number */}
          <div className="relative flex items-center justify-center" style={{ width: 140, height: 140 }}>
            <CountdownRing key={`ring-${countdownSeconds}`} />
            <span
              key={`n-${countdownSeconds}`}
              className="font-display font-light select-none tabular-nums relative z-10"
              style={{
                fontSize:   'clamp(4rem, 15vw, 6.5rem)',
                lineHeight: 1,
                color:      'var(--color-brand-primary)',
                textShadow: '0 0 52px rgba(169,229,187,0.6), 0 0 18px rgba(169,229,187,0.35)',
                animation:  'countdownEnter 0.3s cubic-bezier(0.22,1,0.36,1) forwards',
              }}
            >
              {countdownSeconds}
            </span>
          </div>

          {/* GET READY */}
          <div className="mt-10 flex" aria-hidden="true">
            {'GET READY'.split('').map((ch, i) => (
              <span
                key={i}
                className="font-display font-bold"
                style={{
                  fontSize:      '0.6rem',
                  letterSpacing: '0.32em',
                  color:         'rgba(169,229,187,0.38)',
                  display:       'inline-block',
                  animation:     `letterUp 0.26s ease-out ${0.07 + i * 0.038}s both`,
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
          {/* Particle burst — keyed to step so it re-fires on each new step */}
          <ParticleBurst key={`pb-${transitionToStep.label}-${transitionToStep.step_index}`} accentRgb={accentRgb} />

          {/* Ambient radial wash */}
          <div
            aria-hidden="true"
            className="absolute inset-0 origin-bottom pointer-events-none"
            style={{
              background: `radial-gradient(ellipse 75% 55% at 50% 105%, rgba(${accentRgb},0.09) 0%, transparent 65%)`,
              animation:  'ambientWipe 0.55s ease-out forwards',
              ...(isToRest ? { animation: 'ambientWipe 0.55s ease-out forwards, restPulse 3s ease-in-out 0.6s infinite' } : {}),
            }}
          />

          {/* Top accent hairline */}
          <div
            aria-hidden="true"
            className="absolute top-0 left-0 right-0 h-px"
            style={{ background: `linear-gradient(90deg, transparent 0%, rgba(${accentRgb},0.55) 40%, rgba(${accentRgb},0.55) 60%, transparent 100%)` }}
          />
          {/* Bottom accent hairline */}
          <div
            aria-hidden="true"
            className="absolute bottom-0 left-0 right-0 h-px"
            style={{ background: `linear-gradient(90deg, transparent 0%, rgba(${accentRgb},0.18) 50%, transparent 100%)` }}
          />

          {/* Main content */}
          <div className="flex flex-col items-center gap-3 px-10 text-center relative z-10">

            {/* Step badge */}
            <StepBadge isRest={isToRest} accentRgb={accentRgb} accentColor={accentColor} />

            {/* Context label */}
            <span
              className="font-display font-bold uppercase"
              style={{
                fontSize:      '0.55rem',
                letterSpacing: '0.4em',
                color:         `rgba(${accentRgb},0.5)`,
                animation:     'labelFade 0.26s ease-out 0.05s both',
              }}
            >
              {contextLabel}
            </span>

            {/* Step name with scan-line overlay */}
            <div className="relative overflow-hidden" style={{ maxWidth: '85vw' }}>
              <h2
                key={`name-${transitionToStep.step_index}`}
                className="font-display font-bold leading-tight"
                style={{
                  fontSize:  'clamp(2rem, 9vw, 4.5rem)',
                  color:     'var(--color-brand-text)',
                  animation: `${isToRest ? 'nameRevealRest' : 'nameRevealWork'} 0.42s cubic-bezier(0.22,1,0.36,1) 0.06s both`,
                }}
              >
                {transitionToStep.label}
              </h2>
              {/* Scan-line sweep */}
              <div
                aria-hidden="true"
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:  `linear-gradient(90deg, transparent 0%, rgba(${accentRgb},0.18) 45%, rgba(${accentRgb},0.32) 50%, rgba(${accentRgb},0.18) 55%, transparent 100%)`,
                  animation:   'scanLine 0.65s cubic-bezier(0.4,0,1,1) 0.18s both',
                }}
              />
            </div>

            {/* Duration */}
            {transitionToStep.duration_ms > 0 && (() => {
              const { value, unit } = formatDuration(transitionToStep.duration_ms);
              return (
                <div
                  className="flex items-baseline gap-2"
                  style={{ animation: 'durationIn 0.3s ease-out 0.18s both' }}
                >
                  <span
                    className="font-display font-light tabular-nums"
                    style={{
                      fontSize:   'clamp(1.75rem, 6vw, 3rem)',
                      color:      accentColor,
                      textShadow: `0 0 28px rgba(${accentRgb},0.38)`,
                    }}
                  >
                    {value}
                  </span>
                  <span
                    className="font-bold uppercase"
                    style={{
                      fontSize:      '0.55rem',
                      letterSpacing: '0.22em',
                      color:         `rgba(${accentRgb},0.4)`,
                    }}
                  >
                    {unit}
                  </span>
                </div>
              );
            })()}

            {/* Round progress dots */}
            {transitionToStep.meta.round !== undefined &&
              transitionToStep.meta.total_rounds !== undefined &&
              transitionToStep.meta.total_rounds > 1 && (
                <div
                  className="flex gap-2 mt-1"
                  style={{ animation: 'durationIn 0.3s ease-out 0.26s both' }}
                  aria-label={`Round ${transitionToStep.meta.round} of ${transitionToStep.meta.total_rounds}`}
                >
                  {Array.from({ length: transitionToStep.meta.total_rounds }, (_, i) => (
                    <div
                      key={i}
                      className="rounded-full transition-all"
                      style={{
                        width:  i < (transitionToStep.meta.round ?? 0) ? 8 : 6,
                        height: i < (transitionToStep.meta.round ?? 0) ? 8 : 6,
                        background:
                          i < (transitionToStep.meta.round ?? 0)
                            ? accentColor
                            : `rgba(${accentRgb},0.16)`,
                        boxShadow:
                          i < (transitionToStep.meta.round ?? 0)
                            ? `0 0 7px rgba(${accentRgb},0.45)`
                            : 'none',
                      }}
                    />
                  ))}
                </div>
              )}
          </div>

          {/* Fatigue indicator bar — shown when fatigue_score > 0 */}
          {showFatigueBar && (
            <div
              className="absolute bottom-20 left-1/2 pointer-events-none"
              style={{ transform: 'translateX(-50%)', width: 140, animation: 'durationIn 0.35s ease-out 0.35s both' }}
              aria-hidden="true"
            >
              <div
                className="flex items-center gap-2 mb-1"
                style={{ justifyContent: 'space-between' }}
              >
                <span style={{ fontSize: '0.42rem', letterSpacing: '0.32em', color: 'rgba(254,178,70,0.38)', fontWeight: 700, textTransform: 'uppercase' }}>
                  Fatigue
                </span>
                <span style={{ fontSize: '0.42rem', letterSpacing: '0.1em', color: 'rgba(254,178,70,0.38)', fontWeight: 700 }}>
                  {fatigueScore.toFixed(1)} / 10
                </span>
              </div>
              {/* Track */}
              <div className="rounded-full overflow-hidden" style={{ height: 2, background: 'rgba(254,178,70,0.12)' }}>
                {/* Fill */}
                <div
                  className="h-full rounded-full origin-left"
                  style={{
                    width:      `${(fatigueScore / 10) * 100}%`,
                    background: `linear-gradient(90deg, rgba(254,178,70,0.5), rgba(254,178,70,0.8))`,
                    boxShadow:  '0 0 4px rgba(254,178,70,0.4)',
                    animation:  'fatigueBarIn 0.5s ease-out 0.4s both',
                  }}
                />
              </div>
            </div>
          )}

          {/* From-step ghost label */}
          {transitionFromStep && !isToFirst && (
            <div
              className="absolute bottom-12 text-center px-8 pointer-events-none"
              style={{ animation: 'labelFade 0.28s ease-out 0.1s both' }}
              aria-hidden="true"
            >
              <span
                className="font-bold uppercase"
                style={{
                  fontSize:      '0.55rem',
                  letterSpacing: '0.15em',
                  color:         'rgba(237,228,250,0.14)',
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
