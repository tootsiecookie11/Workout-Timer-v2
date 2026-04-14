import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useNotionConfig } from './useNotionConfig';
import type { ConfigStatus, WorkoutAST } from './useNotionWorkouts';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProgramSummary {
  id:             string;
  name:           string;
  duration_weeks: number;
  goal:           string;
  /** ISO date string for the first day of the program (e.g. "2026-04-01"). */
  start_date:     string;
  is_active:      boolean;
}

/**
 * A single day slot within a program schedule.
 * `week` and `day` are both 1-based.
 * `day` counts from 1 within each week (not necessarily aligned to calendar days).
 */
export interface ProgramDay {
  id:                  string;
  week:                number;
  day:                 number;
  /** Notion page id of the linked Workout Template; null when is_rest_day = true. */
  workout_template_id: string | null;
  is_rest_day:         boolean;
  notes:               string;
}

/**
 * The resolved "where am I in the program today?" payload.
 * Computed from the program's start_date and today's date.
 */
export interface TodaysProgramDay {
  program_id:   string;
  program_name: string;
  /** Current week number (1-based). */
  week:         number;
  /** Current day number within the week (1-based). */
  day:          number;
  total_weeks:  number;
  /**
   * The matching ProgramDay from the schedule for today's week/day slot.
   * Null when the schedule has no entry for this day (e.g. an unscheduled weekday).
   */
  day_info:     ProgramDay | null;
  is_rest_day:  boolean;
}

// ─── Week / Day calculator ────────────────────────────────────────────────────

/**
 * Given a program start date (ISO string) and its total duration, return the
 * current { week, day } position (both 1-based).
 *
 * Returns null if today is before the program started or after it ended.
 * `day` resets from 1 every 7 calendar days relative to the start date —
 * it is NOT the ISO weekday number.
 */
