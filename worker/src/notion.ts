import { Client } from '@notionhq/client';

// ─── Shared types (mirrors app/src/engine/types.ts) ──────────────────────────
// Duplicated here so the worker remains a self-contained package.

type BlockType = 'exercise' | 'rest' | 'superset' | 'circuit' | 'amrap' | 'emom' | 'conditional';

export interface WorkoutBlock {
  id:            string;
  type:          BlockType;
  label:         string;
  duration_ms?:  number;
  reps?:         number;
  rest_after_ms?: number;
  rounds?:       number;
  children?:     WorkoutBlock[];
  /** Raw DSL condition string — parsed by the frontend's dslParser. */
  condition?:    string;
}

export interface WorkoutAST {
  workout_id: string;
  name:       string;
  blocks:     WorkoutBlock[];
  loaded_at:  string;
}

// ─── DSL Validator (server-side tokenizer) ────────────────────────────────────
//
// Does NOT build a full AST — the frontend parser handles that.
// The worker only validates that the raw DSL string is syntactically legal
// so it can flag bad conditions before they reach the client.

type VTokenType =
  | 'IDENT' | 'NUMBER' | 'FLOAT' | 'STRING' | 'DURATION'
  | 'GTE' | 'LTE' | 'GT' | 'LT' | 'EQ' | 'NEQ'
  | 'AND' | 'OR' | 'NOT' | 'MOD'
  | 'LPAREN' | 'RPAREN' | 'LBRACKET' | 'RBRACKET' | 'COMMA'
  | 'KEYWORD' | 'EOF';

interface VToken { type: VTokenType; pos: number; }

interface ValidationResult {
  valid:      boolean;
  condition:  string;   // normalized (trimmed) input returned as-is
  error?:     string;
  errorPos?:  number;
}

const KNOWN_KEYWORDS = new Set(['always', 'in', 'true', 'false', 'null']);
const DURATION_SFXS  = new Set(['s', 'm', 'h']);

function tokenizeForValidation(src: string): VToken[] | { error: string; pos: number } {
  const tokens: VToken[] = [];
  let i = 0;

  while (i < src.length) {
    if (/\s/.test(src[i])) { i++; continue; }
    const start = i;

    // Two-char operators
    const two = src.slice(i, i + 2);
    if (two === '>=') { i += 2; tokens.push({ type: 'GTE', pos: start }); continue; }
    if (two === '<=') { i += 2; tokens.push({ type: 'LTE', pos: start }); continue; }
    if (two === '==') { i += 2; tokens.push({ type: 'EQ',  pos: start }); continue; }
    if (two === '!=') { i += 2; tokens.push({ type: 'NEQ', pos: start }); continue; }
    if (two === '&&') { i += 2; tokens.push({ type: 'AND', pos: start }); continue; }
    if (two === '||') { i += 2; tokens.push({ type: 'OR',  pos: start }); continue; }

    const ch = src[i];
    switch (ch) {
      case '>': tokens.push({ type: 'GT',       pos: start }); i++; continue;
      case '<': tokens.push({ type: 'LT',       pos: start }); i++; continue;
      case '!': tokens.push({ type: 'NOT',      pos: start }); i++; continue;
      case '%': tokens.push({ type: 'MOD',      pos: start }); i++; continue;
      case '(': tokens.push({ type: 'LPAREN',   pos: start }); i++; continue;
      case ')': tokens.push({ type: 'RPAREN',   pos: start }); i++; continue;
      case '[': tokens.push({ type: 'LBRACKET', pos: start }); i++; continue;
      case ']': tokens.push({ type: 'RBRACKET', pos: start }); i++; continue;
      case ',': tokens.push({ type: 'COMMA',    pos: start }); i++; continue;
    }

    // Number / float / duration
    if (/[0-9]/.test(ch)) {
      while (i < src.length && /[0-9]/.test(src[i])) i++;
      if (src[i] === '.' && /[0-9]/.test(src[i + 1] ?? '')) {
        i++;
        while (i < src.length && /[0-9]/.test(src[i])) i++;
      }
      if (DURATION_SFXS.has(src[i])) {
        i++;
        tokens.push({ type: 'DURATION', pos: start });
      } else {
        tokens.push({ type: 'NUMBER', pos: start });
      }
      continue;
    }

    // String literal — double or single quoted
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i++; // skip escape
        i++;
      }
      if (i >= src.length) return { error: 'Unterminated string literal', pos: start };
      i++;
      tokens.push({ type: 'STRING', pos: start });
      continue;
    }

    // Identifier / keyword
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = '';
      while (i < src.length && /[a-zA-Z0-9_]/.test(src[i])) ident += src[i++];
      tokens.push({ type: KNOWN_KEYWORDS.has(ident) ? 'KEYWORD' : 'IDENT', pos: start });
      continue;
    }

    return { error: `Unexpected character '${ch}'`, pos: start };
  }

  tokens.push({ type: 'EOF', pos: src.length });
  return tokens;
}

