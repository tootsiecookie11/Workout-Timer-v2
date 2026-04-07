import { describe, it, expect } from 'vitest';
import {
  generateQueue,
  generateQueueFromCustom,
  totalDurationMs,
} from '../queueGenerator';
import type { WorkoutBlock, CustomInterval } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeExercise(id: string, durationMs: number, restAfterMs = 0): WorkoutBlock {
  return {
    id,
    type: 'exercise',
    label: `Exercise ${id}`,
    duration_ms: durationMs,
    rest_after_ms: restAfterMs > 0 ? restAfterMs : undefined,
  };
}

function makeRestBlock(id: string, durationMs: number): WorkoutBlock {
  return { id, type: 'rest', label: 'Rest', duration_ms: durationMs };
}

function makeCircuit(id: string, rounds: number, children: WorkoutBlock[]): WorkoutBlock {
  return { id, type: 'circuit', label: `Circuit ${id}`, rounds, children };
}

// ─── generateQueue ────────────────────────────────────────────────────────────

describe('generateQueue', () => {
  it('returns empty array for empty input', () => {
    expect(generateQueue([])).toEqual([]);
  });

  it('expands a single exercise block into one step', () => {
    const blocks: WorkoutBlock[] = [makeExercise('a', 30_000)];
    const queue = generateQueue(blocks);
    expect(queue).toHaveLength(1);
    expect(queue[0].type).toBe('exercise');
    expect(queue[0].label).toBe('Exercise a');
    expect(queue[0].duration_ms).toBe(30_000);
  });

  it('step_index values are sequential from 0', () => {
    const blocks: WorkoutBlock[] = [
      makeExercise('a', 20_000),
      makeExercise('b', 30_000),
      makeExercise('c', 15_000),
    ];
    const queue = generateQueue(blocks);
    queue.forEach((step, i) => {
      expect(step.step_index).toBe(i);
    });
  });

  it('injects a rest step when rest_after_ms is set', () => {
    const blocks: WorkoutBlock[] = [makeExercise('a', 30_000, 15_000)];
    const queue = generateQueue(blocks);
    expect(queue).toHaveLength(2);
    expect(queue[0].type).toBe('exercise');
    expect(queue[1].type).toBe('rest');
    expect(queue[1].duration_ms).toBe(15_000);
  });

  it('does not inject a rest step when rest_after_ms is 0', () => {
    const blocks: WorkoutBlock[] = [makeExercise('a', 30_000, 0)];
    const queue = generateQueue(blocks);
    expect(queue).toHaveLength(1);
  });

  it('expands a circuit of 3 rounds with 2 children into 6 steps', () => {
    const circuit = makeCircuit('c1', 3, [
      makeExercise('push', 40_000),
      makeExercise('squat', 40_000),
    ]);
    const queue = generateQueue([circuit]);
    // 3 rounds × 2 exercises = 6 steps
    expect(queue).toHaveLength(6);
    // Round metadata is set correctly
    expect(queue[0].meta.round).toBe(1);
    expect(queue[2].meta.round).toBe(2);
    expect(queue[4].meta.round).toBe(3);
  });

  it('circuit steps carry total_rounds in meta', () => {
    const circuit = makeCircuit('c1', 4, [makeExercise('ex', 30_000)]);
    const queue = generateQueue([circuit]);
    queue.forEach((step) => {
      expect(step.meta.total_rounds).toBe(4);
    });
  });

  it('handles circuit with rest_after_ms on children', () => {
    const circuit = makeCircuit('c1', 2, [makeExercise('ex', 30_000, 10_000)]);
    const queue = generateQueue([circuit]);
    // 2 rounds × (1 work + 1 rest) = 4 steps
    expect(queue).toHaveLength(4);
    expect(queue.filter((s) => s.type === 'rest')).toHaveLength(2);
  });

  it('propagates next_label meta through a flat list', () => {
    const blocks: WorkoutBlock[] = [
      makeExercise('a', 30_000),
      makeExercise('b', 30_000),
    ];
    const queue = generateQueue(blocks);
    expect(queue[0].meta.next_label).toBe('Exercise b');
    expect(queue[1].meta.next_label).toBeUndefined();
  });

  it('handles a rest-type block', () => {
    const blocks: WorkoutBlock[] = [makeRestBlock('r1', 60_000)];
    const queue = generateQueue(blocks);
    expect(queue).toHaveLength(1);
    expect(queue[0].type).toBe('rest');
    expect(queue[0].duration_ms).toBe(60_000);
  });

  it('does not exceed depth 5 (guard against infinite recursion)', () => {
    // Build 6 levels of nesting — level 6+ should be dropped
    const innermost: WorkoutBlock = makeExercise('deep', 10_000);
    let block: WorkoutBlock = innermost;
    for (let i = 5; i >= 0; i--) {
      block = {
        id: `level${i}`,
        type: 'circuit',
        label: `Level ${i}`,
        rounds: 1,
        children: [block],
      };
    }
    // Should not throw and should return something (may be empty for depth > 5)
    expect(() => generateQueue([block])).not.toThrow();
  });

  it('produces queue in < 100ms for 200-step workouts (PRD §5.3)', () => {
    // 50 circuits × 4 rounds × 1 exercise = 200 steps
    const blocks: WorkoutBlock[] = Array.from({ length: 50 }, (_, i) =>
      makeCircuit(`c${i}`, 4, [makeExercise(`e${i}`, 30_000)]),
    );
    const start = Date.now();
    const queue = generateQueue(blocks);
    const elapsed = Date.now() - start;
    expect(queue.length).toBe(200);
    expect(elapsed).toBeLessThan(100);
  });
});

