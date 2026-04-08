import type { WorkoutBlock } from './types';

// ─── DSL AST ──────────────────────────────────────────────────────────────────

export type CompareOp = '>=' | '<=' | '>' | '<' | '==' | '!=';

export type Operand =
  | { kind: 'var';         name: string }
  | { kind: 'mod';         name: string; divisor: number }
  | { kind: 'num';         value: number }
  | { kind: 'str';         value: string }
  | { kind: 'duration_ms'; ms: number };

export type ASTNode =
  | { kind: 'always' }
  | { kind: 'cmp';   op: CompareOp; left: Operand; right: Operand }
  | { kind: 'and';   left: ASTNode; right: ASTNode }
  | { kind: 'or';    left: ASTNode; right: ASTNode }
  | { kind: 'not';   expr: ASTNode };

// ─── Evaluation Context ───────────────────────────────────────────────────────

/**
 * Runtime values available to DSL condition expressions.
 *
 * | Variable | Meaning                                  |
 * |----------|------------------------------------------|
 * | reps     | Reps completed in the current step       |
 * | time     | Elapsed ms in the current step           |
 * | round    | Current round index (1-based)            |
 * | set      | Current set index (1-based)              |
 * | user     | Last user_choice string, or null         |
 */
export interface EvalContext {
  reps:  number;
  time:  number;
  round: number;
  set:   number;
  user:  string | null;
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