function validateDSL(dslText: string): ValidationResult {
  const condition = dslText.trim();
  if (!condition) return { valid: true, condition };

  const result = tokenizeForValidation(condition);
  if ('error' in result) {
    return { valid: false, condition, error: result.error, errorPos: result.pos };
  }

  // Paren balance check
  let depth = 0;
  for (const tok of result) {
    if (tok.type === 'LPAREN')   depth++;
    if (tok.type === 'RPAREN') { depth--; if (depth < 0) return { valid: false, condition, error: 'Unexpected closing parenthesis', errorPos: tok.pos }; }
    if (tok.type === 'LBRACKET') depth++;
    if (tok.type === 'RBRACKET') depth--;
  }
  if (depth !== 0) return { valid: false, condition, error: 'Unmatched parenthesis or bracket' };

  return { valid: true, condition };
}

// ─── Fatigue calculation (mirrors fatigueEngine.ts algorithm) ─────────────────

export interface SessionHistoryRecord {
  date:                string;
  completion_ratio:    number;
  post_fatigue_score?: number;
  pre_readiness_score?: number;
}

const DECAY_LAMBDA = 0.35;
const MAX_SESSIONS = 10;
const SMOOTHING    = 0.2;

function estimateFromRatio(ratio: number): number {
  return 1 + (1 - Math.min(1, Math.max(0, ratio))) * 8;
}

export function computeFatigueScore(history: SessionHistoryRecord[]): number {
  if (history.length === 0) return 0;

  const recent = [...history]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, MAX_SESSIONS);

  let wSum = 0, wTotal = 0;
  for (let i = 0; i < recent.length; i++) {
    const s      = recent[i];
    const w      = Math.exp(-i * DECAY_LAMBDA);
    const raw    = s.post_fatigue_score ?? estimateFromRatio(s.completion_ratio);
    const adj    = s.pre_readiness_score !== undefined ? (1 - s.pre_readiness_score / 10) * 1.5 : 0;
    wSum  += Math.min(10, raw + adj) * w;
    wTotal += w;
  }

  const raw      = wTotal > 0 ? wSum / wTotal : 0;
  const smoothed = raw * (1 - SMOOTHING) + 5 * SMOOTHING;
  return Math.min(10, Math.max(0, Math.round(smoothed * 10) / 10));
}

// ─── Program types ────────────────────────────────────────────────────────────

export interface ProgramSummary {
  id:             string;
  name:           string;
  duration_weeks: number;
  goal:           string;
  /** ISO date string for when the program started (e.g. "2026-04-01"). */
  start_date:     string;
  is_active:      boolean;
}

/**
 * A single day entry within a program schedule.
 * `day` is 1-based (1 = first day of the week in the program, not necessarily Monday).
 */
