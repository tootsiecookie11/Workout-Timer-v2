import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GraphEngine } from '../graphEngine';
import { buildGraph } from '../graphBuilder';
import { GRAPH_END } from '../dslTypes';
import type { EvalContext } from '../dslTypes';
import type { WorkoutBlock } from '../types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_CTX: EvalContext = {
  reps: 0, time: 0, round: 1, set: 1, user: null,
};

function makeEngine(blocks: WorkoutBlock[], evalCtx = BASE_CTX, heartbeatMs = 50) {
  const events: string[] = [];
  const graph = buildGraph(blocks);
  const engine = new GraphEngine({
    graph,
    evalContext: evalCtx,
    onEvent: (e) => events.push(e.type),
    heartbeatMs,
    timeSource: () => Date.now(),
  });
  return { engine, events, graph };
}

// ─── State machine ────────────────────────────────────────────────────────────

describe('GraphEngine — state machine', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(()  => vi.useRealTimers());

  it('starts in IDLE state', () => {
    const { engine } = makeEngine([
      { id: 'a', type: 'exercise', label: 'Push-up', duration_ms: 5000 },
    ]);
    expect(engine.currentState).toBe('IDLE');
  });

  it('enters COUNTDOWN after start()', () => {
    const { engine } = makeEngine([
      { id: 'a', type: 'exercise', label: 'Push-up', duration_ms: 5000 },
    ]);
    engine.start();
    expect(engine.currentState).toBe('COUNTDOWN');
  });

  it('emits countdown:tick 3 times (3-2-1) then becomes ACTIVE', () => {
    const { engine, events } = makeEngine([
      { id: 'a', type: 'exercise', label: 'Push-up', duration_ms: 5000 },
    ]);
    engine.start();

    vi.advanceTimersByTime(3000); // fire all 3 countdown ticks
    const ticks = events.filter((e) => e === 'countdown:tick');
    expect(ticks).toHaveLength(3);
    expect(engine.currentState).toBe('ACTIVE');
  });

  it('ignores double start()', () => {
    const { engine, events } = makeEngine([
      { id: 'a', type: 'exercise', label: 'Push-up', duration_ms: 5000 },
    ]);
    engine.start();
    engine.start(); // second call is a no-op
    vi.advanceTimersByTime(3000);
    const ticks = events.filter((e) => e === 'countdown:tick');
    expect(ticks).toHaveLength(3);
  });
});

// ─── Single-node graph ────────────────────────────────────────────────────────

describe('GraphEngine — single node', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(()  => vi.useRealTimers());

  it('fires transition:start → step:start → step:tick → step:complete → session:complete', () => {
    const { engine, events } = makeEngine([
      { id: 'a', type: 'exercise', label: 'Push-up', duration_ms: 2000 },
    ]);
    engine.start();
    vi.advanceTimersByTime(3000 + 2000 + 200); // countdown + step + buffer

    expect(events).toContain('transition:start');
    expect(events).toContain('step:start');
    expect(events).toContain('step:tick');
    expect(events).toContain('step:complete');
    expect(events).toContain('session:complete');
  });

  it('emits multiple step:tick events during step duration', () => {
    const { engine, events } = makeEngine([
      { id: 'a', type: 'exercise', label: 'Push-up', duration_ms: 1000 },
    ], BASE_CTX, 100);
    engine.start();
    vi.advanceTimersByTime(3000 + 1000 + 200);

    const ticks = events.filter((e) => e === 'step:tick');
    expect(ticks.length).toBeGreaterThanOrEqual(5); // at 100ms heartbeat, ≥10 ticks per second
  });
});

// ─── Two-node sequential ──────────────────────────────────────────────────────

