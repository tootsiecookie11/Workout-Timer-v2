import { get, set } from 'idb-keyval';
import { supabase } from './supabase';

const SYNC_QUEUE_KEY   = 'galawgaw_sync_queue';
const WORKER_URL       = (import.meta.env.VITE_WORKER_URL        as string | undefined) ?? '';
const SESSIONS_DB_ID   = (import.meta.env.VITE_NOTION_SESSIONS_DB_ID as string | undefined) ?? '';

export interface SessionResult {
  workout_id:          string;
  date:                string;
  pre_readiness_score: number;
  post_fatigue_score?: number;
  completion_ratio:    number;
  duration_ms?:        number;
}

// 1. Save Session locally
export async function queueSessionForSync(session: SessionResult) {
  const queue = (await get<SessionResult[]>(SYNC_QUEUE_KEY)) || [];
  queue.push(session);
  await set(SYNC_QUEUE_KEY, queue);
  
  // Attempt sync immediately, but fail gracefully if offline
  triggerBackgroundSync();
}

// 2. Trigger the sync process
export async function triggerBackgroundSync() {
  if (!navigator.onLine) {
    console.log("Offline. Sync deferred.");
    return;
  }

  const queue = (await get<SessionResult[]>(SYNC_QUEUE_KEY)) || [];
  if (queue.length === 0) return;

  if (!WORKER_URL || !SESSIONS_DB_ID) {
    console.log("Worker not configured. Sync deferred.");
    return;
  }

  const { data: { session } } = await supabase.auth.getSession();
  // provider_token is the Notion OAuth token; access_token is the Supabase JWT
  const notionToken = session?.provider_token;
  if (!notionToken) {
    console.log("Notion not connected. Sync deferred.");
    return;
  }

  console.log(`Attempting to sync ${queue.length} sessions to Notion...`);

  const failedItems: SessionResult[] = [];

  for (const item of queue) {
    try {
      const response = await fetch(`${WORKER_URL}/api/sync/session`, {
        method: 'POST',
        headers: {
          'Content-Type':           'application/json',
          'Authorization':          `Bearer ${notionToken}`,
          'X-Sessions-Database-Id': SESSIONS_DB_ID,
        },
        body: JSON.stringify(item),
      });

      if (!response.ok) {
        throw new Error(`Sync failed with status: ${response.status}`);
      }
    } catch (err) {
      console.warn("Failed to sync session chunk, keeping in queue.", err);
      failedItems.push(item);
    }
  }

  // Update IDB with items that failed so we can retry later
  await set(SYNC_QUEUE_KEY, failedItems);
}

// Automatically bind to online recovery
if (typeof window !== 'undefined') {
  window.addEventListener('online', triggerBackgroundSync);
}
