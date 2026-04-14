import { Hono } from 'hono';
import { NotionService } from './notion';
import { supabaseAuth } from './supabaseAuth';
import type { SupabaseAuthBindings } from './supabaseAuth';
import { parseDSL, DSLError } from './dslParser';

type Bindings = SupabaseAuthBindings & {
  // KV, D1, or other Cloudflare bindings go here
  // SESSIONS_DATABASE_ID?: string;  (could be env var via wrangler.toml)
};

const app = new Hono<{ Bindings: Bindings }>();

// ─── Middleware: extract auth + validate ──────────────────────────────────────

function getAuth(c: any): string | null {
  return c.req.header('Authorization')?.replace('Bearer ', '') ?? null;
}

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/', (c) => c.text('Galawgaw Worker API v2 is running'));

// ─── GET /api/workouts ────────────────────────────────────────────────────────
// List all workout pages from a Notion workouts database.
//
// Required headers:
//   Authorization: Bearer <notion_token>
//   X-Workouts-Database-Id: <notion_db_id>

app.get('/api/workouts', async (c) => {
  const auth               = getAuth(c);
  const workoutsDatabaseId = c.req.header('X-Workouts-Database-Id');

  if (!auth || !workoutsDatabaseId) {
    return c.json({ error: 'Missing Authorization or X-Workouts-Database-Id header.' }, 401);
  }

  try {
    const svc      = new NotionService(auth);
    const workouts = await svc.listWorkouts(workoutsDatabaseId);
    return c.json(workouts);
  } catch (err: any) {
    console.error('[workouts] Error:', err);
    return c.json({ error: 'Failed to list workouts', details: err.message }, 500);
  }
});

// ─── GET /api/workout/:id ─────────────────────────────────────────────────────
// Fetch a Notion workout page and return a fully-typed WorkoutBlock tree.
// The DSL condition strings are validated server-side; invalid ones are logged
// and omitted rather than blocking the response.

app.get('/api/workout/:id', async (c) => {
  const workoutId        = c.req.param('id');
  const auth             = getAuth(c);
  const blocksDatabaseId = c.req.header('X-Blocks-Database-Id');

  if (!auth || !blocksDatabaseId) {
    return c.json({ error: 'Missing Authorization or X-Blocks-Database-Id header.' }, 401);
  }

  try {
    const svc = new NotionService(auth);
    const ast = await svc.buildWorkoutAST(workoutId, blocksDatabaseId);
    return c.json(ast);
  } catch (err: any) {
    console.error('[workout] Error:', err);
    return c.json({ error: 'Failed to fetch workout from Notion', details: err.message }, 500);
  }
});

// ─── GET /api/workout/:id/sessions ───────────────────────────────────────────
// Return recent session history for a workout — used by the Program Engine
// to determine whether today's lift has already been completed.
//
// Required headers:
//   Authorization: Bearer <notion_token>
//   X-Sessions-Database-Id: <notion_db_id>
//
// Optional query param:
//   limit   integer, default 10, max 50
//
// Response: SessionHistoryRecord[]
//   [ { date, completion_ratio, post_fatigue_score?, pre_readiness_score? }, … ]

app.get('/api/workout/:id/sessions', async (c) => {
  const workoutId          = c.req.param('id');
  const auth               = getAuth(c);
  const sessionsDatabaseId = c.req.header('X-Sessions-Database-Id');
  const limit              = Math.min(Number(c.req.query('limit') ?? '10'), 50);

  if (!auth || !sessionsDatabaseId) {
    return c.json({ error: 'Missing Authorization or X-Sessions-Database-Id header.' }, 401);
  }

  try {
    const svc      = new NotionService(auth);
    const sessions = await svc.fetchSessionHistory(workoutId, sessionsDatabaseId, limit);
    return c.json(sessions);
  } catch (err: any) {
    console.error('[workout/sessions] Error:', err);
    return c.json({ error: 'Failed to fetch session history', details: err.message }, 500);
  }
});

// ─── GET /api/workout/:id/dirty ───────────────────────────────────────────────
// Check if a workout was edited after a given timestamp (mid-session polling).

app.get('/api/workout/:id/dirty', async (c) => {
  const workoutId = c.req.param('id');
  const since     = c.req.query('since');
  const auth      = getAuth(c);

  if (!auth || !since) {
    return c.json({ error: "Missing Authorization or 'since' query parameter." }, 401);
  }

  try {
    const svc     = new NotionService(auth);
    const isDirty = await svc.checkDirtyState(workoutId, since);
    return c.json({ isDirty });
  } catch (err: any) {
    console.error('[dirty] Error:', err);
    return c.json({ error: 'Failed to check dirty state', details: err.message }, 500);
  }
});

// ─── POST /api/sync/session ───────────────────────────────────────────────────
// Write a completed session result to the Notion sessions database.
//
// Body (JSON):
//   workout_id           string   (Notion page id)
//   date                 string   (ISO)
//   pre_readiness_score  number   0–10
//   post_fatigue_score?  number   0–10
//   completion_ratio     number   0–1
//   duration_ms?         number
//
// Required headers:
//   Authorization: Bearer <notion_token>
//   X-Sessions-Database-Id: <notion_db_id>

