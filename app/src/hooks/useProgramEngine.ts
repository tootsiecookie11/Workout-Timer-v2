import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { calculateFatigueScore } from '../engine/fatigueEngine';
import { useSettingsStore } from '../store/settingsStore';
import type { ConfigStatus, WorkoutAST } from './useNotionWorkouts';
import type { ProgramSummary, ProgramDay, TodaysProgramDay } from './useNotionPrograms';

// ─── Env config ───────────────────────────────────────────────────────────────
// Required in app/.env:
//   VITE_WORKER_URL                   https://your-worker.workers.dev
//   VITE_NOTION_PROGRAMS_DB_ID        Workout Programs database id
//   VITE_NOTION_PROGRAM_DAYS_DB_ID    Program Days database id
//   VITE_NOTION_BLOCKS_DB_ID          Workout Blocks database id  (for AST)
//   VITE_NOTION_SESSIONS_DB_ID        Sessions database id        (for completion check)

const WORKER_URL     = (import.meta.env.VITE_WORKER_URL                as string | undefined) ?? '';
const PROGRAMS_DB_ID = (import.meta.env.VITE_NOTION_PROGRAMS_DB_ID     as string | undefined) ?? '';
const DAYS_DB_ID     = (import.meta.env.VITE_NOTION_PROGRAM_DAYS_DB_ID as string | undefined) ?? '';
const BLOCKS_DB_ID   = (import.meta.env.VITE_NOTION_BLOCKS_DB_ID       as string | undefined) ?? '';
const SESSIONS_DB_ID = (import.meta.env.VITE_NOTION_SESSIONS_DB_ID     as string | undefined) ?? '';

// ─── Local types ──────────────────────────────────────────────────────────────

interface SessionRecord {
  date:                 string;
  completion_ratio:     number;
  post_fatigue_score?:  number;
  pre_readiness_score?: number;
}

// ─── Pure helpers (no React — safe to call from async functions) ──────────────

/**
 * Given a program's ISO start date and total duration, return today's
 * { week, day } position (both 1-based, day resets every 7 calendar days).
 * Returns null if today is before the program started or after it ended.
 */
function calculateCurrentDay(
  startDateIso:  string,
  durationWeeks: number,
): { week: number; day: number } | null {
  const startMs  = new Date(startDateIso).setHours(0, 0, 0, 0);
  const todayMs  = new Date().setHours(0, 0, 0, 0);
  const diffDays = Math.floor((todayMs - startMs) / 86_400_000);

  if (diffDays < 0 || diffDays >= durationWeeks * 7) return null;
  return { week: Math.floor(diffDays / 7) + 1, day: (diffDays % 7) + 1 };
}

/** YYYY-MM-DD string for today in local time — used for completion check. */
function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── API helpers (pure async, receive token + ids as params) ─────────────────