export interface ProgramDay {
  id:                  string;
  week:                number;
  day:                 number;
  /** Notion page id of the linked Workout Template, or null for rest days. */
  workout_template_id: string | null;
  is_rest_day:         boolean;
  notes:               string;
}

// ─── NotionService ─────────────────────────────────────────────────────────────

export class NotionService {
  private client: Client;

  constructor(auth: string) {
    this.client = new Client({ auth });
  }

  // ── Workout fetch ────────────────────────────────────────────────────────

  async getWorkout(workoutId: string): Promise<any> {
    return this.client.pages.retrieve({ page_id: workoutId });
  }

  /**
   * Retrieve a Notion block page and map it to WorkoutBlock format.
   * The `condition` field is the raw DSL string; the frontend parses it.
   */
  async getWorkoutBlock(blockId: string): Promise<WorkoutBlock> {
    const block = (await this.client.pages.retrieve({ page_id: blockId })) as any;
    const props = block.properties;

    const label         = props.Name?.title?.[0]?.plain_text || 'Unknown';
    const type          = ((props['Block Type']?.select?.name?.toLowerCase()) || 'exercise') as BlockType;
    const durationSec   = props['Default Duration']?.number ?? 0;
    const reps          = props['Default Reps']?.number ?? 0;
    const restAfterSec  = props['Rest After']?.number ?? 0;
    const rounds        = props['Rounds']?.number ?? 0;
    const rawDSL        = props['DSL Rules']?.rich_text?.[0]?.plain_text ?? '';

    const result: WorkoutBlock = { id: block.id, type, label };

    if (durationSec)  result.duration_ms  = durationSec * 1000;
    if (reps)         result.reps         = reps;
    if (restAfterSec) result.rest_after_ms = restAfterSec * 1000;
    if (rounds)       result.rounds       = rounds;

    if (rawDSL) {
      const validation = validateDSL(rawDSL);
      if (validation.valid) {
        result.condition = validation.condition;
      } else {
        // Log bad DSL but don't block the workout load
        console.warn(`[DSL] Block "${label}" has invalid condition: ${validation.error} (pos ${validation.errorPos})`);
        console.warn(`[DSL] Raw: "${rawDSL}"`);
      }
    }

    return result;
  }

  /** Recursively fetch a block and all its children ordered by Order Index. */
  private async fetchBlockTree(blockId: string, blocksDatabaseId: string): Promise<WorkoutBlock> {
    const block = await this.getWorkoutBlock(blockId);

    const childQuery = await (this.client.databases as any).query({
      database_id: blocksDatabaseId,
      filter: { property: 'Parent Block', relation: { contains: blockId } },
      sorts:  [{ property: 'Order Index', direction: 'ascending' }],
    });

    if (childQuery.results.length > 0) {
      block.children = [];
      for (const child of childQuery.results) {
        block.children.push(await this.fetchBlockTree(child.id, blocksDatabaseId));
      }
    }

    return block;
  }

  /** Build the full workout block tree for a given Notion workout page. */
  async buildWorkoutAST(workoutId: string, blocksDatabaseId: string): Promise<WorkoutAST> {
    const workout = (await this.getWorkout(workoutId)) as any;
    const topRefs = workout.properties['Top-Level Blocks']?.relation ?? [];

    const blocks: WorkoutBlock[] = [];
    for (const rel of topRefs) {
      blocks.push(await this.fetchBlockTree(rel.id, blocksDatabaseId));
    }

    return {
      workout_id: workoutId,
      name:       workout.properties?.Name?.title?.[0]?.plain_text ?? 'Unknown Workout',
      blocks,
      loaded_at:  new Date().toISOString(),
    };
  }

  // ── Dirty state ──────────────────────────────────────────────────────────

  async checkDirtyState(workoutId: string, sinceIsoString: string): Promise<boolean> {
    const page = (await this.client.pages.retrieve({ page_id: workoutId })) as any;
    return new Date(page.last_edited_time).getTime() > new Date(sinceIsoString).getTime();
  }

