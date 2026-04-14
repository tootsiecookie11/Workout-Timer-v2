import { useState, useEffect } from 'react';
import { useTimerStore } from '../store/timerStore';
import { useNotionWorkouts } from '../hooks/useNotionWorkouts';
import { useSettingsStore } from '../store/settingsStore';
import type { WorkoutSummary, WorkoutFatigue } from '../hooks/useNotionWorkouts';
import { classifyFatigue } from '../engine/fatigueEngine';

// ─── Tag colour mapping ───────────────────────────────────────────────────────

const TAG_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  strength:    { bg: 'rgba(169,229,187,0.1)',  text: 'rgba(169,229,187,0.85)',  border: 'rgba(169,229,187,0.25)' },
  cardio:      { bg: 'rgba(88,166,255,0.1)',   text: 'rgba(88,166,255,0.85)',   border: 'rgba(88,166,255,0.25)' },
  mobility:    { bg: 'rgba(200,150,255,0.1)',  text: 'rgba(200,150,255,0.85)',  border: 'rgba(200,150,255,0.25)' },
  hiit:        { bg: 'rgba(255,132,129,0.1)',  text: 'rgba(255,132,129,0.85)', border: 'rgba(255,132,129,0.25)' },
  rest:        { bg: 'rgba(254,178,70,0.1)',   text: 'rgba(254,178,70,0.85)',  border: 'rgba(254,178,70,0.25)' },
  endurance:   { bg: 'rgba(88,166,255,0.1)',   text: 'rgba(88,166,255,0.85)',   border: 'rgba(88,166,255,0.25)' },
  powerlifting:{ bg: 'rgba(169,229,187,0.1)',  text: 'rgba(169,229,187,0.85)',  border: 'rgba(169,229,187,0.25)' },
};

const DEFAULT_TAG = { bg: 'rgba(255,255,255,0.06)', text: 'rgba(255,255,255,0.5)', border: 'rgba(255,255,255,0.1)' };

function tagStyle(tag: string) {
  return TAG_COLORS[tag.toLowerCase()] ?? DEFAULT_TAG;
}

// ─── Fatigue badge (compact) ──────────────────────────────────────────────────

function FatigueChip({ fatigue }: { fatigue: WorkoutFatigue }) {
  const score    = fatigue.fatigue_score;
  const isHigh   = score >= 7;
  const isMid    = score >= 5;
  const accentRgb = isHigh ? '255,132,129' : isMid ? '254,178,70' : '169,229,187';
  const label     = classifyFatigue(score);

  return (
    <div
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full"
      style={{
        background: `rgba(${accentRgb},0.1)`,
        border:     `1px solid rgba(${accentRgb},0.25)`,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: `rgba(${accentRgb},0.85)`, boxShadow: `0 0 4px rgba(${accentRgb},0.5)` }}
      />
      <span
        className="text-[10px] font-bold uppercase tracking-widest tabular-nums"
        style={{ color: `rgba(${accentRgb},0.8)` }}
      >
        {score.toFixed(1)} — {label}
      </span>
    </div>
  );
}

// ─── Trend badge ──────────────────────────────────────────────────────────────

function TrendBadge({ trend }: { trend: 'improving' | 'declining' | 'stable' }) {
  const map = {
    improving: { label: '↑ Improving',  color: 'rgba(169,229,187,0.7)' },
    declining: { label: '↓ Declining',  color: 'rgba(255,132,129,0.7)' },
    stable:    { label: '→ Stable',     color: 'rgba(255,255,255,0.3)' },
  };
  const { label, color } = map[trend];
  return (
    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color }}>
      {label}
    </span>
  );
}

