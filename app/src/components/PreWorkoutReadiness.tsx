import { useState } from 'react';
import { useTimerStore } from '../store/timerStore';
import { classifyFatigue, recommendedRestHours } from '../engine/fatigueEngine';

// ─── Readiness labels ─────────────────────────────────────────────────────────

const READINESS_LABELS: Record<number, string> = {
  0: 'Terrible',      1: 'Very low',   2: 'Low',
  3: 'Below average', 4: 'Fair',        5: 'Moderate',
  6: 'Good',          7: 'Ready',       8: 'Strong',
  9: 'Excellent',    10: 'Peak',
};

// ─── Fatigue badge ────────────────────────────────────────────────────────────

function FatigueBadge({ score }: { score: number }) {
  const category = classifyFatigue(score);

  const isHigh   = score >= 7;
  const isMid    = score >= 5 && score < 7;
  const accent   = isHigh ? 'var(--color-brand-tertiary)' : isMid ? 'var(--color-brand-secondary)' : 'var(--color-brand-primary)';
  const accentRgb = isHigh ? '255,132,129' : isMid ? '254,178,70' : '169,229,187';
  const barPct   = (score / 10) * 100;

  return (
    <div
      className="flex items-center gap-4 px-4 py-3.5 rounded-2xl"
      style={{
        background: `rgba(${accentRgb},0.06)`,
        border:     `1px solid rgba(${accentRgb},0.2)`,
      }}
    >
      <div className="flex flex-col flex-1 gap-1.5 min-w-0">
        <span
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: `rgba(${accentRgb},0.55)` }}
        >
          Fatigue from session history
        </span>

        <div className="flex items-baseline gap-2">
          <span
            className="font-display font-bold tabular-nums"
            style={{ fontSize: '1.65rem', color: accent }}
          >
            {score.toFixed(1)}
          </span>
          <span className="text-xs" style={{ color: 'var(--color-brand-text-muted)' }}>
            / 10 &mdash; {category}
          </span>
        </div>

        {/* Inline bar */}
        <div
          className="h-1.5 rounded-full overflow-hidden"
          style={{ background: `rgba(${accentRgb},0.12)` }}
          aria-hidden="true"
        >
          <div
            className="h-full rounded-full"
            style={{
              width:      `${barPct}%`,
              background: `linear-gradient(90deg, rgba(${accentRgb},0.55), rgba(${accentRgb},0.85))`,
              boxShadow:  `0 0 6px rgba(${accentRgb},0.35)`,
            }}
          />
        </div>
      </div>

      {/* Rest recommendation */}
      <div
        className="flex flex-col items-center justify-center gap-0.5 flex-shrink-0"
        style={{ minWidth: 48 }}
      >
        <span
          className="font-display font-bold tabular-nums"
          style={{ fontSize: '1.1rem', color: accent }}
        >
          {recommendedRestHours(score)}h
        </span>
        <span
          className="text-[9px] font-bold uppercase tracking-wider text-center"
          style={{ color: `rgba(${accentRgb},0.45)`, lineHeight: 1.2 }}
        >
          rec&rsquo;d
          <br />rest
        </span>
      </div>
    </div>
  );
}

// ─── Recommendation banner ────────────────────────────────────────────────────

function RecommendationBanner({ fatigueScore, readiness }: { fatigueScore: number; readiness: number }) {
  let text: string | null = null;

  if (fatigueScore >= 8) {
    text = `High fatigue detected. Consider a lighter session or ${recommendedRestHours(fatigueScore)} hours of rest before this workout.`;
  } else if (fatigueScore >= 6 && readiness <= 4) {
    text = 'Elevated fatigue combined with low readiness — reduced intensity is strongly recommended today.';
  } else if (readiness <= 3) {
    text = 'You rated your readiness quite low. Listen to your body; there\'s no shame in a light or shorter session.';
  } else if (fatigueScore >= 6) {
    text = `Moderate fatigue (${fatigueScore.toFixed(1)}/10) detected. Aim for 70–80% effort and prioritise form over load.`;
  } else if (readiness <= 5 && fatigueScore > 0) {
    text = 'Moderate readiness — warm up thoroughly and scale back if needed mid-session.';
  }

  if (!text) return null;

  const isWarning = fatigueScore >= 7 || readiness <= 3;
  const accentRgb = isWarning ? '255,132,129' : '254,178,70';

  return (
    <div
      className="flex items-start gap-3 px-4 py-3 rounded-xl"
      style={{
        background: `rgba(${accentRgb},0.06)`,
        border:     `1px solid rgba(${accentRgb},0.2)`,
        animation:  'readinessBannerIn 0.28s ease-out both',
      }}
    >
      {/* Info icon */}
      <svg
        width="15" height="15" viewBox="0 0 24 24" fill="none"
        stroke={`rgba(${accentRgb},0.8)`} strokeWidth="2"
        className="mt-0.5 flex-shrink-0" aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
      </svg>
      <p className="text-xs leading-relaxed" style={{ color: `rgba(${accentRgb},0.85)` }}>
        {text}
      </p>
    </div>
  );
}

// ─── Readiness dial ───────────────────────────────────────────────────────────