  // ── Session sync (write back to Notion) ──────────────────────────────────

  /**
   * Write a completed session record to a Notion sessions database.
   *
   * Expected database properties:
   *   - Workout (relation)
   *   - Date (date)
   *   - Completion Ratio (number)
   *   - Pre Readiness (number)
   *   - Post Fatigue (number)
   *   - Duration (number — minutes)
   */
  async writeSyncSession(
    session: {
      workout_id:            string;
      date:                  string;
      pre_readiness_score:   number;
      post_fatigue_score?:   number;
      completion_ratio:      number;
      duration_ms?:          number;
    },
    sessionsDatabaseId: string,
  ): Promise<void> {
    const properties: Record<string, any> = {
      'Workout':          { relation: [{ id: session.workout_id }] },
      'Date':             { date: { start: session.date } },
      'Completion Ratio': { number: Math.round(session.completion_ratio * 100) / 100 },
      'Pre Readiness':    { number: session.pre_readiness_score },
    };

    if (session.post_fatigue_score !== undefined) {
      properties['Post Fatigue'] = { number: session.post_fatigue_score };
    }
    if (session.duration_ms !== undefined) {
      properties['Duration'] = { number: Math.round(session.duration_ms / 60000 * 10) / 10 };
    }

    await (this.client.pages as any).create({
      parent:     { database_id: sessionsDatabaseId },
      properties,
    });
  }

  // ── Session history + fatigue score ──────────────────────────────────────

  /**
   * Fetch recent session records for a given workout from a Notion sessions database.
   * Returns up to `limit` most recent sessions.
   */
  async fetchSessionHistory(
    workoutId:          string,
    sessionsDatabaseId: string,
    limit = 10,
  ): Promise<SessionHistoryRecord[]> {
    const query = await (this.client.databases as any).query({
      database_id: sessionsDatabaseId,
      filter: { property: 'Workout', relation: { contains: workoutId } },
      sorts:  [{ property: 'Date', direction: 'descending' }],
      page_size: limit,
    });

    return query.results.map((page: any) => {
      const props = page.properties;
      return {
        date:                props['Date']?.date?.start ?? new Date().toISOString(),
        completion_ratio:    props['Completion Ratio']?.number ?? 1,
        post_fatigue_score:  props['Post Fatigue']?.number,
        pre_readiness_score: props['Pre Readiness']?.number,
      };
    });
  }

  // ── Workout listing ──────────────────────────────────────────────────────

  /**
   * List all workout pages from a Notion workouts database.
   * Returns up to 50 workouts sorted by name.
   *
   * Expected database properties:
   *   - Name (title)
   *   - Description (rich_text)
   *   - Estimated Duration (number — minutes)
   *   - Tags (multi_select)
   */
  async listWorkouts(
    workoutsDatabaseId: string,
  ): Promise<Array<{ id: string; name: string; description: string; estimated_duration_min?: number; tags: string[] }>> {
    const result = await (this.client.databases as any).query({
      database_id: workoutsDatabaseId,
      sorts: [{ property: 'Name', direction: 'ascending' }],
      page_size: 50,
    });

    return result.results.map((page: any) => {
      const props = page.properties;
      return {
        id:                    page.id,
        name:                  props['Name']?.title?.[0]?.plain_text ?? 'Unnamed Workout',
        description:           props['Description']?.rich_text?.[0]?.plain_text ?? '',
        estimated_duration_min: props['Estimated Duration']?.number ?? undefined,
        tags:                  (props['Tags']?.multi_select ?? []).map((t: any) => t.name as string),
      };
    });
  }

  // ── Program listing ──────────────────────────────────────────────────────

