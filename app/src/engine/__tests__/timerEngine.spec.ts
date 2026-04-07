import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TimerEngine, createStopwatchEngine } from '../timerEngine';
import type { WorkoutStep, EngineEventPayload } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStep(overrides: Partial<WorkoutStep> = {}): WorkoutStep {
  return {
    step_index: 0,
    block_id: 'b1',
    type: 'exercise',
    label: 'Push-ups',
    duration_ms: 10_000,
    meta: {},
    ...overrides,
  };
}

function makeSteps(count: number, durationMs = 10_000): WorkoutStep[] {
  return Array.from({ length: count }, (_, i) =>
    makeStep({ step_index: i, block_id: `b${i}`, label: `Exercise ${i + 1}`, duration_ms: durationMs }),
  );
}

/** Fake clock that you control manually. */
function makeFakeClock(startMs = 1_000_000) {
  let now = startMs;
  return {
    advance: (ms: number) => { now += ms; },
    fn: () => now,
  };
}

/** Collect all events fired by the engine. */
function makeCollector() {
  const events: EngineEventPayload[] = [];
  return {
    handler: (e: EngineEventPayload) => events.push(e),
    events,
    ofType: <T extends EngineEventPayload['type']>(type: T) =>
      events.filter((e) => e.type === type) as Extract<EngineEventPayload, { type: T }>[],
  };
}

// ─── Constructor / Initial State ──────────────────────────────────────────────

describe('TimerEngine — initial state', () => {
  it('starts in IDLE state', () => {
    const { handler } = makeCollector();
    const engine = new TimerEngine({ steps: makeSteps(1), onEvent: handler });
    expect(engine.currentState).toBe('IDLE');
  });

  it('elapsed() returns 0 before start', () => {
    const { handler } = makeCollector();
    const engine = new TimerEngine({ steps: makeSteps(1), onEvent: handler });
    expect(engine.elapsed()).toBe(0);
  });
});

// ─── start() ─────────────────────────────────────────────────────────────────

describe('TimerEngine — start()', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('emits countdown:tick events 3, 2, 1 before step:start', () => {
    const collector = makeCollector();
    const engine = new TimerEngine({
      steps: makeSteps(1),
      onEvent: collector.handler,
      tickIntervalMs: 100,
    });

    engine.start();
    // Tick through 3 countdown seconds
    vi.advanceTimersByTime(3000);

    const countdownTicks = collector.ofType('countdown:tick');
    expect(countdownTicks.length).toBeGreaterThanOrEqual(3);
    expect(countdownTicks[0].data.remaining_seconds).toBe(3);

    engine.destroy();
  });

  it('emits step:start after countdown completes', () => {
    const collector = makeCollector();
    const engine = new TimerEngine({
      steps: makeSteps(1),
      onEvent: collector.handler,
      tickIntervalMs: 100,
    });

    engine.start();
    vi.advanceTimersByTime(3500); // past 3-second countdown

    const stepStarts = collector.ofType('step:start');
    expect(stepStarts.length).toBeGreaterThanOrEqual(1);
    expect(stepStarts[0].data.step.label).toBe('Exercise 1');

    engine.destroy();
  });

  it('is a no-op if called when not IDLE', () => {
    const collector = makeCollector();
    const engine = new TimerEngine({ steps: makeSteps(1), onEvent: collector.handler });
    engine.start();
    const countBefore = collector.events.length;
    engine.start(); // second call
    expect(collector.events.length).toBe(countBefore);
    engine.destroy();
  });
});

// ─── Delta-based timing ───────────────────────────────────────────────────────

