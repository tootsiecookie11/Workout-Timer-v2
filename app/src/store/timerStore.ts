import { create } from 'zustand';
import { TimerEngine, createStopwatchEngine } from '../engine/timerEngine';
import { generateQueue, generateQueueFromCustom } from '../engine/queueGenerator';
import type {
  TimerMode,
  EngineState,
  WorkoutStep,
  WorkoutBlock,
  CustomInterval,
  LapRecord,
  SessionCompletePayload,
  EngineEventPayload,
  CountdownTickPayload,
} from '../engine/types';

// ─── Store Shape ──────────────────────────────────────────────────────────────

interface TimerState {
  // ── Mode ──────────────────────────────────────────────────────────────────
  mode: TimerMode;

  // ── Engine state mirrored for UI ─────────────────────────────────────────
  engineState: EngineState;
  currentStep: WorkoutStep | null;
  nextStepLabel: string | undefined;
  elapsed_ms: number;
  remaining_ms: number;
  progress: number;       // 0–1, for progress bar
  stepIndex: number;
  totalSteps: number;

  // ── Countdown overlay ────────────────────────────────────────────────────
  countdownSeconds: number | null;

  // ── Transition overlay ───────────────────────────────────────────────────
  transitionVisible: boolean;
  transitionToStep: WorkoutStep | null;
  transitionFromStep: WorkoutStep | null;
  transitionContext: 'to-first' | 'to-work' | 'to-rest' | null;

  // ── Stopwatch ─────────────────────────────────────────────────────────────
  laps: LapRecord[];

  // ── Custom timer builder ──────────────────────────────────────────────────
  customIntervals: CustomInterval[];

  // ── Session result ────────────────────────────────────────────────────────
  sessionResult: SessionCompletePayload | null;

  // ── Step queue (set at session start, immutable during session) ───────────
  stepQueue: WorkoutStep[];

  // ─── Actions ─────────────────────────────────────────────────────────────
  setMode: (mode: TimerMode) => void;

  // Stopwatch
  startStopwatch: () => void;
  pauseStopwatch: () => void;
  resumeStopwatch: () => void;
  resetStopwatch: () => void;
  lapStopwatch: () => void;

  // Custom / Preset session
  startSession: (blocks?: WorkoutBlock[]) => void;
  pauseSession: () => void;
  resumeSession: () => void;
  skipStep: () => void;
  endSession: () => void;

  // Custom interval builder
  addCustomInterval: (interval: CustomInterval) => void;
  removeCustomInterval: (id: string) => void;
  updateCustomInterval: (id: string, patch: Partial<CustomInterval>) => void;
  clearCustomIntervals: () => void;
}

// ─── Internal Engine Ref ──────────────────────────────────────────────────────

// Held outside the store to avoid Zustand serialization of a class instance
let _engine: TimerEngine | null = null;

