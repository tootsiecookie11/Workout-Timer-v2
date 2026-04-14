import { create } from 'zustand';
import { TimerEngine, createStopwatchEngine } from '../engine/timerEngine';
import { GraphEngine } from '../engine/graphEngine';
import { audioEngine } from '../engine/audioEngine';
import { useSettingsStore, TRANSITION_DISMISS_MS } from './settingsStore';
import { generateQueue, generateQueueFromCustom } from '../engine/queueGenerator';
import { calculateFatigueScore } from '../engine/fatigueEngine';
import type { SessionRecord } from '../engine/fatigueEngine';
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
import type { WorkoutGraph, EvalContext, GraphChoiceRequiredPayload } from '../engine/dslTypes';

// ─── localStorage helpers ─────────────────────────────────────────────────────

const HISTORY_KEY = 'galawgaw_session_history';

function loadSessionHistory(): SessionRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as SessionRecord[]) : [];
  } catch { return []; }
}

function saveSessionHistory(history: SessionRecord[]): void {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch {}
}

/** Reduce all exercise block duration_ms by a factor (default 0.85 = 15% less). */
function applySmartAdjust(blocks: WorkoutBlock[], factor = 0.85): WorkoutBlock[] {
  return blocks.map((b) => ({
    ...b,
    duration_ms: b.duration_ms ? Math.round(b.duration_ms * factor) : b.duration_ms,
    children:    b.children    ? applySmartAdjust(b.children, factor) : b.children,
  }));
}

// Compute initial values from persisted history once at module init.
const _initialHistory = loadSessionHistory();

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

  // ── DSL / Graph runtime ──────────────────────────────────────────────────
  /** Live evaluation context fed into DSL edge conditions. */
  evalContext: EvalContext | null;
  /** 0–10 fatigue score computed from Notion session history. */
  fatigueScore: number;
  /**
   * Set when GraphEngine emits 'graph:choice_required'.
   * UI renders the prompt; call resolveGraphChoice(answer) to advance.
   */
  pendingChoice: GraphChoiceRequiredPayload | null;

  // ── Session wall-clock ───────────────────────────────────────────────────
  /**
   * Unix timestamp (ms) of when the first step began.
   * Used to drive a wall-clock elapsed display that never pauses —
   * set once on the first step:start event, cleared on endSession.
   */
  sessionStartedAt: number | null;
  /**
   * Wall-clock elapsed ms from first step to session completion.
   * Frozen when session:complete fires; displayed on the summary screen.
   */
  sessionWallElapsed_ms: number | null;
  /**
   * Idle time = wallElapsed − scheduled exercise time.
   * Approximates time spent on rest steps + paused + transitions + skips.
   * Computed from stepQueue when session:complete fires.
   */
  sessionIdleTime_ms: number | null;

  // ── Pre-workout readiness modal ───────────────────────────────────────────
  /** True while the readiness modal is open (before session start). */
  readinessModalVisible: boolean;
  /** Blocks staged while waiting for readiness input. Null = use customIntervals. */
  pendingSessionBlocks: WorkoutBlock[] | null;
  /** Notion workout page id for the active preset session (used by sync). */
  activeWorkoutId: string | null;

  // ── Session history (local persistence for fatigue engine) ─────────────
  /** Up to 20 most-recent session records, persisted in localStorage. */
  sessionHistory: SessionRecord[];
  /** Append a completed-session record, recompute fatigueScore, and persist. */
  recordSession: (record: SessionRecord) => void;

  // ─── Actions ─────────────────────────────────────────────────────────────
  setMode: (mode: TimerMode) => void;

  // Stopwatch
  startStopwatch: () => void;
  pauseStopwatch: () => void;
  resumeStopwatch: () => void;
  resetStopwatch: () => void;
  lapStopwatch: () => void;

  // Custom / Preset flat-queue session
  startSession: (blocks?: WorkoutBlock[], evalCtxPatch?: Partial<EvalContext>) => void;

  // Pre-workout readiness flow
  requestSessionStart: (blocks?: WorkoutBlock[], workoutId?: string) => void;
  confirmReadiness: (readiness: number, smartAdjust?: boolean) => void;
  dismissReadinessModal: () => void;
  pauseSession: () => void;
  resumeSession: () => void;
  skipStep: () => void;
  endSession: () => void;

  // Graph session (Phase 3)
  startGraphSession: (graph: WorkoutGraph, evalCtx?: Partial<EvalContext>, workoutId?: string) => void;
  resolveGraphChoice: (answer: string) => void;
  updateEvalContext: (patch: Partial<EvalContext>) => void;

  // Step navigation
  prevStep: () => void;

  // Fatigue
  setFatigueScore: (score: number) => void;

  // Custom interval builder
  addCustomInterval: (interval: CustomInterval) => void;
  removeCustomInterval: (id: string) => void;
  updateCustomInterval: (id: string, patch: Partial<CustomInterval>) => void;
  clearCustomIntervals: () => void;
}

