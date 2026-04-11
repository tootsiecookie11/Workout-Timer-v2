import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { WorkoutBlock } from '../engine/types';

// ─── Env config ───────────────────────────────────────────────────────────────
// Set these in app/.env (or .env.local):
//   VITE_WORKER_URL               https://your-worker.workers.dev
//   VITE_NOTION_WORKOUTS_DB_ID    <notion workouts database id>
//   VITE_NOTION_BLOCKS_DB_ID      <notion blocks database id>
//   VITE_NOTION_SESSIONS_DB_ID    <notion sessions database id>

const WORKER_URL      = (import.meta.env.VITE_WORKER_URL      as string | undefined) ?? '';
const WORKOUTS_DB_ID  = (import.meta.env.VITE_NOTION_WORKOUTS_DB_ID as string | undefined) ?? '';
const BLOCKS_DB_ID    = (import.meta.env.VITE_NOTION_BLOCKS_DB_ID   as string | undefined) ?? '';
const SESSIONS_DB_ID  = (import.meta.env.VITE_NOTION_SESSIONS_DB_ID as string | undefined) ?? '';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkoutSummary {
  id:                      string;
  name:                    string;
  description:             string;
  estimated_duration_min?: number;
  tags:                    string[];
}

export interface WorkoutFatigue {
  fatigue_score:      number;
  sessions_analyzed:  number;
  trend:              'improving' | 'declining' | 'stable';
}

export interface WorkoutAST {
  workout_id: string;
  name:       string;
  blocks:     WorkoutBlock[];
  loaded_at:  string;
}

export type ConfigStatus =
  | 'checking'     // still awaiting auth session resolve
  | 'no_auth'      // Supabase session exists but no provider_token (Notion not connected)
  | 'no_config'    // env vars missing (WORKER_URL or WORKOUTS_DB_ID not set)
  | 'ready';       // token + config present — can fetch

// ─── Main hook ────────────────────────────────────────────────────────────────

/**
 * Fetches the workout list from the Galawgaw worker API.
 * Also exposes helpers to fetch per-workout blocks and fatigue scores.
 *
 * Auth flow:
 *   1. User signs in via Supabase Notion OAuth → session.provider_token = Notion access token.
 *   2. That token is forwarded as `Authorization: Bearer <token>` to the worker.
 *   3. The worker calls Notion APIs on the user's behalf.
 */
export function useNotionWorkouts() {
  const [status, setStatus]     = useState<ConfigStatus>('checking');
  const [notionToken, setToken] = useState<string | null>(null);

  const [workouts, setWorkouts] = useState<WorkoutSummary[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // ── Resolve auth + env on mount ──────────────────────────────────────────
  useEffect(() => {
    if (!WORKER_URL || !WORKOUTS_DB_ID) {
      setStatus('no_config');
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      const token = session?.provider_token ?? null;
      setToken(token);
      setStatus(token ? 'ready' : 'no_auth');
    });

    // Also listen for auth state changes (e.g. after OAuth callback)
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const token = session?.provider_token ?? null;
      setToken(token);
      setStatus(
        !WORKER_URL || !WORKOUTS_DB_ID
          ? 'no_config'
          : token
          ? 'ready'
          : 'no_auth',
      );
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // ── Fetch workout list once token is available ──────────────────────────
  useEffect(() => {
    if (status !== 'ready' || !notionToken) return;

    setLoading(true);
    setError(null);

    fetch(`${WORKER_URL}/api/workouts`, {
      headers: {
        'Authorization':         `Bearer ${notionToken}`,
        'X-Workouts-Database-Id': WORKOUTS_DB_ID,
      },
    })
      .then((r) => r.ok
        ? r.json()
        : r.json().then((body: any) => Promise.reject(new Error(body?.error ?? 'Failed to load workouts')))
      )
      .then((data: WorkoutSummary[]) => setWorkouts(data))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [status, notionToken, refreshKey]);

  // ── Fetch fatigue score for a specific workout ────────────────────────────
  const fetchFatigue = useCallback(
    async (workoutId: string): Promise<WorkoutFatigue | null> => {
      if (!notionToken || !SESSIONS_DB_ID) return null;
      try {
        const r = await fetch(`${WORKER_URL}/api/fatigue/${workoutId}`, {
          headers: {
            'Authorization':          `Bearer ${notionToken}`,
            'X-Sessions-Database-Id': SESSIONS_DB_ID,
          },
        });
        if (!r.ok) return null;
        return (await r.json()) as WorkoutFatigue;
      } catch {
        return null;
      }
    },
    [notionToken],
  );

  // ── Fetch full workout AST (blocks) for a specific workout ────────────────
  const fetchWorkoutAST = useCallback(
    async (workoutId: string): Promise<WorkoutAST | null> => {
      if (!notionToken || !BLOCKS_DB_ID) return null;
      try {
        const r = await fetch(`${WORKER_URL}/api/workout/${workoutId}`, {
          headers: {
            'Authorization':       `Bearer ${notionToken}`,
            'X-Blocks-Database-Id': BLOCKS_DB_ID,
          },
        });
        if (!r.ok) return null;
        return (await r.json()) as WorkoutAST;
      } catch {
        return null;
      }
    },
    [notionToken],
  );

  // ── Re-fetch the workout list ─────────────────────────────────────────────
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // ── Trigger Notion OAuth via Supabase ─────────────────────────────────────
  const connectNotion = useCallback(async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'notion',
      options: { redirectTo: window.location.origin },
    });
  }, []);

  return {
    /** Current configuration / auth state */
    status,
    /** List of workout summaries from Notion */
    workouts,
    /** True while the initial workout list is loading */
    loading,
    /** Error string if the workout list fetch failed */
    error,
    /** Fetch fatigue score for a given workout id */
    fetchFatigue,
    /** Fetch full WorkoutBlock tree for a given workout id */
    fetchWorkoutAST,
    /** Trigger the Notion OAuth flow */
    connectNotion,
    /** Whether per-workout fatigue fetching is possible (sessions DB configured) */
    canFetchFatigue: !!SESSIONS_DB_ID,
    /** Re-fetch the workout list */
    refresh,
  };
}
