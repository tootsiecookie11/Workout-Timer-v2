/**
 * Graph Builder — converts a WorkoutBlock[] tree into a WorkoutGraph.
 *
 * The graph is a directed acyclic (mostly) structure where:
 *  - Sequential blocks  → linear edge chains
 *  - Superset blocks    → children run once in sequence
 *  - Circuit blocks     → children repeated N times (unrolled as copies)
 *  - AMRAP/EMOM blocks  → children linearised (time-cap loop exit in Phase 3)
 *  - Conditional blocks → fan-out with DSL condition strings on edges
 *
 * Each WorkoutBlock becomes ≥1 GraphNode. Block ids are not reused — each node
 * gets a unique generated id so circuits can unroll without id collisions.
 *
 * The builder does NOT evaluate DSL conditions; it only stores condition strings
 * on edges for the GraphEngine to evaluate at runtime.
 */

import type { WorkoutBlock } from './types';
import type { WorkoutGraph, GraphNode, GraphEdge } from './dslTypes';
import { GRAPH_END } from './dslTypes';

let _counter = 0;

function uid(prefix = 'n'): string {
  return `${prefix}_${_counter++}`;
}

export function buildGraph(blocks: WorkoutBlock[]): WorkoutGraph {
  _counter = 0;
  const nodes = new Map<string, GraphNode>();

  if (blocks.length === 0) {
    // Phantom entry node so callers always get a valid entryId
    const id = uid('empty');
    nodes.set(id, {
      id,
      block: { id, type: 'exercise', label: '(empty)', duration_ms: 0 },
      edges: [{ to: GRAPH_END }],
    });
    return { nodes, entryId: id };
  }

  const entryId = buildChain(blocks, GRAPH_END, nodes);
  return { nodes, entryId };
}

/**
 * Build a chain of nodes for `blocks`, where the final node in the chain
 * connects to `afterId`. Returns the id of the first node in the chain.
 * Processes right-to-left so each node knows the id of the node that follows it.
 */
function buildChain(
  blocks: WorkoutBlock[],
  afterId: string,
  nodes: Map<string, GraphNode>,
): string {
  let nextId = afterId;
  for (let i = blocks.length - 1; i >= 0; i--) {
    nextId = buildNode(blocks[i], nextId, nodes);
  }
  return nextId;
}

function buildNode(
  block: WorkoutBlock,
  afterId: string,
  nodes: Map<string, GraphNode>,
): string {
  switch (block.type) {
    case 'exercise':
    case 'rest':
      return buildLeaf(block, afterId, nodes);

    case 'superset':
      // Children run once in sequence — no looping
      return block.children?.length
        ? buildChain(block.children, afterId, nodes)
        : buildLeaf(block, afterId, nodes);

    case 'circuit':
      return buildCircuit(block, afterId, nodes);

    case 'amrap':
    case 'emom':
      // Phase 2: expand children linearly. Phase 3 adds time-cap loop exit.
      return block.children?.length
        ? buildChain(block.children, afterId, nodes)
        : buildLeaf(block, afterId, nodes);

    case 'conditional':
      return buildConditional(block, afterId, nodes);

    default:
      return buildLeaf(block, afterId, nodes);
  }
}

function buildLeaf(
  block: WorkoutBlock,
  afterId: string,
  nodes: Map<string, GraphNode>,
): string {
  const id = uid('leaf');
  const edges: GraphEdge[] = [];

  if (block.rest_after_ms && block.rest_after_ms > 0) {
    // Inject an automatic rest node between this block and afterId
    const restId = uid('rest');
    const restBlock: WorkoutBlock = {
      id: restId,
      type: 'rest',
      label: 'Rest',
      duration_ms: block.rest_after_ms,
    };
    nodes.set(restId, { id: restId, block: restBlock, edges: [{ to: afterId }] });
    edges.push({ to: restId });
  } else {
    edges.push({ to: afterId });
  }

  nodes.set(id, { id, block, edges });
  return id;
}

function buildCircuit(
  block: WorkoutBlock,
  afterId: string,
  nodes: Map<string, GraphNode>,
): string {
  const rounds = block.rounds ?? 1;
  if (!block.children?.length) return buildLeaf(block, afterId, nodes);

  // Unroll rounds right-to-left: each round's chain connects to the next round's entry
  let nextId = afterId;
  for (let r = rounds; r >= 1; r--) {
    nextId = buildChain(block.children, nextId, nodes);
  }
  return nextId;
}

function buildConditional(
  block: WorkoutBlock,
  afterId: string,
  nodes: Map<string, GraphNode>,
): string {
  const id = uid('cond');
  const edges: GraphEdge[] = [];

  // Each child block becomes a branch target. The child's own `condition` field
  // is the DSL string for the edge; fall back to the parent's condition if absent.
  if (block.children) {
    for (const child of block.children) {
      const childId = buildNode(child, afterId, nodes);
      edges.push({
        to: childId,
        condition: child.condition ?? block.condition,
        label: child.label,
      });
    }
  }

  // Unconditional fallback edge — always last, ensures the engine can advance
  edges.push({ to: afterId });

  nodes.set(id, { id, block, edges });
  return id;
}