// ─── Internal Engine Refs ─────────────────────────────────────────────────────
// Held outside the store to avoid Zustand serialization of class instances.

let _engine: TimerEngine | null      = null;
let _graphEngine: GraphEngine | null = null;
/** Full step queue for the active session — used by prevStep to re-slice. */
let _fullQueue: WorkoutStep[]        = [];
/** Offset added to the engine's 0-based step_index so the display reflects
 *  the original position in the full queue after a prevStep navigation. */
let _stepOffset = 0;

// ── Real-time idle-time tracking ───────────────────────────────────────────
// These are accumulated during the session so session:complete can compute
// idle time = wallElapsed − actual exercise time precisely.

/** Cumulative actual wall time spent on exercise (non-rest) steps.
 *  Excludes transitions, pauses, and the time saved by early skips. */
let _exerciseAccumMs    = 0;
/** Adjusted wall timestamp of when the current step's active timer began
 *  (offset forward by transition duration so transitions are excluded). */
let _lastStepStartWall  = 0;
/** Whether the step currently being timed is a rest step. */
let _lastStepIsRest     = false;
/** Transition duration announced by transition:start — consumed by the
 *  next step:start to shift _lastStepStartWall past the overlay. */
let _pendingTransitionMs = 0;
/** Wall timestamp when the session was last paused. */
let _lastPauseWall      = 0;
/** Accumulated pause time within the current step (reset each step:start). */
let _stepPauseMs        = 0;

function destroyAll(): void {
  _engine?.destroy();
  _engine = null;
  _graphEngine?.destroy();
  _graphEngine = null;
}

// ─── Default EvalContext ──────────────────────────────────────────────────────

const DEFAULT_EVAL_CTX: EvalContext = {
  reps: 0, time: 0, round: 1, set: 1, user: null,
  elapsed_ms: 0, remaining_ms: 0,
};

// ─── Store ────────────────────────────────────────────────────────────────────

