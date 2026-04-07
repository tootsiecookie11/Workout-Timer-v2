import { create } from 'zustand';
import { ExecutionStep } from '../types/workout';

export type EngineState = 'IDLE' | 'COUNTDOWN' | 'ACTIVE' | 'TRANSITIONING' | 'PAUSED' | 'COMPLETE';

interface TimerEngineStore {
  state: EngineState;
  
  // Queue Data
  queue: ExecutionStep[];
  currentStepIndex: number;
  
  // Timing State
  durationMs: number;
  elapsedMs: number;
  remainingMs: number;
  startEpochMs: number | null;
  
  // Session Summary
  sessionStartMs: number | null;
  sessionElapsedMs: number;

  // Actions
  loadQueue: (queue: ExecutionStep[]) => void;
  startSession: () => void;
  pauseSession: () => void;
  resumeSession: () => void;
  tick: () => void;
  advanceStep: () => void;
  skipStep: () => void;
  reset: () => void;
}

export const useEngineStore = create<TimerEngineStore>((set, get) => ({
  state: 'IDLE',
  queue: [],
  currentStepIndex: 0,
  
  durationMs: 0,
  elapsedMs: 0,
  remainingMs: 0,
  startEpochMs: null,

  sessionStartMs: null,
  sessionElapsedMs: 0,

  loadQueue: (queue) => set({ queue, state: 'IDLE', currentStepIndex: 0 }),
  
  startSession: () => {
    const { queue } = get();
    if (queue.length === 0) return;
    
    // In full app, we start countdown. For delta logic we jump to ACTIVE.
    const firstStep = queue[0];
    const duration = firstStep.duration_ms || 0;
    
    set({
      state: 'ACTIVE',
      currentStepIndex: 0,
      durationMs: duration,
      elapsedMs: 0,
      remainingMs: duration,
      startEpochMs: Date.now(),
      sessionStartMs: Date.now()
    });
  },

  pauseSession: () => {
    const { state } = get();
    if (state === 'ACTIVE') set({ state: 'PAUSED', startEpochMs: null });
  },

  resumeSession: () => {
    const { state, elapsedMs } = get();
    if (state === 'PAUSED') {
      const newEpoch = Date.now() - elapsedMs;
      set({ state: 'ACTIVE', startEpochMs: newEpoch });
    }
  },

  tick: () => {
    const { state, startEpochMs, durationMs, advanceStep, sessionStartMs } = get();
    if (state !== 'ACTIVE' || !startEpochMs) return;

    const now = Date.now();
    const newElapsed = now - startEpochMs;
    const newRemaining = durationMs - newElapsed;

    const sessionElapsed = sessionStartMs ? now - sessionStartMs : 0;

    if (newRemaining <= 0) {
      advanceStep();
    } else {
      set({ elapsedMs: newElapsed, remainingMs: newRemaining, sessionElapsedMs: sessionElapsed });
    }
  },

  advanceStep: () => {
    const { currentStepIndex, queue } = get();
    const nextIndex = currentStepIndex + 1;
    
    if (nextIndex >= queue.length) {
      set({ state: 'COMPLETE', startEpochMs: null, remainingMs: 0 });
      return;
    }

    const nextStep = queue[nextIndex];
    const duration = nextStep.duration_ms || 0;
    
    set({
      state: 'ACTIVE',
      currentStepIndex: nextIndex,
      durationMs: duration,
      elapsedMs: 0,
      remainingMs: duration,
      startEpochMs: Date.now()
    });
  },

  skipStep: () => {
    get().advanceStep();
  },

  reset: () => {
    set({
      state: 'IDLE',
      currentStepIndex: 0,
      durationMs: 0,
      elapsedMs: 0,
      remainingMs: 0,
      startEpochMs: null,
      sessionStartMs: null,
      sessionElapsedMs: 0
    });
  }
}));
