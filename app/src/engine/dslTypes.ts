import type { WorkoutBlock } from './types';

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
  reps:           number;
  time:           number;
  round:          number;
  set:            number;
  user:           string | null;
  elapsed_ms?:    number;
  remaining_ms?:  number;
  lap?:           number;
  /** 0–10: higher = more fatigued. Fed from Notion session history via fatigueEngine. */
  fatigue_score?: number;
  /** 0–10: user-reported readiness collected before session start. */
  readiness?:     number;
}

// ─── Graph Types ──────────────────────────────────────────────────────────────

/** Sentinel node id meaning "workout is finished". */
export const GRAPH_END = '__END__';

export interface GraphEdge {
  /** Target node id, or GRAPH_END. */
  to: string;
  /** DSL condition string. Undefined = unconditional (always taken). */
  condition?: string;
  /** If set, engine pauses and shows this prompt before evaluating the edge. */
  userPrompt?: string;
  /** Human-readable edge label (e.g. "If strong", "Skip"). */
  label?: string;
}

export interface GraphNode {
  id: string;
  block: WorkoutBlock;
  /** Ordered list of outgoing edges. First matching edge wins. */
  edges: GraphEdge[];
}

export interface WorkoutGraph {
  nodes: Map<string, GraphNode>;
  entryId: string;
}

// ─── Graph Engine Events ──────────────────────────────────────────────────────

/** Emitted when a conditional edge is evaluated and taken. */
export interface GraphBranchPayload {
  from_node_id: string;
  to_node_id:   string;
  edge:          GraphEdge;
  context:       EvalContext;
}

/**
 * Emitted when a node has user-prompt edges and the engine needs input
 * before it can advance. UI should present the options and call
 * graphEngine.resolveChoice(answer).
 */
export interface GraphChoiceRequiredPayload {
  node_id: string;
  prompt:  string;
  options: string[];
}