export const useTimerStore = create<TimerState>((set, get) => {

  // ── Shared event handler (TimerEngine + GraphEngine → store) ────────────

  const handleEvent = (event: EngineEventPayload | any): void => {
    switch (event.type) {
      case 'countdown:tick': {
        const { remaining_seconds } = event.data as CountdownTickPayload;
        set({ countdownSeconds: remaining_seconds });
        audioEngine.playCountdownTick();
        break;
      }

      case 'transition:start': {
        const toStep = event.data.to_step as WorkoutStep;
        const isRest = toStep.type === 'rest';
        const ctx: 'to-first' | 'to-work' | 'to-rest' =
          isRest
            ? 'to-rest'
            : event.data.from_step === null
              ? 'to-first'
              : 'to-work';
        const { work: workMs, rest: restMs } = TRANSITION_DISMISS_MS[useSettingsStore.getState().transitionDuration];
        const dismissMs = isRest ? restMs : workMs;
        // Stash so the next step:start knows to shift its wall-clock start
        // past the overlay, excluding transition time from exercise time.
        _pendingTransitionMs = dismissMs;
        set({
          countdownSeconds:    null,
          transitionVisible:   true,
          transitionToStep:    toStep,
          transitionFromStep:  event.data.from_step,
          transitionContext:   ctx,
        });
        setTimeout(() => set({ transitionVisible: false, transitionContext: null }), dismissMs);
        // Voice-announce the upcoming exercise after a brief pause so the
        // transition overlay renders before speech starts.
        setTimeout(() => audioEngine.announceExercise(toStep.label ?? '', isRest), 200);
        break;
      }

      case 'step:start': {
        // First step → double high-pitch "go!" beep; subsequent → single mid-pitch ding.
        // Haptic for step:start is fired by the engine via onHaptic (not here)
        // to avoid double-firing on both TimerEngine and GraphEngine sessions.
        const absIndex = event.data.step_index + _stepOffset;
        if (absIndex === 0) {
          audioEngine.playStartBeep();
        } else {
          audioEngine.playStepBeep();
        }
        // Latch the wall-clock start on the very first step of the session.
        // prevStep navigation intentionally leaves this unchanged so elapsed
        // time keeps counting from the original session start.
        const now = Date.now();

        // Shift the step's wall-clock start forward by the transition duration
        // so overlay time is excluded from exercise-time accounting.
        // _pendingTransitionMs is set by transition:start; 0 when skipCountdown.
        _lastStepIsRest    = event.data.step.type === 'rest';
        _lastStepStartWall = now + _pendingTransitionMs;
        _pendingTransitionMs = 0;
        _stepPauseMs       = 0;

        set((s) => ({
          engineState:   'ACTIVE',
          currentStep:   event.data.step,
          nextStepLabel: event.data.step.meta.next_label,
          // Use full-queue length when available so the counter never shrinks
          // when prevStep re-creates the engine from a mid-queue slice.
          stepIndex:  absIndex,
          totalSteps: _fullQueue.length || event.data.total_steps,
          elapsed_ms:   0,
          remaining_ms: event.data.step.duration_ms,
          progress:     0,
          sessionStartedAt: s.sessionStartedAt ?? now,
        }));
        break;
      }

      case 'step:tick':
        set({
          elapsed_ms:   event.data.elapsed_ms,
          remaining_ms: event.data.remaining_ms,
          progress:     event.data.progress,
        });
        // Mirror tick values back into evalContext for hot DSL re-evaluation
        set((s) => s.evalContext
          ? { evalContext: { ...s.evalContext, elapsed_ms: event.data.elapsed_ms, remaining_ms: event.data.remaining_ms, time: event.data.elapsed_ms } }
          : {}
        );
        break;

      case 'step:complete': {
        // Compute the actual wall time spent on this step, excluding:
        //   • The transition overlay (absorbed into _lastStepStartWall offset)
        //   • Any pause time accumulated during this step (_stepPauseMs)
        //   • If skipped while paused, add the ongoing pause duration too
        const ongoingPauseMs =
          get().engineState === 'PAUSED' ? Date.now() - _lastPauseWall : 0;
        const actualMs = Math.max(
          0,
          Date.now() - _lastStepStartWall - _stepPauseMs - ongoingPauseMs,
        );
        if (!_lastStepIsRest) _exerciseAccumMs += actualMs;
        break;
      }

      case 'session:paused':
        audioEngine.cancelSpeech();
        _lastPauseWall = Date.now();
        set({ engineState: 'PAUSED' });
        break;

      case 'session:resumed':
        _stepPauseMs += Date.now() - _lastPauseWall;
        set({ engineState: 'ACTIVE' });
        break;

      case 'session:complete': {
        audioEngine.cancelSpeech();
        audioEngine.vibrate([50, 30, 50, 30, 100]);

        // Freeze wall-clock elapsed (first step → completion, never paused).
        const { sessionStartedAt } = get();
        const wallMs = sessionStartedAt
          ? event.data.completed_at - sessionStartedAt
          : event.data.duration_ms;

        // Idle time = everything that wasn't active exercise:
        //   rest steps + transition overlays + pauses + time saved by skips.
        // _exerciseAccumMs was built up step-by-step in step:complete,
        // using real wall-clock deltas minus pause and transition time.
        const idleMs = Math.max(0, wallMs - _exerciseAccumMs);

        destroyAll();
        set({
          engineState:          'COMPLETE',
          sessionResult:        event.data,
          currentStep:          null,
          evalContext:          null,
          pendingChoice:        null,
          sessionWallElapsed_ms: wallMs,
          sessionIdleTime_ms:    idleMs,
        });
        break;
      }

      // ── Graph-specific events ──────────────────────────────────────────

      case 'graph:branch':
        // Optionally surface branch data in UI via a different slice
        break;

      case 'graph:choice_required':
        set({ pendingChoice: event.data as GraphChoiceRequiredPayload });
        break;
    }
  };

  return {
    // ── Initial state ─────────────────────────────────────────────────────
    mode:              'stopwatch',
    engineState:       'IDLE',
    currentStep:       null,
    nextStepLabel:     undefined,
    elapsed_ms:        0,
    remaining_ms:      0,
    progress:          0,
    stepIndex:         0,
    totalSteps:        0,
    countdownSeconds:  null,
    transitionVisible: false,
    transitionToStep:  null,
    transitionFromStep: null,
    transitionContext: null,
    laps:              [],
    customIntervals:   [],
    sessionResult:     null,
    stepQueue:         [],
    evalContext:           null,
    pendingChoice:         null,
    sessionStartedAt:      null,
    sessionWallElapsed_ms: null,
    sessionIdleTime_ms:    null,
    readinessModalVisible: false,
    pendingSessionBlocks:  null,
    activeWorkoutId:       null,
    sessionHistory:        _initialHistory,
    fatigueScore:          calculateFatigueScore(_initialHistory),

    // ── Mode ───────────────────────────────────────────────────────────────
    setMode: (mode) => {
      const { engineState } = get();
      if (engineState === 'ACTIVE' || engineState === 'PAUSED') return;
      set({ mode });
    },

    // ── Stopwatch ──────────────────────────────────────────────────────────
    startStopwatch: () => {
      destroyAll();
      // Engine emits step:start immediately (skipCountdown=true), which sets
      // engineState → 'ACTIVE'. Pre-set to ACTIVE so the UI never shows IDLE.
      set({ engineState: 'ACTIVE', elapsed_ms: 0, remaining_ms: 0, laps: [], sessionResult: null, countdownSeconds: null });
      _engine = createStopwatchEngine(handleEvent);
      _engine.start();
    },

    pauseStopwatch:  () => { _engine?.pause(); },
    resumeStopwatch: () => { _engine?.resume(); },

    resetStopwatch: () => {
      destroyAll();
      set({ engineState: 'IDLE', elapsed_ms: 0, remaining_ms: 0, progress: 0, laps: [], sessionResult: null, countdownSeconds: null, currentStep: null });
    },

    lapStopwatch: () => {
      if (!_engine) return;
      _engine.recordLap();
      const { elapsed_ms, laps } = get();
      const lastLap = laps[laps.length - 1];
      const splitMs = lastLap ? elapsed_ms - lastLap.elapsed_ms : elapsed_ms;
      set({ laps: [...laps, { lap_index: laps.length, elapsed_ms, split_ms: splitMs }] });
    },

    // ── Flat-queue Session (TimerEngine) ───────────────────────────────────
    startSession: (blocks?: WorkoutBlock[], evalCtxPatch?: Partial<EvalContext>) => {
      destroyAll();

      const queue = blocks
        ? generateQueue(blocks)
        : generateQueueFromCustom(get().customIntervals);

      if (queue.length === 0) return;

      // Reset navigation and idle-time tracking for a fresh session
      _fullQueue           = queue;
      _stepOffset          = 0;
      _exerciseAccumMs     = 0;
      _pendingTransitionMs = 0;
      _stepPauseMs         = 0;

      set({
        stepQueue:     queue,
        engineState:   'COUNTDOWN',
        sessionResult: null,
        countdownSeconds: 3,
        laps:          [],
        stepIndex:     0,
        totalSteps:    queue.length,
        evalContext:   { ...DEFAULT_EVAL_CTX, fatigue_score: get().fatigueScore || undefined, ...evalCtxPatch },
        pendingChoice:        null,
        sessionStartedAt:     null,
        sessionWallElapsed_ms: null,
        sessionIdleTime_ms:    null,
      });

      _engine = new TimerEngine({
        steps: queue,
        onEvent: handleEvent,
        onHaptic: (p) => audioEngine.vibrate(p),
        // Delay startEpoch by the overlay dismiss duration so the countdown
        // clock doesn't begin ticking until the TransitionOverlay has faded.
        getTransitionMs: (isRest) => {
          const { work, rest } = TRANSITION_DISMISS_MS[useSettingsStore.getState().transitionDuration];
          return isRest ? rest : work;
        },
      });
      _engine.start();
    },

    // ── Pre-workout Readiness flow ─────────────────────────────────────────
    requestSessionStart: (blocks?: WorkoutBlock[], workoutId?: string) => {
      set({ readinessModalVisible: true, pendingSessionBlocks: blocks ?? null, activeWorkoutId: workoutId ?? null });
    },

    confirmReadiness: (readiness: number, smartAdjust?: boolean) => {
      let blocks = get().pendingSessionBlocks ?? undefined;
      const evalPatch: Partial<EvalContext> = { readiness };
      if (smartAdjust && blocks) {
        blocks = applySmartAdjust(blocks);
        evalPatch.volume_modifier = 0.85;
      }
      set({ readinessModalVisible: false, pendingSessionBlocks: null });
      get().startSession(blocks, evalPatch);
    },

    dismissReadinessModal: () => {
      set({ readinessModalVisible: false, pendingSessionBlocks: null });
    },

    pauseSession:  () => { (_engine ?? _graphEngine)?.pause(); },
    resumeSession: () => { (_engine ?? _graphEngine)?.resume(); },
    skipStep:      () => { (_engine ?? _graphEngine as any)?.skip?.(); },

    endSession: () => {
      destroyAll();
      _fullQueue  = [];
      _stepOffset = 0;
      set({
        engineState:   'IDLE',
        currentStep:   null,
        elapsed_ms:    0,
        remaining_ms:  0,
        progress:      0,
        stepIndex:     0,
        totalSteps:    0,
        countdownSeconds: null,
        sessionResult:        null,
        stepQueue:            [],
        evalContext:          null,
        pendingChoice:        null,
        activeWorkoutId:      null,
        sessionStartedAt:     null,
        sessionWallElapsed_ms: null,
        sessionIdleTime_ms:    null,
      });
    },

    // ── Graph Session (GraphEngine / Phase 3) ──────────────────────────────
    startGraphSession: (graph: WorkoutGraph, evalCtxPatch?: Partial<EvalContext>, workoutId?: string) => {
      destroyAll();
      _exerciseAccumMs     = 0;
      _pendingTransitionMs = 0;
      _stepPauseMs         = 0;

      const evalCtx: EvalContext = {
        ...DEFAULT_EVAL_CTX,
        fatigue_score: get().fatigueScore || undefined,
        ...evalCtxPatch,
      };

      set({
        engineState:      'COUNTDOWN',
        sessionResult:    null,
        countdownSeconds: 3,
        laps:             [],
        stepIndex:        0,
        totalSteps:       graph.nodes.size,
        evalContext:      evalCtx,
        pendingChoice:    null,
        stepQueue:        [],
        activeWorkoutId:  workoutId ?? null,
      });

      _graphEngine = new GraphEngine({ graph, evalContext: evalCtx, onEvent: handleEvent, onHaptic: (p) => audioEngine.vibrate(p) });
      _graphEngine.start();
    },

    resolveGraphChoice: (answer: string) => {
      _graphEngine?.resolveChoice(answer);
      set({ pendingChoice: null });
    },

    updateEvalContext: (patch: Partial<EvalContext>) => {
      _graphEngine?.updateEvalContext(patch);
      set((s) => s.evalContext ? { evalContext: { ...s.evalContext, ...patch } } : {});
    },

    // ── Step Navigation ────────────────────────────────────────────────────
    prevStep: () => {
      // Graph sessions don't support going backwards.
      if (!_engine || _fullQueue.length === 0) return;
      const { stepIndex } = get();
      const targetIndex = Math.max(0, stepIndex - 1);
      _stepOffset = targetIndex;
      destroyAll();

      set({ engineState: 'ACTIVE', countdownSeconds: null });

      _engine = new TimerEngine({
        steps: _fullQueue.slice(targetIndex),
        onEvent: handleEvent,
        onHaptic: (p) => audioEngine.vibrate(p),
        // Skip the 3-2-1 countdown for mid-session navigation.
        skipCountdown: true,
        getTransitionMs: (isRest) => {
          const { work, rest } = TRANSITION_DISMISS_MS[useSettingsStore.getState().transitionDuration];
          return isRest ? rest : work;
        },
      });
      _engine.start();
    },

    // ── Fatigue ────────────────────────────────────────────────────────────
    setFatigueScore: (score: number) => {
      set({ fatigueScore: score });
      // Also push into a live graph session context if running
      _graphEngine?.updateEvalContext({ fatigue_score: score });
    },

    recordSession: (record: SessionRecord) => {
      const history = [...get().sessionHistory, record].slice(-20);
      saveSessionHistory(history);
      const score = calculateFatigueScore(history);
      set({ sessionHistory: history, fatigueScore: score });
      _graphEngine?.updateEvalContext({ fatigue_score: score });
    },

    // ── Custom Interval Builder ────────────────────────────────────────────
    addCustomInterval:    (interval) => set((s) => ({ customIntervals: [...s.customIntervals, interval] })),
    removeCustomInterval: (id)       => set((s) => ({ customIntervals: s.customIntervals.filter((i) => i.id !== id) })),
    updateCustomInterval: (id, patch) =>
      set((s) => ({ customIntervals: s.customIntervals.map((i) => i.id === id ? { ...i, ...patch } : i) })),
    clearCustomIntervals: () => set({ customIntervals: [] }),
  };
});