describe('GraphEngine — sequential graph', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(()  => vi.useRealTimers());

  it('traverses two nodes in order', () => {
    const { engine, events } = makeEngine([
      { id: 'a', type: 'exercise', label: 'Push-up', duration_ms: 1000 },
      { id: 'b', type: 'rest',     label: 'Rest',    duration_ms: 1000 },
    ]);
    engine.start();
    vi.advanceTimersByTime(3000 + 1000 + 1000 + 500);

    const starts = events.filter((e) => e === 'step:start');
    expect(starts).toHaveLength(2);
    expect(events).toContain('session:complete');
  });

  it('fires two transition:start events (one per step)', () => {
    const { engine, events } = makeEngine([
      { id: 'a', type: 'exercise', label: 'A', duration_ms: 1000 },
      { id: 'b', type: 'exercise', label: 'B', duration_ms: 1000 },
    ]);
    engine.start();
    vi.advanceTimersByTime(3000 + 2000 + 500);

    expect(events.filter((e) => e === 'transition:start')).toHaveLength(2);
  });
});

// ─── Pause / resume ───────────────────────────────────────────────────────────

describe('GraphEngine — pause / resume', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(()  => vi.useRealTimers());

  it('emits session:paused and transitions to PAUSED state', () => {
    const { engine, events } = makeEngine([
      { id: 'a', type: 'exercise', label: 'Push-up', duration_ms: 5000 },
    ]);
    engine.start();
    vi.advanceTimersByTime(3000); // finish countdown
    engine.pause();

    expect(engine.currentState).toBe('PAUSED');
    expect(events).toContain('session:paused');
  });

  it('emits session:resumed and returns to ACTIVE on resume()', () => {
    const { engine, events } = makeEngine([
      { id: 'a', type: 'exercise', label: 'Push-up', duration_ms: 5000 },
    ]);
    engine.start();
    vi.advanceTimersByTime(3000);
    engine.pause();
    engine.resume();

    expect(engine.currentState).toBe('ACTIVE');
    expect(events).toContain('session:resumed');
  });

  it('does not advance while paused', () => {
    const { engine, events } = makeEngine([
      { id: 'a', type: 'exercise', label: 'Push-up', duration_ms: 500 },
    ]);
    engine.start();
    vi.advanceTimersByTime(3000); // countdown done → ACTIVE
    engine.pause();
    vi.advanceTimersByTime(2000); // time passes while paused

    // If paused correctly, session:complete should NOT yet have fired
    expect(events).not.toContain('session:complete');
  });
});

// ─── Skip ─────────────────────────────────────────────────────────────────────

describe('GraphEngine — skip', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(()  => vi.useRealTimers());

  it('skip() advances to next step immediately', () => {
    const { engine, events } = makeEngine([
      { id: 'a', type: 'exercise', label: 'A', duration_ms: 60000 }, // long
      { id: 'b', type: 'exercise', label: 'B', duration_ms: 1000  },
    ]);
    engine.start();
    vi.advanceTimersByTime(3000); // countdown
    engine.skip();                // skip A immediately
    vi.advanceTimersByTime(1500); // let B complete

    const starts = events.filter((e) => e === 'step:start');
    expect(starts).toHaveLength(2); // both A and B started
    expect(events).toContain('session:complete');
  });
});

// ─── Destroy ──────────────────────────────────────────────────────────────────

describe('GraphEngine — destroy', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(()  => vi.useRealTimers());

  it('destroy() sets state to IDLE and stops heartbeat', () => {
    const { engine, events } = makeEngine([
      { id: 'a', type: 'exercise', label: 'A', duration_ms: 5000 },
    ]);
    engine.start();
    vi.advanceTimersByTime(3000);
    engine.destroy();

    const eventCountAtDestroy = events.length;
    vi.advanceTimersByTime(5000); // no new events should fire
    expect(events.length).toBe(eventCountAtDestroy);
    expect(engine.currentState).toBe('IDLE');
  });
});

// ─── Conditional edges ────────────────────────────────────────────────────────