// ─── Skeleton card ────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div
      className="w-full rounded-2xl px-5 py-4 flex flex-col gap-3"
      style={{
        background: 'rgba(35,24,38,0.6)',
        border:     '1px solid rgba(255,255,255,0.06)',
        animation:  'skeletonPulse 1.4s ease-in-out infinite',
      }}
      aria-hidden="true"
    >
      <div className="h-3 rounded-full w-3/5" style={{ background: 'rgba(255,255,255,0.07)' }} />
      <div className="h-2 rounded-full w-4/5" style={{ background: 'rgba(255,255,255,0.05)' }} />
      <div className="flex gap-2">
        <div className="h-4 w-16 rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }} />
        <div className="h-4 w-12 rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }} />
      </div>
    </div>
  );
}

// ─── Workout card ─────────────────────────────────────────────────────────────

interface WorkoutCardProps {
  workout:       WorkoutSummary;
  fatigue:       WorkoutFatigue | null | 'loading';
  isSelected:    boolean;
  isLaunching:   boolean;
  onClick:       () => void;
}

function WorkoutCard({ workout, fatigue, isSelected, isLaunching, onClick }: WorkoutCardProps) {
  const durationLabel = workout.estimated_duration_min
    ? `${workout.estimated_duration_min} min`
    : null;

  return (
    <button
      onClick={onClick}
      disabled={isLaunching}
      className="w-full text-left rounded-2xl px-5 py-4 flex flex-col gap-3 transition-all duration-200 active:scale-[0.98]"
      style={{
        background: isSelected ? 'rgba(169,229,187,0.06)' : 'rgba(35,24,38,0.7)',
        border:     isSelected
          ? '1px solid rgba(169,229,187,0.3)'
          : '1px solid rgba(255,255,255,0.07)',
        boxShadow:  isSelected ? '0 0 32px rgba(169,229,187,0.08)' : 'none',
      }}
      aria-pressed={isSelected}
    >
      {/* Name + duration */}
      <div className="flex items-start justify-between gap-3">
        <h3
          className="font-display font-bold leading-tight"
          style={{
            fontSize: 'clamp(1rem, 4vw, 1.25rem)',
            color:    isSelected ? 'var(--color-brand-primary)' : 'var(--color-brand-text)',
          }}
        >
          {workout.name}
        </h3>
        {durationLabel && (
          <span
            className="flex-shrink-0 text-xs font-bold tabular-nums"
            style={{ color: 'var(--color-brand-text-muted)', marginTop: 2 }}
          >
            {durationLabel}
          </span>
        )}
      </div>

      {/* Description */}
      {workout.description && (
        <p
          className="text-sm leading-relaxed line-clamp-2"
          style={{ color: 'var(--color-brand-text-muted)' }}
        >
          {workout.description}
        </p>
      )}

      {/* Tags + fatigue row */}
      <div className="flex flex-wrap items-center gap-2">
        {workout.tags.map((tag) => {
          const s = tagStyle(tag);
          return (
            <span
              key={tag}
              className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest"
              style={{ background: s.bg, color: s.text, border: `1px solid ${s.border}` }}
            >
              {tag}
            </span>
          );
        })}

        {/* Fatigue chip */}
        {fatigue === 'loading' && (
          <span
            className="px-2.5 py-1 rounded-full text-[10px]"
            style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.25)' }}
          >
            Loading fatigue…
          </span>
        )}
        {fatigue && fatigue !== 'loading' && (
          <FatigueChip fatigue={fatigue} />
        )}
      </div>

      {/* Expanded: fatigue trend + sessions analyzed */}
      {isSelected && fatigue && fatigue !== 'loading' && (
        <div
          className="flex items-center justify-between pt-1"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="flex items-center gap-3">
            <TrendBadge trend={fatigue.trend} />
            <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
              {fatigue.sessions_analyzed} session{fatigue.sessions_analyzed !== 1 ? 's' : ''} analyzed
            </span>
          </div>
          {isLaunching && (
            <span className="text-[10px] font-bold uppercase tracking-widest animate-pulse" style={{ color: 'var(--color-brand-primary)' }}>
              Loading…
            </span>
          )}
        </div>
      )}
    </button>
  );
}