function calculateCurrentDay(
  startDateIso:  string,
  durationWeeks: number,
): { week: number; day: number } | null {
  // Strip times so the diff is purely in calendar days
  const startMs   = new Date(startDateIso).setHours(0, 0, 0, 0);
  const todayMs   = new Date().setHours(0, 0, 0, 0);
  const diffDays  = Math.floor((todayMs - startMs) / 86_400_000);

  if (diffDays < 0 || diffDays >= durationWeeks * 7) return null;

  return {
    week: Math.floor(diffDays / 7) + 1,
    day:  (diffDays % 7) + 1,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Resolves the user's active Notion workout program, calculates today's
 * "Week X, Day Y" position, and exposes a helper to fetch that day's workout.
 *
 * Config resolution:
 *   DB IDs come from settingsStore (user-entered in Settings → Notion Vault)
 *   with VITE_NOTION_*_DB_ID env vars as fallbacks. useNotionConfig() handles
 *   the merge so developers can rely on .env files without touching the UI.
 *
 * Auth flow mirrors useNotionWorkouts:
 *   Supabase session.provider_token (Notion OAuth) → Authorization: Bearer header.
 *
 * Notion DB schema required:
 *   Workout Programs DB — Name, Duration Weeks, Goal, Start Date, Is Active
 *   Program Days DB    — Week, Day, Workout Template (relation), Is Rest Day, Notes
 *                        + auto-created back-relation "Program" → Programs DB
 */
export function useNotionPrograms() {
  const cfg = useNotionConfig();

  const [status,      setStatus]      = useState<ConfigStatus>('checking');
  const [notionToken, setToken]       = useState<string | null>(null);

  const [program,     setProgram]     = useState<ProgramSummary | null>(null);
  const [today,       setToday]       = useState<TodaysProgramDay | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  // ── Resolve auth + config on mount (and whenever config changes) ──────────
  useEffect(() => {
    if (!cfg.workerUrl || !cfg.programsDbId) {
      setStatus('no_config');
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      const token = session?.provider_token ?? null;
      setToken(token);
      setStatus(token ? 'ready' : 'no_auth');
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const token = session?.provider_token ?? null;
      setToken(token);
      setStatus(
        !cfg.workerUrl || !cfg.programsDbId ? 'no_config'
        : token                             ? 'ready'
        :                                     'no_auth',
      );
    });

    return () => listener.subscription.unsubscribe();
  }, [cfg.workerUrl, cfg.programsDbId]);

  // ── Fetch active program + schedule once authenticated ────────────────────
  useEffect(() => {
    if (status !== 'ready' || !notionToken) return;
    void loadSchedule(notionToken);
  }, [status, notionToken, cfg.workerUrl, cfg.programsDbId, cfg.daysDbId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadSchedule(token: string): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      // 1. Fetch program list
      const programsRes = await fetch(`${cfg.workerUrl}/api/programs`, {
        headers: {
          'Authorization':          `Bearer ${token}`,
          'X-Programs-Database-Id': cfg.programsDbId,
        },
      });
      if (!programsRes.ok) {
        const body = await programsRes.json() as { error?: string };
        throw new Error(body.error ?? 'Failed to load programs');
      }
      const programs = (await programsRes.json()) as ProgramSummary[];

      // 2. Pick the active program (MVP: single enrolment)
      const active = programs.find((p) => p.is_active) ?? null;
      setProgram(active);

      if (!active) {
        setToday(null);
        return;
      }

      // 3. Calculate Week / Day from start_date and today
      const position = calculateCurrentDay(active.start_date, active.duration_weeks);
      if (!position) {
        // Program hasn't started yet or has already ended
        setToday(null);
        return;
      }

      // 4. Fetch the day schedule (non-fatal if daysDbId not configured)
      if (!cfg.daysDbId) {
        setToday({
          program_id:   active.id,
          program_name: active.name,
          week:         position.week,
          day:          position.day,
          total_weeks:  active.duration_weeks,
          day_info:     null,
          is_rest_day:  false,
        });
        return;
      }

      const scheduleRes = await fetch(`${cfg.workerUrl}/api/program/${active.id}/schedule`, {
        headers: {
          'Authorization':      `Bearer ${token}`,
          'X-Days-Database-Id': cfg.daysDbId,
        },
      });

      if (!scheduleRes.ok) {
        // Non-fatal — still surface position without day info
        setToday({
          program_id:   active.id,
          program_name: active.name,
          week:         position.week,
          day:          position.day,
          total_weeks:  active.duration_weeks,
          day_info:     null,
          is_rest_day:  false,
        });
        return;
      }

      const days     = (await scheduleRes.json()) as ProgramDay[];
      const dayInfo  = days.find((d) => d.week === position.week && d.day === position.day) ?? null;

      setToday({
        program_id:   active.id,
        program_name: active.name,
        week:         position.week,
        day:          position.day,
        total_weeks:  active.duration_weeks,
        day_info:     dayInfo,
        is_rest_day:  dayInfo?.is_rest_day ?? false,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  // ── Fetch the full workout block tree for today's scheduled workout ────────
  const fetchTodaysWorkoutAST = useCallback(async (): Promise<WorkoutAST | null> => {
    const workoutId = today?.day_info?.workout_template_id;
    if (!workoutId || !notionToken || !cfg.blocksDbId) return null;

    try {
      const r = await fetch(`${cfg.workerUrl}/api/workout/${workoutId}`, {
        headers: {
          'Authorization':        `Bearer ${notionToken}`,
          'X-Blocks-Database-Id': cfg.blocksDbId,
        },
      });
      if (!r.ok) return null;
      return (await r.json()) as WorkoutAST;
    } catch {
      return null;
    }
  }, [notionToken, today, cfg.workerUrl, cfg.blocksDbId]);

  // ── Trigger Notion OAuth (same flow as useNotionWorkouts) ─────────────────
  const connectNotion = useCallback(async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'notion',
      options: { redirectTo: window.location.origin },
    });
  }, []);

  return {
    /** Current configuration / auth state. */
    status,
    /** The user's active training program, or null if none found. */
    program,
    /**
     * Today's resolved Week/Day position and matching schedule entry.
     * Null if no active program, or program hasn't started / has ended.
     */
    today,
    /** True while the initial program fetch is in flight. */
    loading,
    /** Error string if the program fetch failed. */
    error,
    /**
     * Fetch the full WorkoutBlock tree for today's scheduled workout.
     * Returns null when today is a rest day, unscheduled, or blocks DB not configured.
     */
    fetchTodaysWorkoutAST,
    /** Trigger the Notion OAuth flow (re-uses Supabase signInWithOAuth). */
    connectNotion,
  };
}
