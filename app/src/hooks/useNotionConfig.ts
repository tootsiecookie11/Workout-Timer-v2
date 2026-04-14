import { useMemo } from 'react';
import { useSettingsStore } from '../store/settingsStore';

// ─── Resolved config shape ────────────────────────────────────────────────────

/**
 * Fully-resolved Notion connection config consumed by every Notion hook.
 *
 * Priority for each DB ID:
 *   1. settingsStore value (user-entered in Settings → Notion Vault) if non-empty
 *   2. Corresponding VITE_NOTION_*_DB_ID env var
 *   3. '' (not configured)
 *
 * workerUrl and daysDbId have no UI equivalent yet — they come from env only.
 */
export interface NotionConfigResolved {
  /** Galawgaw Cloudflare Worker base URL — env-var only. */
  workerUrl:    string;
  workoutsDbId: string;
  blocksDbId:   string;
  programsDbId: string;
  sessionsDbId: string;
  /** Program Days DB — env-var only until a UI settings field is added. */
  daysDbId:     string;
}

// ─── Merge helper ─────────────────────────────────────────────────────────────

/** Returns stored value when non-empty, otherwise the env-var fallback. */
function merge(stored: string, envVal: string | undefined): string {
  return stored.trim() !== '' ? stored.trim() : (envVal ?? '');
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Merges user-supplied Notion database IDs (persisted in settingsStore /
 * localStorage) with env-var defaults so developers can rely on .env files
 * while end-users can configure IDs directly in the app.
 *
 * The returned object is memoized — its reference only changes when the user
 * actually edits a setting, making it safe to include in useEffect dep arrays.
 */
export function useNotionConfig(): NotionConfigResolved {
  const stored = useSettingsStore((s) => s.notionConfig);

  return useMemo(
    () => ({
      workerUrl:    (import.meta.env.VITE_WORKER_URL as string | undefined) ?? '',
      workoutsDbId: merge(stored.workoutsDatabaseId, import.meta.env.VITE_NOTION_WORKOUTS_DB_ID as string | undefined),
      blocksDbId:   merge(stored.blocksDatabaseId,   import.meta.env.VITE_NOTION_BLOCKS_DB_ID   as string | undefined),
      programsDbId: merge(stored.programsDatabaseId, import.meta.env.VITE_NOTION_PROGRAMS_DB_ID as string | undefined),
      sessionsDbId: merge(stored.sessionsDatabaseId, import.meta.env.VITE_NOTION_SESSIONS_DB_ID as string | undefined),
      daysDbId:     (import.meta.env.VITE_NOTION_PROGRAM_DAYS_DB_ID as string | undefined) ?? '',
    }),
    [stored],
  );
}