describe('TimerEngine — delta-based timing', () => {
  it('elapsed() reflects injected timeSource, not wall clock', () => {
    const clock = makeFakeClock();
    const collector = makeCollector();
    vi.useFakeTimers();

    const engine = new TimerEngine({
      steps: makeSteps(1, 30_000),
      onEvent: collector.handler,
      timeSource: clock.fn,
      tickIntervalMs: 100,
    });

    engine.start();
    vi.advanceTimersByTime(3000); // run countdown
    clock.advance(3000);          // advance fake clock past countdown

    // Now in ACTIVE state — advance 5 seconds
    clock.advance(5_000);
    vi.advanceTimersByTime(100); // trigger one tick

    // elapsed should be ~5000ms (from step start epoch)
    // (The countdown advances clock too, so startEpoch is set at ~3000ms)
    const ticks = collector.ofType('step:tick');
    if (ticks.length > 0) {
      expect(ticks[ticks.length - 1].data.elapsed_ms).toBeGreaterThanOrEqual(4_900);
    }

    engine.destroy();
    vi.useRealTimers();
  });

  it('step:tick payload has progress between 0 and 1', () => {
    vi.useFakeTimers();
    const clock = makeFakeClock();
    const collector = makeCollector();

    const engine = new TimerEngine({
      steps: makeSteps(1, 10_000),
      onEvent: collector.handler,
      timeSource: clock.fn,
      tickIntervalMs: 100,
    });

    engine.start();
    vi.advanceTimersByTime(3000);
    clock.advance(3000);

    // Advance 5s into a 10s step
    clock.advance(5_000);
    vi.advanceTimersByTime(200);

    const ticks = collector.ofType('step:tick');
    if (ticks.length > 0) {
      const last = ticks[ticks.length - 1];
      expect(last.data.progress).toBeGreaterThanOrEqual(0);
      expect(last.data.progress).toBeLessThanOrEqual(1);
    }

    engine.destroy();
    vi.useRealTimers();
  });
});

// ─── pause() / resume() ───────────────────────────────────────────────────────

describe('TimerEngine — pause() / resume()', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('emits session:paused when paused', () => {
    const collector = makeCollector();
    const engine = new TimerEngine({ steps: makeSteps(1), onEvent: collector.handler, tickIntervalMs: 50 });
    engine.start();
    vi.advanceTimersByTime(3100); // past countdown

    engine.pause();

    expect(collector.ofType('session:paused')).toHaveLength(1);
    expect(engine.currentState).toBe('PAUSED');
    engine.destroy();
  });

  it('emits session:resumed when resumed', () => {
    const collector = makeCollector();
    const engine = new TimerEngine({ steps: makeSteps(1), onEvent: collector.handler, tickIntervalMs: 50 });
    engine.start();
    vi.advanceTimersByTime(3100);

    engine.pause();
    engine.resume();

    expect(collector.ofType('session:resumed')).toHaveLength(1);
    expect(engine.currentState).toBe('ACTIVE');
    engine.destroy();
  });

  it('pause() is a no-op when not ACTIVE', () => {
    const collector = makeCollector();
    const engine = new TimerEngine({ steps: makeSteps(1), onEvent: collector.handler });
    engine.pause(); // called in IDLE state
    expect(collector.ofType('session:paused')).toHaveLength(0);
    engine.destroy();
  });

  it('elapsed time does not advance while paused', () => {
    const clock = makeFakeClock();
    vi.useFakeTimers();
    const collector = makeCollector();

    const engine = new TimerEngine({
      steps: makeSteps(1, 60_000),
      onEvent: collector.handler,
      timeSource: clock.fn,
      tickIntervalMs: 100,
    });

    engine.start();
    vi.advanceTimersByTime(3000);
    clock.advance(3000);

    // Run for 2s
    clock.advance(2_000);
    vi.advanceTimersByTime(200);
    const elapsedBeforePause = engine.elapsed();

    engine.pause();
    // Advance clock while paused — should not affect elapsed
    clock.advance(5_000);
    vi.advanceTimersByTime(200);

    expect(engine.elapsed()).toBeLessThanOrEqual(elapsedBeforePause + 50);

    engine.destroy();
    vi.useRealTimers();
  });
});

// ─── skip() ───────────────────────────────────────────────────────────────────

describe('TimerEngine — skip()', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('advances to next step', () => {
    const collector = makeCollector();
    const engine = new TimerEngine({
      steps: makeSteps(2, 30_000),
      onEvent: collector.handler,
      tickIntervalMs: 50,
    });

    engine.start();
    vi.advanceTimersByTime(3100);

    expect(engine.currentStepIndex).toBe(0);
    engine.skip();

    const starts = collector.ofType('step:start');
    expect(starts.length).toBeGreaterThanOrEqual(2);
    expect(starts[starts.length - 1].data.step_index).toBe(1);

    engine.destroy();
  });

  it('emits step:complete before advancing', () => {
    const collector = makeCollector();
    const engine = new TimerEngine({
      steps: makeSteps(2, 30_000),
      onEvent: collector.handler,
      tickIntervalMs: 50,
    });

    engine.start();
    vi.advanceTimersByTime(3100);
    engine.skip();

    expect(collector.ofType('step:complete')).toHaveLength(1);
    engine.destroy();
  });
});

