import { useSettingsStore } from '../store/settingsStore';
import type { ProgramSummary } from '../hooks/useNotionPrograms';

// ─── Design-system accent helpers ────────────────────────────────────────────

const ACCENT = {
  green:  '169,229,187',
  amber:  '254,178,70',
  coral:  '255,132,129',
} as const;

type AccentKey = keyof typeof ACCENT;

function rgba(key: AccentKey, alpha: number) {
  return `rgba(${ACCENT[key]},${alpha})`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtStartDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Returns the current { week, day } position within the program, or null if
 * today is before the start date or after the program has ended.
 */
function weekPosition(
  startDateIso:  string,
  durationWeeks: number,
): { week: number; day: number } | null {
  const startMs  = new Date(startDateIso).setHours(0, 0, 0, 0);
  const todayMs  = new Date().setHours(0, 0, 0, 0);
  const diffDays = Math.floor((todayMs - startMs) / 86_400_000);
  if (diffDays < 0 || diffDays >= durationWeeks * 7) return null;
  return { week: Math.floor(diffDays / 7) + 1, day: (diffDays % 7) + 1 };
}

function hasEnded(startDateIso: string, durationWeeks: number): boolean {
  const startMs  = new Date(startDateIso).setHours(0, 0, 0, 0);
  const todayMs  = new Date().setHours(0, 0, 0, 0);
  const diffDays = Math.floor((todayMs - startMs) / 86_400_000);
  return diffDays >= durationWeeks * 7;
}

// ─── ProgramCard ──────────────────────────────────────────────────────────────

function ProgramCard({
  program,
  isActiveLocal,
  onActivate,
}: {
  program:       ProgramSummary;
  isActiveLocal: boolean;
  onActivate:    () => void;
}) {
  const position = weekPosition(program.start_date, program.duration_weeks);
  const ended    = hasEnded(program.start_date, program.duration_weeks);
  const notStarted = new Date(program.start_date).setHours(0, 0, 0, 0) > new Date().setHours(0, 0, 0, 0);

  return (
    <div
      className="w-full rounded-2xl px-5 py-4 flex flex-col gap-3 relative overflow-hidden"
      style={{
        background: isActiveLocal
          ? `linear-gradient(135deg, rgba(35,24,38,0.95) 0%, ${rgba('green', 0.06)} 100%)`
          : 'rgba(35,24,38,0.8)',
        border: isActiveLocal
          ? `1px solid ${rgba('green', 0.3)}`
          : '1px solid rgba(255,255,255,0.07)',
      }}
    >
      {/* Active corner glow */}
      {isActiveLocal && (
        <div
          className="pointer-events-none absolute -top-6 -right-6 w-24 h-24 rounded-full blur-2xl"
          style={{ background: rgba('green', 0.18) }}
        />
      )}

      {/* Header: name + status badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <h3
            className="font-display text-base font-bold leading-tight truncate"
            style={{ color: 'var(--color-brand-text)' }}
          >
            {program.name}
          </h3>
          {program.goal && (
            <p
              className="text-xs leading-snug line-clamp-2"
              style={{ color: 'var(--color-brand-text-muted)' }}
            >
              {program.goal}
            </p>
          )}
        </div>

        {/* Badge */}
        {isActiveLocal ? (
          <span
            className="shrink-0 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full"
            style={{
              background: rgba('green', 0.12),
              border:     `1px solid ${rgba('green', 0.28)}`,
              color:      rgba('green', 0.9),
            }}
          >
            Active
          </span>
        ) : program.is_active && !isActiveLocal ? (
          <span
            className="shrink-0 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full"
            style={{
              background: rgba('amber', 0.08),
              border:     `1px solid ${rgba('amber', 0.2)}`,
              color:      rgba('amber', 0.7),
            }}
          >
            In Notion
          </span>
        ) : null}
      </div>

      {/* Meta chips: duration + position */}
      <div className="flex flex-wrap gap-1.5">
        <span
          className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border:     '1px solid rgba(255,255,255,0.08)',
            color:      'rgba(237,228,250,0.4)',
          }}
        >
          {program.duration_weeks}w program
        </span>

        {position && (
          <span
            className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full"
            style={{
              background: rgba('green', 0.07),
              border:     `1px solid ${rgba('green', 0.16)}`,
              color:      rgba('green', 0.65),
            }}
          >
            W{position.week} D{position.day}
          </span>
        )}

        {notStarted && !ended && (
          <span
            className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full"
            style={{
              background: rgba('amber', 0.06),
              border:     `1px solid ${rgba('amber', 0.14)}`,
              color:      rgba('amber', 0.55),
            }}
          >
            Starts {fmtStartDate(program.start_date)}
          </span>
        )}

        {ended && (
          <span
            className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full"
            style={{
              background: 'rgba(255,255,255,0.03)',
              border:     '1px solid rgba(255,255,255,0.06)',
              color:      'rgba(237,228,250,0.25)',
            }}
          >
            Completed
          </span>
        )}
      </div>

      {/* Activate / Deactivate button */}
      <button
        onClick={onActivate}
        className="w-full py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest transition-all duration-200 active:scale-[0.97]"
        style={
          isActiveLocal
            ? {
                background: rgba('green', 0.08),
                border:     `1px solid ${rgba('green', 0.2)}`,
                color:      rgba('green', 0.65),
              }
            : {
                background: 'var(--color-brand-primary)',
                color:      '#120b18',
              }
        }
      >
        {isActiveLocal ? 'Deactivate' : 'Activate Program'}
      </button>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="flex flex-col gap-3 animate-pulse">
      {[100, 116, 100].map((h, i) => (
        <div
          key={i}
          className="w-full rounded-2xl"
          style={{
            height:     h,
            background: 'rgba(255,255,255,0.04)',
            border:     '1px solid rgba(255,255,255,0.05)',
          }}
        />
      ))}
    </div>
  );
}

