import { get, set } from 'idb-keyval';
import { supabase } from './supabase';

const SYNC_QUEUE_KEY = 'galawgaw_sync_queue';

export interface SessionResult {
  workout_id: string;
  date: string; // ISO String
  pre_readiness_score: number;
  post_fatigue_score?: number;
  completion_ratio: number;
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

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    console.log("Not authenticated with Notion. Sync deferred.");
    return; // Wait until they authenticate
  }

  console.log(`Attempting to sync ${queue.length} sessions to Notion...`);

  const failedItems: SessionResult[] = [];

  for (const item of queue) {
    try {
      // Worker API Route created in Workstream 1
      const response = await fetch('/api/sync/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify(item)
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