// ─── generateQueueFromCustom ──────────────────────────────────────────────────

describe('generateQueueFromCustom', () => {
  const base: CustomInterval = {
    id: 'i1',
    label: 'Push-ups',
    work_ms: 40_000,
    rest_ms: 20_000,
    rounds: 3,
  };

  it('expands a single interval with rounds into work + rest pairs', () => {
    const queue = generateQueueFromCustom([base]);
    // 3 rounds × (work + rest) = 6 steps
    expect(queue).toHaveLength(6);
    const types = queue.map((s) => s.type);
    expect(types).toEqual(['exercise', 'rest', 'exercise', 'rest', 'exercise', 'rest']);
  });

  it('skips rest steps when rest_ms is 0', () => {
    const noRest: CustomInterval = { ...base, rest_ms: 0 };
    const queue = generateQueueFromCustom([noRest]);
    expect(queue).toHaveLength(3); // 3 rounds × work only
    expect(queue.every((s) => s.type === 'exercise')).toBe(true);
  });

  it('work steps carry the exercise label', () => {
    const queue = generateQueueFromCustom([base]);
    queue
      .filter((s) => s.type === 'exercise')
      .forEach((s) => expect(s.label).toBe('Push-ups'));
  });

  it('returns empty queue for empty intervals', () => {
    expect(generateQueueFromCustom([])).toEqual([]);
  });

  it('concatenates multiple intervals in order', () => {
    const intervals: CustomInterval[] = [
      { id: 'a', label: 'A', work_ms: 30_000, rest_ms: 10_000, rounds: 1 },
      { id: 'b', label: 'B', work_ms: 20_000, rest_ms: 10_000, rounds: 1 },
    ];
    const queue = generateQueueFromCustom(intervals);
    expect(queue).toHaveLength(4);
    expect(queue[0].label).toBe('A');
    expect(queue[2].label).toBe('B');
  });
});

// ─── totalDurationMs ──────────────────────────────────────────────────────────

describe('totalDurationMs', () => {
  it('sums all step durations', () => {
    const queue = generateQueue([
      makeExercise('a', 30_000),
      makeExercise('b', 20_000),
      makeRestBlock('r', 10_000),
    ]);
    expect(totalDurationMs(queue)).toBe(60_000);
  });

  it('returns 0 for empty queue', () => {
    expect(totalDurationMs([])).toBe(0);
  });

  it('includes rest_after injected steps in total', () => {
    const queue = generateQueue([makeExercise('a', 30_000, 10_000)]);
    expect(totalDurationMs(queue)).toBe(40_000);
  });
});
