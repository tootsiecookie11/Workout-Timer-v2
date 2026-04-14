import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useNotionConfig } from './useNotionConfig';
import type { WorkoutBlock } from '../engine/types';

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
  | 'no_config'    // worker URL or DB ID not set (neither env var nor settings store)
  | 'ready';       // token + config present — can fetch

// ─── Main hook ────────────────────────────────────────────────────────────────

/**
 * Fetches the workout list from the Galawgaw worker API.
 * Also exposes helpers to fetch per-workout blocks and fatigue scores.
 *
 * Config resolution:
 *   DB IDs come from settingsStore (user-entered in Settings → Notion Vault)
 *   with VITE_NOTION_*_DB_ID env vars as fallbacks. useNotionConfig() handles
 *   the merge so developers can rely on .env files without touching the UI.
 *
 * Auth flow:
 *   1. User signs in via Supabase Notion OAuth → session.provider_token = Notion access token.
 *   2. That token is forwarded as `Authorization: Bearer <token>` to the worker.
 *   3. The worker calls Notion APIs on the user's behalf.
 */
export function useNotionWorkouts() {
  const cfg = useNotionConfig();

  const [status, setStatus]     = useState<ConfigStatus>('checking');
  const [notionToken, setToken] = useState<string | null>(null);

  const [workouts, setWorkouts] = useState<WorkoutSummary[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // ── Resolve auth + config on mount (and whenever config changes) ──────────
  useEffect(() => {
    if (!cfg.workerUrl || !cfg.workoutsDbId) {
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
        !cfg.workerUrl || !cfg.workoutsDbId
          ? 'no_config'
          : token
          ? 'ready'
          : 'no_auth',
      );
    });

    return () => listener.subscription.unsubscribe();
  }, [cfg.workerUrl, cfg.workoutsDbId]);

  // ── Fetch workout list once token + config are available ──────────────────
  useEffect(() => {
    if (status !== 'ready' || !notionToken) return;

    setLoading(true);
    setError(null);

    fetch(`${cfg.workerUrl}/api/workouts`, {
      headers: {
        'Authorization':          `Bearer ${notionToken}`,
        'X-Workouts-Database-Id': cfg.workoutsDbId,
      },
    })
      .then((r) => r.ok
        ? r.json()
        : r.json().then((body: any) => Promise.reject(new Error(body?.error ?? 'Failed to load workouts')))
      )
      .then((data: WorkoutSummary[]) => setWorkouts(data))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [status, notionToken, refreshKey, cfg.workerUrl, cfg.workoutsDbId]);

  // ── Fetch fatigue score for a specific workout ────────────────────────────
  const fetchFatigue = useCallback(
    async (workoutId: string): Promise<WorkoutFatigue | null> => {
      if (!notionToken || !cfg.sessionsDbId) return null;
      try {
        const r = await fetch(`${cfg.workerUrl}/api/fatigue/${workoutId}`, {
          headers: {
            'Authorization':          `Bearer ${notionToken}`,
            'X-Sessions-Database-Id': cfg.sessionsDbId,
          },
        });
        if (!r.ok) return null;
        return (await r.json()) as WorkoutFatigue;
      } catch {
        return null;
      }
    },
    [notionToken, cfg.workerUrl, cfg.sessionsDbId],
  );

  // ── Fetch full workout AST (blocks) for a specific workout ────────────────
  const fetchWorkoutAST = useCallback(
    async (workoutId: string): Promise<WorkoutAST | null> => {
      if (!notionToken || !cfg.blocksDbId) return null;
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
    },
    [notionToken, cfg.workerUrl, cfg.blocksDbId],
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
    canFetchFatigue: !!cfg.sessionsDbId,
    /** Re-fetch the workout list */
    refresh,
  };
}
