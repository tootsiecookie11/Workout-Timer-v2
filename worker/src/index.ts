import { Hono } from 'hono';

type Bindings = {
  // Bindings like KV, format: MY_KV: KVNamespace
};

const app = new Hono<{ Bindings: Bindings }>();

// Healthcheck
app.get('/', (c) => c.text('Galawgaw Worker API is running'));

import { NotionService } from './notion';

// Endpoint: Fetch Notion Workout and Translate to AST
// This represents the bridge required in Phase 2 Workstream 1
app.get('/api/workout/:id', async (c) => {
  const workoutId = c.req.param('id');
  
  // The Notion DB ID and User Access Token will eventually come from Supabase / KV mapping.
  // For now, we expect them as headers for testing purposes.
  const auth = c.req.header('Authorization')?.replace('Bearer ', '');
  const blocksDatabaseId = c.req.header('X-Blocks-Database-Id');

  if (!auth || !blocksDatabaseId) {
    return c.json({ error: "Missing Authorization token or X-Blocks-Database-Id header." }, 401);
  }

  try {
    const notionService = new NotionService(auth);
    console.log(`Fetching workout ${workoutId} and building AST...`);
    
    // Process Workstream 1: Traversing Notion Blocks and producing standard AST
    const workoutAST = await notionService.buildWorkoutAST(workoutId, blocksDatabaseId);
    
    return c.json(workoutAST);
  } catch (error: any) {
    console.error("Error building workout AST:", error);
    return c.json({ error: "Failed to parse AST from Notion", details: error.message }, 500);
  }
});

// Endpoint: Write-back Session Results to Notion
// This represents Phase 2 Workstream 3
app.post('/api/sync/session', async (c) => {
  // TODO: Receive session JSON from Client IndexedDB
  // const sessionResult = await c.req.json();
  
  // TODO: Format Notion API request and execute Write
  
  return c.json({ success: true, message: "Session results accepted for sync queue" });
});

// Endpoint: Check Dirty State
// This represents Phase 2 Workstream 4
app.get('/api/workout/:id/dirty', async (c) => {
  const workoutId = c.req.param('id');
  const since = c.req.query('since'); // Expected as ISO string
  const auth = c.req.header('Authorization')?.replace('Bearer ', '');

  if (!auth || !since) {
    return c.json({ error: "Missing Authorization token or 'since' query parameter." }, 401);
  }

  try {
    const notionService = new NotionService(auth);
    const isDirty = await notionService.checkDirtyState(workoutId, since);
    return c.json({ isDirty });
  } catch (error: any) {
    console.error("Error checking dirty state:", error);
    return c.json({ error: "Failed to check dirty state from Notion", details: error.message }, 500);
  }
});

export default app;
