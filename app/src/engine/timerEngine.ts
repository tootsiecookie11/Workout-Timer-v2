import type {
  EngineState,
  EngineEventPayload,
  WorkoutStep,
  SessionCompletePayload,
  LapRecord,
} from './types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type EventHandler = (event: EngineEventPayload) => void;

export interface TimerEngineOptions {
  steps: WorkoutStep[];
  onEvent: EventHandler;
  /** Injectable time source — override in tests. Defaults to Date.now. */
  timeSource?: () => number;
  /** Heartbeat interval in ms. Default 100ms. */
  tickIntervalMs?: number;
  /**
   * Called with a vibration pattern when haptic feedback should fire.
   * Injectable so the engine stays free of direct hardware dependencies.
   *
   * Patterns used:
   *   50             — each countdown tick (3, 2, 1)
   *   [100, 50, 100] — session start (first step begins)
   *   50             — each subsequent step transition
   */
  onHaptic?: (pattern: number | number[]) => void;
  /**
   * When true: skip the 3-2-1 countdown, suppress transition:start events,
   * and suppress haptic feedback on step begins. Used by createStopwatchEngine
   * so the stopwatch starts the moment the user taps Play with zero delay.
   */
  skipCountdown?: boolean;
  /** Callback to get transition duration, which delays the internal timer until the overlay fades. */
  getTransitionMs?: (isRest: boolean) => number;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

/**
 * Delta-based timer engine (PRD §5.4 + §5.5).
 *
 * No polling for time — elapsed = timeSource() - startEpoch.
 * setInterval fires only as a repaint heartbeat, not as the time source.
 */
export class TimerEngine {
  private steps: WorkoutStep[];
  private onEvent: EventHandler;
  private timeSource: () => number;
  private tickIntervalMs: number;

  private state: EngineState = 'IDLE';
  private stepIndex = 0;
  private startEpoch = 0;
  /** Accumulated ms paused so far — subtracted from elapsed */
  private pauseAccumMs = 0;
  private pauseStartMs = 0;
  private heartbeatId: ReturnType<typeof setInterval> | null = null;
  private sessionStartMs = 0;
  private stepsCompleted = 0;
  private stepsSkipped = 0;
  private sessionId: string;
  private onHaptic: ((pattern: number | number[]) => void) | undefined;
  private skipCountdown: boolean;
  private getTransitionMs: ((isRest: boolean) => number) | undefined;

  // Stopwatch / lap mode
  private laps: LapRecord[] = [];
  private lastLapMs = 0;