  /**
   * List all workout programs from a Notion programs database.
   *
   * Required DB properties:
   *   Name (title), Duration Weeks (number), Goal (select),
   *   Start Date (date), Is Active (checkbox)
   */
  async listPrograms(programsDatabaseId: string): Promise<ProgramSummary[]> {
    const result = await (this.client.databases as any).query({
      database_id: programsDatabaseId,
      sorts:       [{ property: 'Name', direction: 'ascending' }],
      page_size:   20,
    });

    return result.results.map((page: any) => {
      const props = page.properties;

      // Support three common ways a program's active state can be modelled in Notion:
      //   1. Native Status property (props['Status'].status.name) — e.g. "Active"
      //   2. Select property named "Status"                       — e.g. "Active"
      //   3. Checkbox property named "Is Active"
      const statusName: string | null =
        props['Status']?.status?.name
        ?? props['Status']?.select?.name
        ?? null;
      const isActive =
        statusName !== null
          ? statusName === 'Active'
          : (props['Is Active']?.checkbox ?? false);

      return {
        id:             page.id,
        name:           props['Name']?.title?.[0]?.plain_text ?? 'Unnamed Program',
        duration_weeks: props['Duration Weeks']?.number       ?? 4,
        goal:           props['Goal']?.select?.name           ?? '',
        start_date:     props['Start Date']?.date?.start      ?? new Date().toISOString().slice(0, 10),
        is_active:      isActive,
      };
    });
  }

  /**
   * Fetch the ordered day schedule for a given program from a Notion program
   * days database.
   *
   * Required DB properties on the Program Days database:
   *   Week (number), Day (number), Workout Template (relation → Workout Templates),
   *   Is Rest Day (checkbox), Notes (rich_text)
   *
   * The database must also have a back-relation property named "Program"
   * pointing to the Workout Programs database — Notion creates this automatically
   * when the Programs → Days relation is set up.
   */
  async getProgramSchedule(
    programId:       string,
    daysDatabaseId:  string,
  ): Promise<ProgramDay[]> {
    const query = await (this.client.databases as any).query({
      database_id: daysDatabaseId,
      filter: { property: 'Program', relation: { contains: programId } },
      sorts: [
        { property: 'Week', direction: 'ascending' },
        { property: 'Day',  direction: 'ascending' },
      ],
      page_size: 100,
    });

    return query.results.map((page: any) => {
      const props      = page.properties;
      const workoutRel = props['Workout Template']?.relation ?? [];
      return {
        id:                  page.id,
        week:                props['Week']?.number                        ?? 1,
        day:                 props['Day']?.number                         ?? 1,
        workout_template_id: (workoutRel[0]?.id as string | undefined)   ?? null,
        is_rest_day:         props['Is Rest Day']?.checkbox               ?? false,
        notes:               props['Notes']?.rich_text?.[0]?.plain_text   ?? '',
      };
    });
  }

  /**
   * Convenience: fetch history and compute fatigue score in one call.
   * Returns `{ fatigue_score, sessions_analyzed, trend }`.
   */
  async getFatigueData(
    workoutId:          string,
    sessionsDatabaseId: string,
  ): Promise<{ fatigue_score: number; sessions_analyzed: number; trend: 'improving' | 'declining' | 'stable' }> {
    const history = await this.fetchSessionHistory(workoutId, sessionsDatabaseId, 10);
    const fatigue_score   = computeFatigueScore(history);

    // Trend: compare first-half avg vs second-half avg of recent sessions
    let trend: 'improving' | 'declining' | 'stable' = 'stable';
    if (history.length >= 4) {
      const half   = Math.floor(history.length / 2);
      const recent = history.slice(0, half);
      const older  = history.slice(half);
      const avgRecent = computeFatigueScore(recent);
      const avgOlder  = computeFatigueScore(older);
      if (avgRecent < avgOlder - 0.5) trend = 'improving';
      else if (avgRecent > avgOlder + 0.5) trend = 'declining';
    }

    return { fatigue_score, sessions_analyzed: history.length, trend };
  }
}
