import { useTimerStore } from '../store/timerStore';

// ─── Option button ────────────────────────────────────────────────────────────

interface OptionButtonProps {
  label:     string;
  index:     number;
  total:     number;
  onClick:   () => void;
}

function OptionButton({ label, index, total, onClick }: OptionButtonProps) {
  // First option is always the primary (green) CTA. Middle options neutral. Last = skip/secondary.
  const isPrimary  = index === 0;
  const isLast     = index === total - 1 && total > 1;

  const bg     = isPrimary ? 'rgba(169,229,187,0.1)'  : isLast ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.055)';
  const border = isPrimary ? 'rgba(169,229,187,0.38)' : isLast ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.12)';
  const color  = isPrimary ? 'var(--color-brand-primary)' : isLast ? 'var(--color-brand-text-muted)' : 'var(--color-brand-text)';
  const glow   = isPrimary ? '0 0 28px rgba(169,229,187,0.12)' : 'none';

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between px-5 py-4 rounded-2xl text-left transition-all duration-150 active:scale-95"
      style={{
        background:  bg,
        border:      `1px solid ${border}`,
        color,
        boxShadow:   glow,
        animation:   `choiceOptionIn 0.35s cubic-bezier(0.22,1,0.36,1) ${0.08 + index * 0.07}s both`,
      }}
    >
      <span className="font-bold text-base">{label}</span>
      <svg
        width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2.2"
        aria-hidden="true"
      >
        <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

// ─── Branching icon ───────────────────────────────────────────────────────────

function BranchIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="6"  cy="18" r="2.5" stroke="var(--color-brand-primary)" strokeWidth="1.6" />
      <circle cx="6"  cy="6"  r="2.5" stroke="var(--color-brand-primary)" strokeWidth="1.6" />
      <circle cx="18" cy="6"  r="2.5" stroke="var(--color-brand-primary)" strokeWidth="1.6" />
      <path d="M6 15.5V8.5" stroke="var(--color-brand-primary)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M6 8.5C6 8.5 8 6 18 6" stroke="var(--color-brand-primary)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// ─── Shimmer top bar ──────────────────────────────────────────────────────────

function TopBar() {
  return (
    <div
      aria-hidden="true"
      className="absolute top-0 left-0 right-0 h-px"
      style={{
        background:
          'linear-gradient(90deg, transparent 0%, rgba(169,229,187,0.5) 35%, rgba(169,229,187,0.5) 65%, transparent 100%)',
        animation: 'topBarIn 0.4s ease-out 0.05s both',
      }}
    />
  );
}

// ─── Main overlay ─────────────────────────────────────────────────────────────

/**
 * Full-screen overlay rendered when GraphEngine emits `graph:choice_required`.
 * Reads `pendingChoice` from the store; calls `resolveGraphChoice(answer)`.
 * Non-dismissible — the user MUST make a selection to continue.
 */
export default function GraphChoiceOverlay() {
  const pendingChoice      = useTimerStore((s) => s.pendingChoice);
  const resolveGraphChoice = useTimerStore((s) => s.resolveGraphChoice);

  if (!pendingChoice) return null;

  const { prompt, options } = pendingChoice;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6 overflow-hidden"
      style={{
        background:     'rgba(10,6,16,0.96)',
        backdropFilter: 'blur(22px)',
        animation:      'choiceOverlayIn 0.22s ease-out forwards',
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="gco-prompt"
    >
      <style>{`
        @keyframes choiceOverlayIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes topBarIn {
          from { transform: scaleX(0); opacity: 0; }
          to   { transform: scaleX(1); opacity: 1; }
        }
        @keyframes choiceHeaderIn {
          from { opacity: 0; transform: translateY(22px); filter: blur(6px); }
          to   { opacity: 1; transform: translateY(0);    filter: blur(0); }
        }
        @keyframes choiceOptionIn {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes branchIconSpin {
          0%   { transform: rotate(-8deg) scale(0.7); opacity: 0; }
          60%  { transform: rotate(4deg)  scale(1.1); opacity: 1; }
          100% { transform: rotate(0deg)  scale(1);   opacity: 1; }
        }
        @keyframes ambientPulse {
          0%, 100% { opacity: 0.45; }
          50%       { opacity: 0.7;  }
        }
      `}</style>

      <TopBar />

      {/* Ambient radial wash */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 70% 50% at 50% 60%, rgba(169,229,187,0.055) 0%, transparent 65%)',
          animation: 'ambientPulse 3.5s ease-in-out infinite',
        }}
      />

      {/* Content */}
      <div className="relative z-10 w-full max-w-sm flex flex-col items-center gap-7">

        {/* Icon chip */}
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{
            background: 'rgba(169,229,187,0.07)',
            border:     '1px solid rgba(169,229,187,0.2)',
            animation:  'branchIconSpin 0.4s cubic-bezier(0.22,1,0.36,1) 0.05s both',
          }}
          aria-hidden="true"
        >
          <BranchIcon />
        </div>

        {/* Prompt header */}
        <div
          className="flex flex-col items-center gap-2 text-center"
          style={{ animation: 'choiceHeaderIn 0.36s cubic-bezier(0.22,1,0.36,1) 0.06s both' }}
        >
          <span
            className="font-display font-bold uppercase"
            style={{
              fontSize:      '0.5rem',
              letterSpacing: '0.4em',
              color:         'rgba(169,229,187,0.45)',
            }}
          >
            Choose your path
          </span>

          <h2
            id="gco-prompt"
            className="font-display font-bold leading-snug"
            style={{
              fontSize: 'clamp(1.5rem, 7vw, 2.4rem)',
              color:    'var(--color-brand-text)',
            }}
          >
            {prompt}
          </h2>
        </div>

        {/* Options */}
        <div className="w-full flex flex-col gap-2.5">
          {options.map((opt, i) => (
            <OptionButton
              key={opt}
              label={opt}
              index={i}
              total={options.length}
              onClick={() => resolveGraphChoice(opt)}
            />
          ))}
        </div>

        {/* Pause indicator */}
        <p
          className="text-xs uppercase tracking-widest"
          style={{
            color:     'rgba(237,228,250,0.2)',
            animation: 'choiceHeaderIn 0.36s cubic-bezier(0.22,1,0.36,1) 0.28s both',
          }}
        >
          Session paused
        </p>
      </div>
    </div>
  );
}
