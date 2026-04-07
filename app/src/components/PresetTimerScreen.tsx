/**
 * Preset Timer — Phase 2 (Notion integration).
 * Shows placeholder state with connection CTA for MVP.
 */
export default function PresetTimerScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 pb-10 pt-24">
      {/* Ambient glow */}
      <div
        className="pointer-events-none fixed inset-0"
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(ellipse 50% 35% at 50% 45%, rgba(88,166,255,0.05) 0%, transparent 70%)',
        }}
      />

      <div className="w-full max-w-md flex flex-col items-center gap-8 text-center relative">
        {/* Notion icon placeholder */}
        <div
          className="w-20 h-20 rounded-3xl flex items-center justify-center"
          style={{
            background: 'rgba(35,24,38,0.9)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1" fill="rgba(237,228,250,0.15)" />
            <rect x="14" y="3" width="7" height="7" rx="1" fill="rgba(237,228,250,0.15)" />
            <rect x="14" y="14" width="7" height="7" rx="1" fill="rgba(237,228,250,0.15)" />
            <rect x="3" y="14" width="7" height="7" rx="1" fill="rgba(88,166,255,0.35)" />
          </svg>
        </div>

        <div className="space-y-3">
          <h1
            className="font-display text-2xl font-bold tracking-tight"
            style={{ color: 'var(--color-brand-text)' }}
          >
            Connect Your Notion
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-brand-text-muted)' }}>
            Preset timers live in your Notion workspace. Duplicate the Galawgaw template,
            connect your account, and your workouts sync here automatically.
          </p>
        </div>

        {/* Step list */}
        <div className="w-full space-y-2">
          {[
            { step: '01', label: 'Duplicate the Galawgaw Notion template', done: false },
            { step: '02', label: 'Connect your Notion account via OAuth', done: false },
            { step: '03', label: 'Select your workspace databases', done: false },
          ].map(({ step, label, done }) => (
            <div
              key={step}
              className="flex items-center gap-4 rounded-xl px-4 py-3 text-left"
              style={{
                background: 'rgba(35,24,38,0.7)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <span
                className="font-display text-xs font-bold tabular-nums"
                style={{ color: done ? 'var(--color-brand-primary)' : 'rgba(88,166,255,0.6)' }}
              >
                {done ? '✓' : step}
              </span>
              <span className="text-sm" style={{ color: done ? 'var(--color-brand-text-muted)' : 'var(--color-brand-text)' }}>
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Coming soon badge */}
        <div
          className="flex items-center gap-2 px-5 py-2 rounded-full text-xs font-bold uppercase tracking-widest"
          style={{
            background: 'rgba(88,166,255,0.08)',
            border: '1px solid rgba(88,166,255,0.2)',
            color: 'rgba(88,166,255,0.8)',
          }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
          Phase 2 — Coming Soon
        </div>

        <p className="text-xs" style={{ color: 'var(--color-brand-text-muted)' }}>
          Build your workouts with Custom Timer while we ship Notion sync.
        </p>
      </div>
    </div>
  );
}
