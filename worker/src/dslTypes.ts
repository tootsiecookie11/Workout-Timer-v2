/**
 * Shared DSL types used by the server-side dslParser.
 * Mirrors the subset of app/src/engine/dslTypes.ts that the parser needs.
 * Graph-specific types (WorkoutGraph, GraphEdge, etc.) are intentionally
 * omitted — they live only in the client engine.
 */

// ─── Source Spans ─────────────────────────────────────────────────────────────

/** Character-offset range within a DSL source string. */
export interface Span { start: number; end: number }

// ─── DSL AST ──────────────────────────────────────────────────────────────────

export type CompareOp = '>=' | '<=' | '>' | '<' | '==' | '!=';

export type Operand =
  | { kind: 'var';         name: string }
  | { kind: 'mod';         name: string; divisor: number }
  | { kind: 'num';         value: number }
  | { kind: 'str';         value: string }
  | { kind: 'bool';        value: boolean }
  | { kind: 'null' }
  | { kind: 'duration_ms'; ms: number };

export type ASTNode =
  | { kind: 'always' }
  | { kind: 'cmp';   op: CompareOp; left: Operand; right: Operand }
  | { kind: 'and';   left: ASTNode; right: ASTNode }
  | { kind: 'or';    left: ASTNode; right: ASTNode }
  | { kind: 'not';   expr: ASTNode }
  /** Set-membership: operand in [item, item, ...] */
  | { kind: 'in';    operand: Operand; items: Operand[] };

// ─── Evaluation Context ───────────────────────────────────────────────────────

/**
 * Runtime values available to DSL condition expressions.
 *
 * | Variable      | Meaning                                           |
 * |---------------|---------------------------------------------------|
 * | reps          | Reps completed in the current step                |
 * | time          | Elapsed ms in the current step                    |
 * | round         | Current round index (1-based)                     |
 * | set           | Current set index (1-based)                       |
 * | user          | Last user_choice string, or null                  |
 * | elapsed_ms    | Total session elapsed ms                          |
 * | remaining_ms  | Current step remaining ms                         |
 * | lap           | Lap count (stopwatch mode)                        |
 * | fatigue_score | 0–10 computed from Notion session history          |
 * | readiness     | 0–10 user self-report at session start (optional) |
 */
export interface EvalContext {
  reps:            number;
  time:            number;
  round:           number;
  set:             number;
  user:            string | null;
  elapsed_ms?:     number;
  remaining_ms?:   number;
  lap?:            number;
  fatigue_score?:  number;
  readiness?:      number;
  volume_modifier?: number;
}