// ─── Connect-Notion placeholder ───────────────────────────────────────────────

function ConnectView({ onConnect, isNoConfig }: { onConnect: () => void; isNoConfig: boolean }) {
  const openSettings = useSettingsStore((s) => s.openSettings);

  return (
    <div className="w-full max-w-md flex flex-col items-center gap-8 text-center relative px-2">
      {/* Notion icon / Glow */}
      <div className="relative">
        <div className="absolute inset-0 blur-3xl opacity-20 bg-brand-primary" />
        <div
          className="w-20 h-20 rounded-3xl flex items-center justify-center relative"
          style={{ background: 'rgba(35,24,38,0.9)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3"  y="3"  width="7" height="7" rx="1.5" fill="rgba(88,166,255,0.15)" />
            <rect x="14" y="3"  width="7" height="7" rx="1.5" fill="rgba(88,166,255,0.15)" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" fill="rgba(88,166,255,0.15)" />
            <rect x="3"  y="14" width="7" height="7" rx="1.5" fill="var(--color-brand-primary)"  fillOpacity="0.4" />
          </svg>
        </div>
      </div>

      <div className="space-y-3">
        <h1
          className="font-display text-2xl font-bold tracking-tight"
          style={{ color: 'var(--color-brand-text)' }}
        >
          {isNoConfig ? 'Vault Connection Required' : 'Connect Your Notion'}
        </h1>
        <p className="text-sm leading-relaxed max-w-[280px] mx-auto" style={{ color: 'var(--color-brand-text-muted)' }}>
          {isNoConfig
            ? 'Set up your dynamic workout engine by linking your personal Notion database IDs.'
            : 'Preset workouts live in your Notion workspace. Connect your account to sync them here automatically.'}
        </p>
      </div>

      {isNoConfig ? (
        <div className="w-full space-y-4">
          <div className="w-full space-y-2">
            {[
              { step: '01', label: 'Duplicate the Notion Template' },
              { step: '02', label: 'Copy your Database IDs'      },
              { step: '03', label: 'Paste them into the Vault below'   },
            ].map(({ step, label }) => (
              <div
                key={step}
                className="flex items-center gap-4 rounded-xl px-4 py-3 text-left"
                style={{
                  background: 'rgba(35,24,38,0.7)',
                  border:     '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <span
                  className="font-display text-xs font-bold tabular-nums"
                  style={{ color: 'var(--color-brand-primary)', opacity: 0.6 }}
                >
                  {step}
                </span>
                <span className="text-sm" style={{ color: 'var(--color-brand-text)' }}>
                  {label}
                </span>
              </div>
            ))}
          </div>

          <button
            onClick={() => openSettings('notion-vault')}
            className="w-full py-4 rounded-2xl font-bold text-sm uppercase tracking-wider transition-all active:scale-95 flex items-center justify-center gap-3"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border:     '1px solid rgba(255,255,255,0.1)',
              color:      'var(--color-brand-text)',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
            </svg>
            Open Notion Vault
          </button>
        </div>
      ) : (
        <>
          {/* Steps */}
          <div className="w-full space-y-2">
            {[
              { step: '01', label: 'Duplicate the Galawgaw Notion template' },
              { step: '02', label: 'Connect your Notion account below'      },
              { step: '03', label: 'Your workouts sync here automatically'   },
            ].map(({ step, label }) => (
              <div
                key={step}
                className="flex items-center gap-4 rounded-xl px-4 py-3 text-left"
                style={{
                  background: 'rgba(35,24,38,0.7)',
                  border:     '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <span
                  className="font-display text-xs font-bold tabular-nums"
                  style={{ color: 'rgba(88,166,255,0.6)' }}
                >
                  {step}
                </span>
                <span className="text-sm" style={{ color: 'var(--color-brand-text)' }}>
                  {label}
                </span>
              </div>
            ))}
          </div>

          {/* Connect button */}
          <button
            onClick={onConnect}
            className="w-full py-4 rounded-2xl font-bold text-sm uppercase tracking-wider transition-all active:scale-95"
            style={{
              background: 'var(--color-brand-primary)',
              color:      '#120b18',
              boxShadow:  '0 0-36px rgba(169,229,187,0.2)',
            }}
          >
            Connect Notion
          </button>
        </>
      )}
    </div>
  );
}

// ─── No-workouts guide ────────────────────────────────────────────────────────

const NOTION_STEPS = [
  {
    n: '01',
    title: 'Open your Notion workspace',
    body: 'Navigate to the Workouts database within your duplicated Galawgaw template.',
  },
  {
    n: '02',
    title: 'Create a new workout page',
    body: 'Add a page with a name, description, tags, and estimated duration.',
  },
  {
    n: '03',
    title: 'Add workout blocks as child pages',
    body: 'Each block needs a label, type (exercise / rest), and duration. Nest them inside the workout.',
  },
  {
    n: '04',
    title: 'Set Status → Active',
    body: 'Change the Status property to "Active". Your workout will appear here on the next sync.',
  },
] as const;

function NoWorkoutsGuide({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="flex flex-col gap-6 py-4">
      {/* Illustration */}
      <div className="flex justify-center">
        <div
          className="w-20 h-20 rounded-3xl flex items-center justify-center"
          style={{ background: 'rgba(35,24,38,0.9)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          {/* Notion-style 2×2 grid icon */}
          <svg width="38" height="38" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3"  y="3"  width="7" height="7" rx="1.2" fill="rgba(237,228,250,0.12)" />
            <rect x="14" y="3"  width="7" height="7" rx="1.2" fill="rgba(237,228,250,0.12)" />
            <rect x="14" y="14" width="7" height="7" rx="1.2" fill="rgba(237,228,250,0.12)" />
            {/* Bottom-left cell highlighted in celadon to signal "add here" */}
            <rect x="3"  y="14" width="7" height="7" rx="1.2" fill="rgba(169,229,187,0.3)" />
            <line x1="6" y1="17.5" x2="6" y2="20.5"  stroke="rgba(169,229,187,0.8)" strokeWidth="1.6" strokeLinecap="round" />
            <line x1="4.5" y1="19" x2="7.5" y2="19"  stroke="rgba(169,229,187,0.8)" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      {/* Heading */}
      <div className="text-center space-y-2">
        <h2
          className="font-display text-xl font-bold"
          style={{ color: 'var(--color-brand-text)' }}
        >
          No workouts yet
        </h2>
        <p
          className="text-sm leading-relaxed max-w-xs mx-auto"
          style={{ color: 'var(--color-brand-text-muted)' }}
        >
          Your Notion Workouts database is empty. Follow the steps below to add your first template.
        </p>
      </div>

      {/* Step guide */}
      <div className="flex flex-col gap-2">
        {NOTION_STEPS.map(({ n, title, body }) => (
          <div
            key={n}
            className="flex gap-4 rounded-xl px-4 py-3"
            style={{ background: 'rgba(35,24,38,0.8)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <span
              className="font-display text-xs font-bold tabular-nums shrink-0 pt-0.5"
              style={{ color: 'rgba(169,229,187,0.45)' }}
            >
              {n}
            </span>
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-bold" style={{ color: 'var(--color-brand-text)' }}>
                {title}
              </p>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--color-brand-text-muted)' }}>
                {body}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Vault indicator */}
      <div
        className="rounded-2xl px-4 py-3 text-center"
        style={{
          background:  'rgba(88,166,255,0.05)',
          border:      '1px solid rgba(88,166,255,0.15)',
          color:       'rgba(88,166,255,0.7)',
          fontSize:    '0.75rem',
        }}
      >
        Current vault verified. Syncing from live Notion data.
      </div>

      {/* Refresh CTA */}
      <button
        onClick={onRefresh}
        className="w-full py-3.5 rounded-2xl font-bold text-sm uppercase tracking-widest transition-all active:scale-[0.98]"
        style={{
          background: 'rgba(169,229,187,0.08)',
          border:     '1px solid rgba(169,229,187,0.22)',
          color:      'rgba(169,229,187,0.8)',
        }}
      >
        Check Again
      </button>
    </div>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

/**
 * Phase 2 preset screen — fully wired to the Galawgaw worker API.
 *
 * States:
 *   checking   → spinner while resolving Supabase session
 *   no_config  → shows env-var instructions
 *   no_auth    → shows "Connect Notion" OAuth CTA
 *   ready      → shows workout cards (loading → loaded → error)
 *
 * Selecting a workout:
 *   1. Fetches fatigue score from /api/fatigue/:id (shown in expanded card)
 *   2. Pressing "Start" fetches the full AST from /api/workout/:id
 *   3. Sets fatigue score in the store
 *   4. Calls requestSessionStart(blocks) → opens PreWorkoutReadiness modal
 */
export default function PresetTimerScreen() {
  const requestSessionStart = useTimerStore((s) => s.requestSessionStart);
  const setFatigueScore     = useTimerStore((s) => s.setFatigueScore);

  const {
    status,
    workouts,
    loading,
    error,
    fetchFatigue,
    fetchWorkoutAST,
    connectNotion,
    canFetchFatigue,
    refresh,
  } = useNotionWorkouts();

  // Per-card fatigue data (keyed by workout id)
  const [fatiguemap, setFatiguemap] = useState<Record<string, WorkoutFatigue | 'loading'>>({});

  // Selected workout id
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Loading state when fetching blocks before launching
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);

  // ── When a workout is selected, fetch its fatigue score ────────────────
  useEffect(() => {
    if (!selectedId || !canFetchFatigue) return;
    if (fatiguemap[selectedId]) return; // already fetched / loading

    setFatiguemap((prev) => ({ ...prev, [selectedId]: 'loading' }));

    fetchFatigue(selectedId).then((data) => {
      setFatiguemap((prev) => ({
        ...prev,
        [selectedId]: data ?? { fatigue_score: 0, sessions_analyzed: 0, trend: 'stable' },
      }));
    });
  }, [selectedId, canFetchFatigue, fetchFatigue, fatiguemap]);

  // ── Card click ─────────────────────────────────────────────────────────
  function handleCardClick(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
    setLaunchError(null);
  }

  // ── Launch selected workout ────────────────────────────────────────────
  async function handleLaunch() {
    if (!selectedId) return;

    setLaunchingId(selectedId);
    setLaunchError(null);

    try {
      const ast = await fetchWorkoutAST(selectedId);
      if (!ast || ast.blocks.length === 0) {
        setLaunchError('Workout has no blocks. Check your Notion template.');
        return;
      }

      // Push fatigue score into the store before the readiness modal opens
      const fatigueEntry = fatiguemap[selectedId];
      if (fatigueEntry && fatigueEntry !== 'loading') {
        setFatigueScore(fatigueEntry.fatigue_score);
      }

      // Opens PreWorkoutReadiness modal → on confirm → startSession(blocks)
      requestSessionStart(ast.blocks, selectedId);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setLaunchError(`Failed to load workout: ${msg}`);
    } finally {
      setLaunchingId(null);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col items-center px-5 pb-12 pt-24">
      <style>{`
        @keyframes skeletonPulse {
          0%, 100% { opacity: 0.6; }
          50%       { opacity: 1;   }
        }
        @keyframes listItemIn {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Ambient glow */}
      <div
        className="pointer-events-none fixed inset-0"
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(ellipse 50% 35% at 50% 40%, rgba(88,166,255,0.04) 0%, transparent 70%)',
        }}
      />

      {/* ── Checking state ─────────────────────────────────────────────────── */}
      {status === 'checking' && (
        <div className="flex-1 flex items-center justify-center">
          <div
            className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'rgba(169,229,187,0.3)', borderTopColor: 'transparent' }}
            aria-label="Checking connection"
          />
        </div>
      )}

      {/* ── No config / No auth ────────────────────────────────────────────── */}
      {(status === 'no_config' || status === 'no_auth') && (
        <ConnectView onConnect={connectNotion} isNoConfig={status === 'no_config'} />
      )}

      {/* ── Ready state ─────────────────────────────────────────────────────── */}
      {status === 'ready' && (
        <div className="w-full max-w-md flex flex-col gap-5 relative">

          {/* Page header */}
          <div className="flex flex-col gap-1">
            <h1
              className="font-display text-2xl font-bold"
              style={{ color: 'var(--color-brand-text)' }}
            >
              Workouts
            </h1>
            <p className="text-sm" style={{ color: 'var(--color-brand-text-muted)' }}>
              Select a workout to begin your session
            </p>
          </div>

          {/* Error banner */}
          {error && (
            <div
              className="flex items-center gap-3 px-4 py-3 rounded-xl"
              style={{ background: 'rgba(255,132,129,0.08)', border: '1px solid rgba(255,132,129,0.2)' }}
              role="alert"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,132,129,0.8)" strokeWidth="2" aria-hidden="true">
                <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
              </svg>
              <span className="text-sm" style={{ color: 'rgba(255,132,129,0.9)' }}>{error}</span>
            </div>
          )}

          {/* Skeleton cards while loading */}
          {loading && (
            <div className="flex flex-col gap-3">
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ animationDelay: `${i * 0.1}s` }}>
                  <SkeletonCard />
                </div>
              ))}
            </div>
          )}

          {/* Workout list */}
          {!loading && workouts.length > 0 && (
            <div className="flex flex-col gap-3">
              {workouts.map((workout, i) => (
                <div
                  key={workout.id}
                  style={{ animation: `listItemIn 0.3s ease-out ${0.05 + i * 0.06}s both` }}
                >
                  <WorkoutCard
                    workout={workout}
                    fatigue={fatiguemap[workout.id] ?? null}
                    isSelected={selectedId === workout.id}
                    isLaunching={launchingId === workout.id}
                    onClick={() => handleCardClick(workout.id)}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Empty state — full Notion setup guide */}
          {!loading && !error && workouts.length === 0 && (
            <NoWorkoutsGuide onRefresh={refresh} />
          )}

          {/* Launch error */}
          {launchError && (
            <div
              className="flex items-center gap-3 px-4 py-3 rounded-xl"
              style={{ background: 'rgba(255,132,129,0.08)', border: '1px solid rgba(255,132,129,0.2)' }}
              role="alert"
            >
              <span className="text-sm" style={{ color: 'rgba(255,132,129,0.9)' }}>{launchError}</span>
            </div>
          )}

          {/* Sticky launch bar — appears when a workout is selected */}
          {selectedId && !loading && (
            <div
              className="sticky bottom-6 flex gap-3 pt-2"
              style={{ animation: 'listItemIn 0.22s ease-out both' }}
            >
              <button
                onClick={handleLaunch}
                disabled={!!launchingId}
                className="flex-1 py-4 rounded-2xl font-bold text-sm uppercase tracking-wider transition-all active:scale-95 disabled:opacity-60"
                style={{
                  background: 'var(--color-brand-primary)',
                  color:      '#120b18',
                  boxShadow:  '0 0 40px rgba(169,229,187,0.25)',
                }}
              >
                {launchingId ? 'Loading…' : 'Start Workout'}
              </button>
              <button
                onClick={() => { setSelectedId(null); setLaunchError(null); }}
                className="w-14 flex items-center justify-center rounded-2xl transition-all active:scale-90"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border:     '1px solid rgba(255,255,255,0.1)',
                  color:      'var(--color-brand-text-muted)',
                }}
                aria-label="Deselect"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                </svg>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