async function apiFetchPrograms(token: string): Promise<ProgramSummary[]> {
  const r = await fetch(`${WORKER_URL}/api/programs`, {
    headers: {
      'Authorization':         `Bearer ${token}`,
      'X-Programs-Database-Id': PROGRAMS_DB_ID,
    },
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Programs fetch failed (${r.status})`);
  }
  return r.json() as Promise<ProgramSummary[]>;
}

async function apiFetchSchedule(token: string, programId: string): Promise<ProgramDay[]> {
  if (!DAYS_DB_ID) return [];
  const r = await fetch(`${WORKER_URL}/api/program/${programId}/schedule`, {
    headers: {
      'Authorization':    `Bearer ${token}`,
      'X-Days-Database-Id': DAYS_DB_ID,
    },
  });
  if (!r.ok) return [];
  return r.json() as Promise<ProgramDay[]>;
}

async function apiFetchAST(token: string, workoutId: string): Promise<WorkoutAST | null> {
  if (!BLOCKS_DB_ID) return null;
  try {
    const r = await fetch(`${WORKER_URL}/api/workout/${workoutId}`, {
      headers: {
        'Authorization':        `Bearer ${token}`,
        'X-Blocks-Database-Id': BLOCKS_DB_ID,
      },
    });
    if (!r.ok) return null;
    return r.json() as Promise<WorkoutAST>;
  } catch {
    return null;
  }
}

async function apiFetchRecentSessions(token: string, workoutId: string): Promise<SessionRecord[]> {
  if (!SESSIONS_DB_ID) return [];
  try {
    const r = await fetch(`${WORKER_URL}/api/workout/${workoutId}/sessions?limit=5`, {
      headers: {
        'Authorization':          `Bearer ${token}`,
        'X-Sessions-Database-Id': SESSIONS_DB_ID,
      },
    });
    if (!r.ok) return [];
    return r.json() as Promise<SessionRecord[]>;
  } catch {
    return [];
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * High-level Program Engine hook — the single source of truth for the
 * "My Program" tab.
 *
 * Loading sequence on mount:
 *   1. Resolve Supabase session → Notion provider_token
 *   2. Fetch all programs → find is_active === true (Status == 'Active' or checkbox)
 *   3. Calculate today's Week / Day from program.start_date + today
 *   4. Fetch the program's day schedule → find today's ProgramDay entry
 *   5. (parallel) Eagerly fetch today's workout block tree (WorkoutAST)
 *   6. (parallel) Fetch recent sessions → check if today is already completed
 *
 * Returns:
 *   status          — 'checking' | 'no_auth' | 'no_config' | 'ready'
 *   program         — the active ProgramSummary, or null
 *   today           — TodaysProgramDay (Week, Day, matched schedule entry), or null
 *   workoutAST      — eagerly-loaded WorkoutAST for today's lift, or null
 *   todayCompleted  — true/false if we confirmed from Notion; null while unknown
 *   loading         — true while the program / schedule fetch is in-flight
 *   astLoading      — true while the workout block tree is loading
 *   error           — error message if the program fetch failed
 *   connectNotion   — trigger Notion OAuth (Supabase signInWithOAuth)
 *   refresh         — re-run the full load sequence
 */
export function useProgramEngine() {
  const [status,     setStatus]     = useState<ConfigStatus>('checking');
  const [token,      setToken]      = useState<string | null>(null);

  const [allPrograms,    setAllPrograms]    = useState<ProgramSummary[]>([]);
  const [program,        setProgram]        = useState<ProgramSummary | null>(null);
  const [today,          setToday]          = useState<TodaysProgramDay | null>(null);
  const [workoutAST,     setWorkoutAST]     = useState<WorkoutAST | null>(null);
  const [todayCompleted, setTodayCompleted] = useState<boolean | null>(null);
  const [fatigueScore,   setFatigueScore]   = useState<number | null>(null);

  const [loading,    setLoading]    = useState(false);
  const [astLoading, setAstLoading] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  // Local program override (persisted via settingsStore)
  const activeProgramId = useSettingsStore((s) => s.activeProgramId);

  // ── 1. Resolve auth + env on mount ──────────────────────────────────────
  useEffect(() => {
    if (!WORKER_URL || !PROGRAMS_DB_ID) {
      setStatus('no_config');
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      const t = session?.provider_token ?? null;
      setToken(t);
      setStatus(t ? 'ready' : 'no_auth');
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const t = session?.provider_token ?? null;
      setToken(t);
      setStatus(
        !WORKER_URL || !PROGRAMS_DB_ID ? 'no_config'
        : t                            ? 'ready'
        :                                'no_auth',
      );
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // ── 2. Fetch program + schedule once authenticated (or when local selection changes) ──
  useEffect(() => {
    if (status !== 'ready' || !token) return;
    void runLoad(token, activeProgramId);
  }, [status, token, activeProgramId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 3. Eager AST + completion check once today's workout is known ─────────
  useEffect(() => {
    const workoutId = today?.day_info?.workout_template_id;
    if (!workoutId || !token) return;

    // AST load
    setAstLoading(true);
    apiFetchAST(token, workoutId).then((ast) => {
      setWorkoutAST(ast);
      setAstLoading(false);
    });

    // Completion check + fatigue score from session history
    setTodayCompleted(null);
    setFatigueScore(null);
    apiFetchRecentSessions(token, workoutId).then((sessions) => {
      if (sessions.length === 0 && !SESSIONS_DB_ID) {
        // Sessions DB not configured — leave both null (unknown)
        return;
      }
      const todayStr = todayDateString();
      setTodayCompleted(sessions.some((s) => s.date.startsWith(todayStr)));
      // Compute weighted fatigue score from the same history batch
      setFatigueScore(calculateFatigueScore(sessions));
    });
  }, [today, token]);

  // ── Core load function ────────────────────────────────────────────────────
  async function runLoad(tok: string, localActiveId: string | null): Promise<void> {
    setLoading(true);
    setError(null);
    setProgram(null);
    setToday(null);
    setWorkoutAST(null);
    setTodayCompleted(null);
    setFatigueScore(null);

    try {
      // Fetch all programs and cache the full list for the browse screen
      const programs = await apiFetchPrograms(tok);
      setAllPrograms(programs);

      // Local selection takes precedence; fall back to Notion's is_active flag,
      // then fall back further if the locally-saved ID was removed from Notion.
      const active =
        (localActiveId ? programs.find((p) => p.id === localActiveId) : null)
        ?? programs.find((p) => p.is_active)
        ?? null;
      setProgram(active);

      if (!active) return; // no active program enrolled

      // Calculate today's position
      const position = calculateCurrentDay(active.start_date, active.duration_weeks);
      if (!position) return; // program hasn't started yet or has ended

      // Fetch schedule and match today's entry
      const days    = await apiFetchSchedule(tok, active.id);
      const dayInfo = days.find((d) => d.week === position.week && d.day === position.day) ?? null;

      setToday({
        program_id:   active.id,
        program_name: active.name,
        week:         position.week,
        day:          position.day,
        total_weeks:  active.duration_weeks,
        day_info:     dayInfo,
        is_rest_day:  dayInfo?.is_rest_day ?? false,
      });
      // AST + completion check are triggered by the useEffect watching `today`
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error loading program');
    } finally {
      setLoading(false);
    }
  }

  // ── Public actions ────────────────────────────────────────────────────────

  /** Re-run the full load sequence (e.g. after completing a session). */
  const refresh = useCallback(() => {
    if (!token || status !== 'ready') return;
    void runLoad(token, activeProgramId);
  }, [token, status, activeProgramId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Trigger Notion OAuth via Supabase. */
  const connectNotion = useCallback(async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'notion',
      options: { redirectTo: window.location.origin },
    });
  }, []);

  return {
    /** Auth + config resolution state. */
    status,
    /** Full list of all programs fetched from Notion (for the browse screen). */
    allPrograms,
    /** The user's active training program, or null if none found / enrolled. */
    program,
    /**
     * Today's Week/Day position and the matched Program Day entry.
     * Null when no active program, program hasn't started, or has ended.
     */
    today,
    /**
     * Eagerly-loaded WorkoutAST for today's scheduled lift.
     * Null on rest days, unscheduled days, or when blocks DB is not configured.
     */
    workoutAST,
    /** True while the workout block tree is loading (parallel to program fetch). */
    astLoading,
    /**
     * Weighted fatigue score (0–10) computed from recent session history.
     * Null until sessions are fetched or when sessions DB is not configured.
     */
    fatigueScore,
    /**
     * Whether today's session has already been logged in Notion.
     * - true  → already done
     * - false → not yet done
     * - null  → unknown (sessions DB not configured, or check still in-flight)
     */
    todayCompleted,
    /** True while the program list + schedule fetch is in-flight. */
    loading,
    /** Non-null when the program fetch failed. */
    error,
    /** Re-run the full load sequence (call after completing a session). */
    refresh,
    /** Trigger the Notion OAuth flow. */
    connectNotion,
  };
}