function ReadinessDial({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* Label row */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium" style={{ color: 'var(--color-brand-text)' }}>
          How ready do you feel?
        </span>
        <div className="flex items-baseline gap-1.5">
          <span
            className="font-display font-bold tabular-nums"
            style={{ fontSize: '1.4rem', color: 'var(--color-brand-primary)' }}
          >
            {value}
          </span>
          <span className="text-xs" style={{ color: 'var(--color-brand-text-muted)' }}>
            &mdash;&nbsp;{READINESS_LABELS[value]}
          </span>
        </div>
      </div>

      {/* 0–10 tap grid */}
      <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(11, 1fr)' }}>
        {Array.from({ length: 11 }, (_, i) => {
          const isSelected = i === value;
          const isPast     = i < value;
          return (
            <button
              key={i}
              onClick={() => onChange(i)}
              className="aspect-square rounded-xl flex items-center justify-center text-xs font-bold transition-all duration-150 active:scale-90"
              aria-label={`Readiness ${i} — ${READINESS_LABELS[i]}`}
              aria-pressed={isSelected}
              style={{
                background: isSelected
                  ? 'var(--color-brand-primary)'
                  : isPast
                  ? 'rgba(169,229,187,0.13)'
                  : 'rgba(255,255,255,0.05)',
                color: isSelected
                  ? '#120b18'
                  : isPast
                  ? 'rgba(169,229,187,0.7)'
                  : 'var(--color-brand-text-muted)',
                border: isSelected ? 'none' : '1px solid rgba(255,255,255,0.07)',
                boxShadow: isSelected ? '0 0 18px rgba(169,229,187,0.28)' : 'none',
                fontWeight: isSelected ? 800 : 600,
              }}
            >
              {i}
            </button>
          );
        })}
      </div>

      {/* Semantic band labels */}
      <div className="flex justify-between px-0.5" aria-hidden="true">
        <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'rgba(255,132,129,0.45)' }}>
          Terrible
        </span>
        <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'rgba(254,178,70,0.4)' }}>
          Moderate
        </span>
        <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'rgba(169,229,187,0.4)' }}>
          Peak
        </span>
      </div>
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

/**
 * Slide-up sheet that appears before a preset session starts.
 * Collects 0–10 readiness score, shows fatigue-based recommendations,
 * then calls confirmReadiness(score) → startSession with readiness in evalCtx.
 */
export default function PreWorkoutReadiness() {
  const visible               = useTimerStore((s) => s.readinessModalVisible);
  const fatigueScore          = useTimerStore((s) => s.fatigueScore);
  const confirmReadiness      = useTimerStore((s) => s.confirmReadiness);
  const dismissReadinessModal = useTimerStore((s) => s.dismissReadinessModal);

  const [readiness, setReadiness] = useState(7);

  if (!visible) return null;

  const hasFatigue = fatigueScore > 0;

  return (
    <>
      <style>{`
        @keyframes readinessBgIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes readinessSheetIn {
          from { transform: translateY(48px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        @keyframes readinessBannerIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Scrim */}
      <div
        className="fixed inset-0 z-50"
        style={{ background: 'rgba(10,6,16,0.72)', backdropFilter: 'blur(14px)', animation: 'readinessBgIn 0.2s ease-out forwards' }}
        onClick={dismissReadinessModal}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 flex justify-center px-4 pb-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rr-title"
      >
        <div
          className="w-full max-w-md rounded-3xl flex flex-col gap-5 px-5 pt-5 pb-8"
          style={{
            background: 'rgba(18,11,24,0.99)',
            border:     '1px solid rgba(255,255,255,0.09)',
            boxShadow:  '0 -20px 60px rgba(0,0,0,0.6)',
            animation:  'readinessSheetIn 0.32s cubic-bezier(0.22,1,0.36,1) forwards',
          }}
        >
          {/* Drag handle */}
          <div className="w-10 h-1 rounded-full mx-auto" style={{ background: 'rgba(255,255,255,0.14)' }} aria-hidden="true" />

          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h2
                id="rr-title"
                className="font-display font-bold text-xl"
                style={{ color: 'var(--color-brand-text)' }}
              >
                Pre-Workout Check-in
              </h2>
              <p className="text-sm mt-0.5" style={{ color: 'var(--color-brand-text-muted)' }}>
                Rate your readiness to personalise the session
              </p>
            </div>
          </div>

          {/* Fatigue badge — only when history exists */}
          {hasFatigue && <FatigueBadge score={fatigueScore} />}

          {/* Readiness dial */}
          <ReadinessDial value={readiness} onChange={setReadiness} />

          {/* Contextual recommendation */}
          <RecommendationBanner fatigueScore={fatigueScore} readiness={readiness} />

          {/* Actions */}
          <div className="flex flex-col gap-2 pt-1">
            <button
              onClick={() => confirmReadiness(readiness)}
              className="w-full py-4 rounded-2xl font-bold text-sm uppercase tracking-wider transition-all active:scale-95"
              style={{
                background: 'var(--color-brand-primary)',
                color:      '#120b18',
                boxShadow:  '0 0 36px rgba(169,229,187,0.22)',
              }}
            >
              Start Workout
            </button>
            <button
              onClick={dismissReadinessModal}
              className="w-full py-3 rounded-2xl text-sm transition-all active:scale-95"
              style={{ color: 'var(--color-brand-text-muted)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