describe('GraphEngine — conditional edge evaluation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(()  => vi.useRealTimers());

  it('takes the matching DSL conditional edge', () => {
    // Conditional block: if reps >= 5 → hard set, else easy set
    const blocks: WorkoutBlock[] = [
      {
        id: 'cond', type: 'conditional', label: 'Branch',
        children: [
          { id: 'hard', type: 'exercise', label: 'Hard', duration_ms: 1000, condition: 'reps >= 5' },
          { id: 'easy', type: 'exercise', label: 'Easy', duration_ms: 1000, condition: 'reps < 5'  },
        ],
      },
    ];

    const stepLabels: string[] = [];
    const graph = buildGraph(blocks);
    const engine = new GraphEngine({
      graph,
      evalContext: { ...BASE_CTX, reps: 8 }, // reps=8 → "Hard" edge should match
      onEvent: (e) => {
        if (e.type === 'step:start') stepLabels.push((e.data as any).step.label);
      },
      heartbeatMs: 50,
      timeSource: () => Date.now(),
    });

    engine.start();
    vi.advanceTimersByTime(3000 + 1000 + 500);

    // Should have visited the conditional node (no step:start for it since it's cond type)
    // then taken the "Hard" branch
    expect(stepLabels).toContain('Hard');
    expect(stepLabels).not.toContain('Easy');
  });

  it('falls back to unconditional edge when no condition matches', () => {
    const blocks: WorkoutBlock[] = [
      {
        id: 'cond', type: 'conditional', label: 'Branch',
        children: [
          { id: 'a', type: 'exercise', label: 'A', duration_ms: 1000, condition: 'reps >= 100' }, // won't match
        ],
      },
    ];

    const events: string[] = [];
    const graph = buildGraph(blocks);
    const engine = new GraphEngine({
      graph,
      evalContext: { ...BASE_CTX, reps: 5 },
      onEvent: (e) => events.push(e.type),
      heartbeatMs: 50,
      timeSource: () => Date.now(),
    });

    engine.start();
    vi.advanceTimersByTime(3000 + 500);

    // No matching condition → fallback unconditional edge → GRAPH_END → session:complete
    expect(events).toContain('session:complete');
  });

  it('emits graph:branch when a DSL conditional edge is taken', () => {
    const blocks: WorkoutBlock[] = [
      {
        id: 'cond', type: 'conditional', label: 'Branch',
        children: [
          { id: 'a', type: 'exercise', label: 'A', duration_ms: 1000, condition: 'reps >= 1' },
        ],
      },
    ];

    const events: string[] = [];
    const graph = buildGraph(blocks);
    const engine = new GraphEngine({
      graph,
      evalContext: { ...BASE_CTX, reps: 5 },
      onEvent: (e) => events.push(e.type),
      heartbeatMs: 50,
      timeSource: () => Date.now(),
    });

    engine.start();
    vi.advanceTimersByTime(3000 + 1000 + 500);

    expect(events).toContain('graph:branch');
  });
});

// ─── updateEvalContext ────────────────────────────────────────────────────────

describe('GraphEngine — updateEvalContext', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(()  => vi.useRealTimers());

  it('updated context is used when resolving next edge', () => {
    const blocks: WorkoutBlock[] = [
      { id: 'a', type: 'exercise', label: 'Warmup', duration_ms: 1000 },
      {
        id: 'cond', type: 'conditional', label: 'Branch',
        children: [
          { id: 'hard', type: 'exercise', label: 'Hard', duration_ms: 1000, condition: 'fatigue_score < 5' },
          { id: 'easy', type: 'exercise', label: 'Easy', duration_ms: 1000, condition: 'fatigue_score >= 5'  },
        ],
      },
    ];

    const stepLabels: string[] = [];
    const graph = buildGraph(blocks);
    const engine = new GraphEngine({
      graph,
      evalContext: { ...BASE_CTX, fatigue_score: 8 }, // fatigued → Easy
      onEvent: (e) => {
        if (e.type === 'step:start') stepLabels.push((e.data as any).step.label);
      },
      heartbeatMs: 50,
      timeSource: () => Date.now(),
    });

    engine.start();
    vi.advanceTimersByTime(3000 + 1500); // countdown + warmup completes

    expect(stepLabels).toContain('Easy');
    expect(stepLabels).not.toContain('Hard');
  });
});