// ─── ProgramsListScreen ───────────────────────────────────────────────────────

interface Props {
  /** Full list of programs from Notion (already fetched by useProgramEngine). */
  programs: ProgramSummary[];
  /** True while the parent hook is still loading programs. */
  loading:  boolean;
  /** Navigate back to the main program dashboard. */
  onBack:   () => void;
}

/**
 * Browse all programs from the connected Notion workspace and activate one
 * locally. The selected program ID is persisted to settingsStore so the
 * dashboard reloads with the correct schedule on return.
 */
export default function ProgramsListScreen({ programs, loading, onBack }: Props) {
  const activeProgramId    = useSettingsStore((s) => s.activeProgramId);
  const setActiveProgramId = useSettingsStore((s) => s.setActiveProgramId);

  function handleActivate(id: string) {
    // Toggle: tapping the active program deactivates it (falls back to Notion flag)
    setActiveProgramId(id === activeProgramId ? null : id);
    onBack();
  }

  return (
    <main className="min-h-screen flex flex-col items-center px-6 pb-10 pt-24">
      <div className="w-full max-w-sm flex flex-col gap-5 relative">

        {/* Header ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all active:scale-90"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border:     '1px solid rgba(255,255,255,0.1)',
            }}
            aria-label="Back"
          >
            <svg
              width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="rgba(237,228,250,0.7)" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round"
            >
              <polyline points="15,18 9,12 15,6" />
            </svg>
          </button>

          <div>
            <h1
              className="font-display text-xl font-bold leading-tight"
              style={{ color: 'var(--color-brand-text)' }}
            >
              Programs
            </h1>
            <p
              className="text-xs"
              style={{ color: 'var(--color-brand-text-muted)' }}
            >
              Select a program to activate
            </p>
          </div>
        </div>

        {/* Loading skeleton ────────────────────────────────────────────────── */}
        {loading && <Skeleton />}

        {/* Empty state ─────────────────────────────────────────────────────── */}
        {!loading && programs.length === 0 && (
          <div
            className="w-full rounded-2xl px-5 py-10 flex flex-col items-center gap-4 text-center"
            style={{
              background: 'rgba(35,24,38,0.8)',
              border:     '1px solid rgba(255,255,255,0.07)',
            }}
          >
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{
                background: 'rgba(169,229,187,0.07)',
                border:     '1px solid rgba(169,229,187,0.18)',
              }}
            >
              <svg
                width="24" height="24" viewBox="0 0 24 24" fill="none"
                stroke="rgba(169,229,187,0.5)" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round"
              >
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <div className="space-y-1.5">
              <p
                className="font-display text-base font-bold"
                style={{ color: 'var(--color-brand-text)' }}
              >
                No programs found
              </p>
              <p
                className="text-xs leading-relaxed max-w-xs"
                style={{ color: 'var(--color-brand-text-muted)' }}
              >
                Create a training program in your Notion Programs database and it will appear here.
              </p>
            </div>
          </div>
        )}

        {/* Program cards ───────────────────────────────────────────────────── */}
        {!loading && programs.map((p) => (
          <ProgramCard
            key={p.id}
            program={p}
            isActiveLocal={p.id === activeProgramId}
            onActivate={() => handleActivate(p.id)}
          />
        ))}

        {/* Footer note ─────────────────────────────────────────────────────── */}
        {!loading && programs.length > 0 && (
          <p
            className="text-xs text-center"
            style={{ color: 'rgba(255,255,255,0.15)' }}
          >
            Selection is stored locally · Notion's Active flag is also respected
          </p>
        )}

      </div>
    </main>
  );
}
