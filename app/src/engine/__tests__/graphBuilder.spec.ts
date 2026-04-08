import { describe, it, expect } from 'vitest';
import { buildGraph } from '../graphBuilder';
import { GRAPH_END } from '../dslTypes';
import type { WorkoutBlock } from '../types';

describe('buildGraph', () => {
  it('empty block list → phantom node pointing to GRAPH_END', () => {
    const g = buildGraph([]);
    expect(g.nodes.size).toBe(1);
    const entry = g.nodes.get(g.entryId)!;
    expect(entry).toBeDefined();
    expect(entry.edges[0].to).toBe(GRAPH_END);
  });

  it('single exercise block → entry node → GRAPH_END', () => {
    const blocks: WorkoutBlock[] = [
      { id: 'b1', type: 'exercise', label: 'Push-up', duration_ms: 30000 },
    ];
    const g = buildGraph(blocks);
    expect(g.nodes.size).toBe(1);
    expect(g.nodes.get(g.entryId)!.edges[0].to).toBe(GRAPH_END);
  });

  it('two sequential blocks form a linear chain to GRAPH_END', () => {
    const blocks: WorkoutBlock[] = [
      { id: 'b1', type: 'exercise', label: 'Push-up', duration_ms: 30000 },
      { id: 'b2', type: 'exercise', label: 'Squat',   duration_ms: 30000 },
    ];
    const g = buildGraph(blocks);
    expect(g.nodes.size).toBe(2);
    const entry = g.nodes.get(g.entryId)!;
    const mid   = g.nodes.get(entry.edges[0].to)!;
    expect(mid).toBeDefined();
    expect(mid.edges[0].to).toBe(GRAPH_END);
  });

  it('rest_after_ms injects an automatic rest node', () => {
    const blocks: WorkoutBlock[] = [
      { id: 'b1', type: 'exercise', label: 'Push-up', duration_ms: 30000, rest_after_ms: 10000 },
    ];
    const g = buildGraph(blocks);
    // exercise node + rest node = 2 nodes
    expect(g.nodes.size).toBe(2);
    const entry   = g.nodes.get(g.entryId)!;
    const restNode = g.nodes.get(entry.edges[0].to)!;
    expect(restNode.block.type).toBe('rest');
    expect(restNode.block.duration_ms).toBe(10000);
    expect(restNode.edges[0].to).toBe(GRAPH_END);
  });

  it('circuit with 2 rounds unrolls to 2×children nodes', () => {
    const blocks: WorkoutBlock[] = [
      {
        id: 'c1', type: 'circuit', label: 'Circuit', rounds: 2,
        children: [
          { id: 'e1', type: 'exercise', label: 'Push-up', duration_ms: 20000 },
          { id: 'e2', type: 'exercise', label: 'Squat',   duration_ms: 20000 },
        ],
      },
    ];
    const g = buildGraph(blocks);
    // 2 rounds × 2 children = 4 leaf nodes
    expect(g.nodes.size).toBe(4);
  });

  it('superset runs children once in sequence', () => {
    const blocks: WorkoutBlock[] = [
      {
        id: 'ss1', type: 'superset', label: 'Superset',
        children: [
          { id: 'e1', type: 'exercise', label: 'Curl',  duration_ms: 20000 },
          { id: 'e2', type: 'exercise', label: 'Press', duration_ms: 20000 },
        ],
      },
    ];
    const g = buildGraph(blocks);
    expect(g.nodes.size).toBe(2);
    const entry = g.nodes.get(g.entryId)!;
    const mid   = g.nodes.get(entry.edges[0].to)!;
    expect(mid.edges[0].to).toBe(GRAPH_END);
  });

  it('conditional block creates fan-out edges with DSL conditions + unconditional fallback', () => {
    const blocks: WorkoutBlock[] = [
      {
        id: 'cond1', type: 'conditional', label: 'Branch',
        children: [
          { id: 'hard', type: 'exercise', label: 'Hard Set', duration_ms: 30000, condition: 'reps >= 8' },
          { id: 'easy', type: 'exercise', label: 'Easy Set', duration_ms: 20000, condition: 'reps < 8'  },
        ],
      },
    ];
    const g = buildGraph(blocks);
    const condNode = g.nodes.get(g.entryId)!;
    // 2 conditional edges + 1 unconditional fallback
    expect(condNode.edges.length).toBe(3);
    expect(condNode.edges[0].condition).toBe('reps >= 8');
    expect(condNode.edges[1].condition).toBe('reps < 8');
    expect(condNode.edges[2].condition).toBeUndefined();
    expect(condNode.edges[2].to).toBe(GRAPH_END);
  });
});