function destroyEngine(): void {
  _engine?.destroy();
  _engine = null;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useTimerStore = create<TimerState>((set, get) => {
  // ── Event handler (engine → store) ────────────────────────────────────────
  const handleEvent = (event: EngineEventPayload): void => {
    switch (event.type) {
      case 'countdown:tick':
        set({ countdownSeconds: (event.data as CountdownTickPayload).remaining_seconds });
        break;

      case 'transition:start': {
        const ctx: 'to-first' | 'to-work' | 'to-rest' =
          event.data.to_step.type === 'rest'
            ? 'to-rest'
            : event.data.from_step === null
              ? 'to-first'
              : 'to-work';
        const dismissMs = ctx === 'to-rest' ? 1400 : 900;
        set({
          countdownSeconds: null,
          transitionVisible: true,
          transitionToStep: event.data.to_step,
          transitionFromStep: event.data.from_step,
          transitionContext: ctx,
        });
        setTimeout(() => set({ transitionVisible: false, transitionContext: null }), dismissMs);
        break;
      }

      case 'step:start':
        set({
          engineState: 'ACTIVE',
          currentStep: event.data.step,
          nextStepLabel: event.data.step.meta.next_label,
          stepIndex: event.data.step_index,
          totalSteps: event.data.total_steps,
          elapsed_ms: 0,
          remaining_ms: event.data.step.duration_ms,
          progress: 0,
        });
        break;

      case 'step:tick':
        set({
          elapsed_ms: event.data.elapsed_ms,
          remaining_ms: event.data.remaining_ms,
          progress: event.data.progress,
        });
        break;

      case 'step:complete':
        // The engine will immediately fire step:start for the next step
        break;

      case 'session:paused':
        set({ engineState: 'PAUSED' });
        break;

      case 'session:resumed':
        set({ engineState: 'ACTIVE' });
        break;

      case 'session:complete':
        destroyEngine();
        set({
          engineState: 'COMPLETE',
          sessionResult: event.data,
          currentStep: null,
        });
        break;
    }
  };

  return {
    // ── Initial state ─────────────────────────────────────────────────────
    mode: 'stopwatch',
    engineState: 'IDLE',
    currentStep: null,
    nextStepLabel: undefined,
    elapsed_ms: 0,
    remaining_ms: 0,
    progress: 0,
    stepIndex: 0,
    totalSteps: 0,
    countdownSeconds: null,
    transitionVisible: false,
    transitionToStep: null,
    transitionFromStep: null,
    transitionContext: null,
    laps: [],
    customIntervals: [],
    sessionResult: null,
    stepQueue: [],

    // ── Mode ───────────────────────────────────────────────────────────────
    setMode: (mode) => {
      // Block mode switch during an active session
      const { engineState } = get();
      if (engineState === 'ACTIVE' || engineState === 'PAUSED') return;
      set({ mode });
    },

    // ── Stopwatch ──────────────────────────────────────────────────────────
    startStopwatch: () => {
      destroyEngine();
      set({
        engineState: 'IDLE',
        elapsed_ms: 0,
        remaining_ms: 0,
        laps: [],
        sessionResult: null,
        countdownSeconds: null,
      });
      _engine = createStopwatchEngine(handleEvent);
      _engine.start();
    },

    pauseStopwatch: () => {
      _engine?.pause();
    },

    resumeStopwatch: () => {
      _engine?.resume();
    },

    resetStopwatch: () => {
      destroyEngine();
      set({
        engineState: 'IDLE',
        elapsed_ms: 0,
        remaining_ms: 0,
        progress: 0,
        laps: [],
        sessionResult: null,
        countdownSeconds: null,
        currentStep: null,
      });
    },

    lapStopwatch: () => {
      if (!_engine) return;
      _engine.recordLap();
      // Sync laps from engine by reading the elapsed at lap time from the event
      // The store will update via session:complete laps array; for live display
      // we update via a synthetic approach:
      const { elapsed_ms, laps } = get();
      const lastLap = laps[laps.length - 1];
      const splitMs = lastLap ? elapsed_ms - lastLap.elapsed_ms : elapsed_ms;
      set({
        laps: [
          ...laps,
          { lap_index: laps.length, elapsed_ms, split_ms: splitMs },
        ],
      });
    },

    // ── Custom / Preset Session ────────────────────────────────────────────
    startSession: (blocks?: WorkoutBlock[]) => {
      destroyEngine();

      let queue: WorkoutStep[];
      if (blocks) {
        queue = generateQueue(blocks);
      } else {
        // Use custom intervals from store
        queue = generateQueueFromCustom(get().customIntervals);
      }

      if (queue.length === 0) return;

      set({
        stepQueue: queue,
        engineState: 'COUNTDOWN',
        sessionResult: null,
        countdownSeconds: 3,
        laps: [],
        stepIndex: 0,
        totalSteps: queue.length,
      });

      _engine = new TimerEngine({ steps: queue, onEvent: handleEvent });
      _engine.start();
    },

    pauseSession: () => {
      _engine?.pause();
    },

    resumeSession: () => {
      _engine?.resume();
    },

    skipStep: () => {
      _engine?.skip();
    },

    endSession: () => {
      destroyEngine();
      set({
        engineState: 'IDLE',
        currentStep: null,
        elapsed_ms: 0,
        remaining_ms: 0,
        progress: 0,
        stepIndex: 0,
        totalSteps: 0,
        countdownSeconds: null,
        sessionResult: null,
        stepQueue: [],
      });
    },

    // ── Custom Interval Builder ────────────────────────────────────────────
    addCustomInterval: (interval) =>
      set((s) => ({ customIntervals: [...s.customIntervals, interval] })),

    removeCustomInterval: (id) =>
      set((s) => ({ customIntervals: s.customIntervals.filter((i) => i.id !== id) })),

    updateCustomInterval: (id, patch) =>
      set((s) => ({
        customIntervals: s.customIntervals.map((i) =>
          i.id === id ? { ...i, ...patch } : i,
        ),
      })),

    clearCustomIntervals: () => set({ customIntervals: [] }),
  };
});