  constructor(options: TimerEngineOptions) {
    this.steps = options.steps;
    this.onEvent = options.onEvent;
    this.timeSource = options.timeSource ?? (() => Date.now());
    this.tickIntervalMs = options.tickIntervalMs ?? 100;
    this.onHaptic = options.onHaptic;
    this.skipCountdown = options.skipCountdown ?? false;
    this.getTransitionMs = options.getTransitionMs;
    this.sessionId = crypto.randomUUID();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  get currentState(): EngineState {
    return this.state;
  }

  get currentStepIndex(): number {
    return this.stepIndex;
  }

  /** Start the session. Emits 3-2-1 countdown then begins first step.
   *  When skipCountdown is true, jumps directly to the first step. */
  start(): void {
    if (this.state !== 'IDLE') return;
    this.sessionStartMs = this.timeSource();
    if (this.skipCountdown) {
      this.state = 'ACTIVE';
      this._beginStep(0);
    } else {
      this.state = 'COUNTDOWN';
      this._runCountdown(3, () => {
        this._beginStep(0);
      });
    }
  }

  /** Pause the active step. */
  pause(): void {
    if (this.state !== 'ACTIVE') return;
    this._clearHeartbeat();
    this.pauseStartMs = this.timeSource();
    this.state = 'PAUSED';
    this.onEvent({ type: 'session:paused', data: { timestamp: this.pauseStartMs } });
  }

  /** Resume from pause. */
  resume(): void {
    if (this.state !== 'PAUSED') return;
    this.pauseAccumMs += this.timeSource() - this.pauseStartMs;
    this.state = 'ACTIVE';
    this.onEvent({ type: 'session:resumed', data: { timestamp: this.timeSource() } });
    this._startHeartbeat();
  }

  /** Skip the current step and advance to the next. */
  skip(): void {
    if (this.state !== 'ACTIVE' && this.state !== 'PAUSED') return;
    this._clearHeartbeat();
    this.stepsSkipped++;
    this._completeStep();
  }

  /** Record a lap (stopwatch mode). */
  recordLap(): void {
    const now = this.timeSource();
    const elapsedMs = now - this.sessionStartMs - this.pauseAccumMs;
    const splitMs = elapsedMs - this.lastLapMs;
    this.laps.push({
      lap_index: this.laps.length,
      elapsed_ms: elapsedMs,
      split_ms: splitMs,
    });
    this.lastLapMs = elapsedMs;
  }

  /** Elapsed ms in the current step (excluding paused time and delayed transitions). */
  elapsed(): number {
    if (this.state === 'IDLE' || this.state === 'COMPLETE') return 0;
    if (this.state === 'PAUSED') {
      return Math.max(0, this.pauseStartMs - this.startEpoch - this.pauseAccumMs);
    }
    return Math.max(0, this.timeSource() - this.startEpoch - this.pauseAccumMs);
  }

  /** Total session elapsed ms. */
  totalElapsed(): number {
    if (this.state === 'IDLE') return 0;
    const base = this.state === 'PAUSED' ? this.pauseStartMs : this.timeSource();
    return base - this.sessionStartMs - this.pauseAccumMs;
  }

  /** Clean up the engine (clears intervals). */
  destroy(): void {
    this._clearHeartbeat();
    this.state = 'IDLE';
  }

  // ─── Private — Step Management ──────────────────────────────────────────────

  private _beginStep(index: number): void {
    if (index >= this.steps.length) {
      this._completeSession();
      return;
    }

    this.stepIndex = index;
    const step = this.steps[index];
    const nextStep = this.steps[index + 1];

    const transitionMs = !this.skipCountdown && this.getTransitionMs ? this.getTransitionMs(step.type === 'rest') : 0;

    // Reset per-step tracking
    this.startEpoch = this.timeSource() + transitionMs;
    this.pauseAccumMs = 0;
    this.state = 'ACTIVE';

    if (!this.skipCountdown) {
      this.onEvent({
        type: 'transition:start',
        data: { from_step: index > 0 ? this.steps[index - 1] : null, to_step: step },
      });
    }

    this.onEvent({
      type: 'step:start',
      data: {
        step: {
          ...step,
          meta: { ...step.meta, next_label: nextStep?.label },
        },
        step_index: index,
        total_steps: this.steps.length,
      },
    });

    // Haptic feedback: double-buzz on first step, single tick on transitions
    // Suppressed in skipCountdown mode (stopwatch)
    if (!this.skipCountdown) {
      this.onHaptic?.(index === 0 ? [100, 50, 100] : 50);
    }

    this._startHeartbeat();
  }

  private _completeStep(): void {
    const step = this.steps[this.stepIndex];
    this.stepsCompleted++;
    this.onEvent({ type: 'step:complete', data: step });
    this._beginStep(this.stepIndex + 1);
  }

  private _completeSession(): void {
    this._clearHeartbeat();
    this.state = 'COMPLETE';
    const completedAt = this.timeSource();
    const payload: SessionCompletePayload = {
      session_id: this.sessionId,
      started_at: this.sessionStartMs,
      completed_at: completedAt,
      duration_ms: completedAt - this.sessionStartMs,
      steps_completed: this.stepsCompleted,
      steps_skipped: this.stepsSkipped,
      laps: this.laps.length > 0 ? this.laps : undefined,
    };
    this.onEvent({ type: 'session:complete', data: payload });
  }

  // ─── Private — Heartbeat ────────────────────────────────────────────────────

  private _startHeartbeat(): void {
    this._clearHeartbeat();
    this.heartbeatId = setInterval(() => this._tick(), this.tickIntervalMs);
  }

  private _clearHeartbeat(): void {
    if (this.heartbeatId !== null) {
      clearInterval(this.heartbeatId);
      this.heartbeatId = null;
    }
  }

  private _tick(): void {
    if (this.state !== 'ACTIVE') return;

    const step = this.steps[this.stepIndex];
    const elapsed = this.elapsed();

    // Unlimited steps don't auto-advance
    if (step.duration_ms === 0) {
      this.onEvent({
        type: 'step:tick',
        data: { elapsed_ms: elapsed, remaining_ms: 0, progress: 0 },
      });
      return;
    }

    const remaining = Math.max(0, step.duration_ms - elapsed);
    const progress = Math.min(1, elapsed / step.duration_ms);

    this.onEvent({ type: 'step:tick', data: { elapsed_ms: elapsed, remaining_ms: remaining, progress } });

    if (remaining <= 0 && elapsed > 0) {
      this._clearHeartbeat();
      this._completeStep();
    }
  }

  // ─── Private — 3-2-1 Countdown ──────────────────────────────────────────────

  private _runCountdown(seconds: number, onDone: () => void): void {
    let remaining = seconds;

    const tick = (): void => {
      if (remaining <= 0) {
        onDone();
        return;
      }
      this.onEvent({ type: 'countdown:tick', data: { remaining_seconds: remaining } });
      this.onHaptic?.(50);
      remaining--;
      setTimeout(tick, 1000);
    };

    tick();
  }
}

// ─── Stopwatch Engine (unlimited steps) ──────────────────────────────────────

/**
 * Convenience factory for a pure stopwatch (no step queue, unlimited duration).
 */
export function createStopwatchEngine(onEvent: EventHandler): TimerEngine {
  const unlimitedStep = {
    step_index: 0,
    block_id: 'stopwatch',
    type: 'exercise' as const,
    label: 'Stopwatch',
    duration_ms: 0,
    meta: {},
  };
  return new TimerEngine({ steps: [unlimitedStep], onEvent, skipCountdown: true });
}