// ─── Auto-advance at step end ─────────────────────────────────────────────────

describe('TimerEngine — auto-advance', () => {
  it('automatically advances to next step when remaining_ms reaches 0', () => {
    vi.useFakeTimers();
    const clock = makeFakeClock();
    const collector = makeCollector();

    const steps = makeSteps(2, 1_000); // very short steps
    const engine = new TimerEngine({
      steps,
      onEvent: collector.handler,
      timeSource: clock.fn,
      tickIntervalMs: 50,
    });

    engine.start();
    vi.advanceTimersByTime(3000);
    clock.advance(3000); // countdown

    // Advance past the 1s step
    clock.advance(1_100);
    vi.advanceTimersByTime(200);

    const starts = collector.ofType('step:start');
    expect(starts.length).toBeGreaterThanOrEqual(2);

    engine.destroy();
    vi.useRealTimers();
  });
});

// ─── session:complete ─────────────────────────────────────────────────────────

describe('TimerEngine — session:complete', () => {
  it('emits session:complete after final step ends', () => {
    vi.useFakeTimers();
    const clock = makeFakeClock();
    const collector = makeCollector();

    const engine = new TimerEngine({
      steps: makeSteps(1, 500),
      onEvent: collector.handler,
      timeSource: clock.fn,
      tickIntervalMs: 50,
    });

    engine.start();
    vi.advanceTimersByTime(3000);
    clock.advance(3000);

    clock.advance(600);
    vi.advanceTimersByTime(200);

    const completes = collector.ofType('session:complete');
    expect(completes).toHaveLength(1);
    expect(completes[0].data.steps_completed).toBe(1);
    expect(completes[0].data.steps_skipped).toBe(0);

    engine.destroy();
    vi.useRealTimers();
  });

  it('session:complete includes session_id', () => {
    vi.useFakeTimers();
    const clock = makeFakeClock();
    const collector = makeCollector();

    const engine = new TimerEngine({
      steps: makeSteps(1, 100),
      onEvent: collector.handler,
      timeSource: clock.fn,
      tickIntervalMs: 50,
    });

    engine.start();
    vi.advanceTimersByTime(3000);
    clock.advance(3000);
    clock.advance(200);
    vi.advanceTimersByTime(200);

    const [complete] = collector.ofType('session:complete');
    expect(complete?.data.session_id).toBeTruthy();
    expect(typeof complete?.data.session_id).toBe('string');

    engine.destroy();
    vi.useRealTimers();
  });
});

// ─── Stopwatch mode ───────────────────────────────────────────────────────────

describe('createStopwatchEngine', () => {
  it('creates an engine that emits step:tick without auto-advancing', () => {
    vi.useFakeTimers();
    const clock = makeFakeClock();
    const collector = makeCollector();

    const engine = createStopwatchEngine(collector.handler);
    // Swap timeSource post-construction isn't possible, so use real timers test
    engine.start();
    vi.advanceTimersByTime(3000); // countdown
    vi.advanceTimersByTime(500);  // some ticks

    // Should have emitted ticks but NOT session:complete
    expect(collector.ofType('session:complete')).toHaveLength(0);
    expect(collector.ofType('step:tick').length).toBeGreaterThan(0);

    engine.destroy();
    vi.useRealTimers();
  });

  it('recordLap() is callable without throwing', () => {
    vi.useFakeTimers();
    const collector = makeCollector();
    const engine = createStopwatchEngine(collector.handler);
    engine.start();
    vi.advanceTimersByTime(3500);

    expect(() => engine.recordLap()).not.toThrow();

    engine.destroy();
    vi.useRealTimers();
  });
});

// ─── destroy() ────────────────────────────────────────────────────────────────

describe('TimerEngine — destroy()', () => {
  it('stops emitting events after destroy', () => {
    vi.useFakeTimers();
    const clock = makeFakeClock();
    const collector = makeCollector();

    const engine = new TimerEngine({
      steps: makeSteps(1, 60_000),
      onEvent: collector.handler,
      timeSource: clock.fn,
      tickIntervalMs: 100,
    });

    engine.start();
    vi.advanceTimersByTime(3000);
    clock.advance(3000);

    engine.destroy();
    const countAfterDestroy = collector.events.length;

    // Advance more — should not produce new events
    clock.advance(5_000);
    vi.advanceTimersByTime(500);

    expect(collector.events.length).toBe(countAfterDestroy);
    vi.useRealTimers();
  });
});