app.post('/api/sync/session', async (c) => {
  const auth              = getAuth(c);
  const sessionsDatabaseId = c.req.header('X-Sessions-Database-Id');

  if (!auth || !sessionsDatabaseId) {
    return c.json({ error: 'Missing Authorization or X-Sessions-Database-Id header.' }, 401);
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body.' }, 400);
  }

  const { workout_id, date, pre_readiness_score, post_fatigue_score, completion_ratio, duration_ms } = body;

  if (!workout_id || !date || completion_ratio === undefined || pre_readiness_score === undefined) {
    return c.json({ error: 'Missing required fields: workout_id, date, pre_readiness_score, completion_ratio.' }, 400);
  }

  try {
    const svc = new NotionService(auth);
    await svc.writeSyncSession(
      { workout_id, date, pre_readiness_score, post_fatigue_score, completion_ratio, duration_ms },
      sessionsDatabaseId,
    );
    return c.json({ success: true, message: 'Session synced to Notion.' });
  } catch (err: any) {
    console.error('[sync] Error:', err);
    return c.json({ error: 'Failed to write session to Notion', details: err.message }, 500);
  }
});

// ─── GET /api/fatigue/:id ─────────────────────────────────────────────────────
// Fetch recent session history for a workout and return a computed fatigue score.
//
// Required headers:
//   Authorization: Bearer <notion_token>
//   X-Sessions-Database-Id: <notion_db_id>
//
// Response:
//   { fatigue_score: number, sessions_analyzed: number, trend: 'improving'|'declining'|'stable' }

app.get('/api/fatigue/:id', async (c) => {
  const workoutId        = c.req.param('id');
  const auth             = getAuth(c);
  const sessionsDatabaseId = c.req.header('X-Sessions-Database-Id');

  if (!auth || !sessionsDatabaseId) {
    return c.json({ error: 'Missing Authorization or X-Sessions-Database-Id header.' }, 401);
  }

  try {
    const svc  = new NotionService(auth);
    const data = await svc.getFatigueData(workoutId, sessionsDatabaseId);
    return c.json(data);
  } catch (err: any) {
    console.error('[fatigue] Error:', err);
    return c.json({ error: 'Failed to compute fatigue score', details: err.message }, 500);
  }
});

// ─── GET /api/programs ────────────────────────────────────────────────────────
// List all workout programs from the user's Notion programs database.
//
// Required headers:
//   Authorization: Bearer <notion_token>
//   X-Programs-Database-Id: <notion_db_id>

app.get('/api/programs', async (c) => {
  const auth               = getAuth(c);
  const programsDatabaseId = c.req.header('X-Programs-Database-Id');

  if (!auth || !programsDatabaseId) {
    return c.json({ error: 'Missing Authorization or X-Programs-Database-Id header.' }, 401);
  }

  try {
    const svc      = new NotionService(auth);
    const programs = await svc.listPrograms(programsDatabaseId);
    return c.json(programs);
  } catch (err: any) {
    console.error('[programs] Error:', err);
    return c.json({ error: 'Failed to list programs', details: err.message }, 500);
  }
});

// ─── GET /api/program/:id/schedule ───────────────────────────────────────────
// Fetch the full ordered day schedule for a given program.
//
// Required headers:
//   Authorization: Bearer <notion_token>
//   X-Days-Database-Id: <notion_program_days_db_id>
//
// Response: ProgramDay[]
//   [ { id, week, day, workout_template_id, is_rest_day, notes }, … ]

app.get('/api/program/:id/schedule', async (c) => {
  const programId     = c.req.param('id');
  const auth          = getAuth(c);
  const daysDatabaseId = c.req.header('X-Days-Database-Id');

  if (!auth || !daysDatabaseId) {
    return c.json({ error: 'Missing Authorization or X-Days-Database-Id header.' }, 401);
  }

  try {
    const svc  = new NotionService(auth);
    const days = await svc.getProgramSchedule(programId, daysDatabaseId);
    return c.json(days);
  } catch (err: any) {
    console.error('[program/schedule] Error:', err);
    return c.json({ error: 'Failed to fetch program schedule', details: err.message }, 500);
  }
});

// ─── POST /api/parse-dsl ──────────────────────────────────────────────────────
// Parse a DSL condition string server-side and return the typed ASTNode.
// All parsing logic runs here so untrusted DSL strings never reach the client
// evaluator. (PRD §5.9)
//
// Required headers:
//   Authorization: Bearer <supabase_jwt>
//
// Body (JSON):
//   dsl   string   A DSL condition expression, e.g. "reps >= 5 && round <= 3"
//
// Response 200:
//   { ast: ASTNode }
//
// Response 422 (parse error):
//   { error: string, pretty: string, span: { start: number, end: number } }
//
// Response 401 (auth failure):
//   { error: string }

app.post('/api/parse-dsl', supabaseAuth, async (c) => {
  let body: { dsl?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body.' }, 400);
  }

  const { dsl } = body;
  if (typeof dsl !== 'string' || !dsl.trim()) {
    return c.json({ error: 'Missing or empty "dsl" field (must be a non-empty string).' }, 400);
  }

  try {
    const ast = parseDSL(dsl);
    return c.json({ ast });
  } catch (err) {
    if (err instanceof DSLError) {
      return c.json(
        { error: err.message, pretty: err.pretty(), span: err.span },
        422,
      );
    }
    console.error('[parse-dsl] Unexpected error:', err);
    return c.json({ error: 'Internal server error while parsing DSL.' }, 500);
  }
});

export default app;
