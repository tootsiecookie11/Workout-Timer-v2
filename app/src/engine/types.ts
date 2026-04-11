// ─── Block Model (PRD §5.2) ───────────────────────────────────────────────────

export type BlockType =
  | 'exercise'
  | 'rest'
  | 'superset'
  | 'circuit'
  | 'amrap'
  | 'emom'
  | 'conditional';

export interface WorkoutBlock {
  id: string;
  type: BlockType;
  label: string;
  /** Duration in milliseconds (for timed blocks) */
  duration_ms?: number;
  reps?: number;
  /** Rest injected after this block, in ms */
  rest_after_ms?: number;
  /** How many times to repeat this block (circuit / amrap) */
  rounds?: number;
  /** Nested blocks for superset / circuit / amrap */
  children?: WorkoutBlock[];
  /** DSL condition string for conditional blocks */
  condition?: string;
  audio_cue?: AudioCueId;
}

// ─── Step Model (output of queue generator, PRD §5.3) ────────────────────────

export type StepType = 'exercise' | 'rest' | 'countdown' | 'complete';

export interface WorkoutStep {
  step_index: number;
  block_id: string;
  type: StepType;
  label: string;
  /** 0 = unlimited (stopwatch mode) */
  duration_ms: number;
  audio_cue?: AudioCueId;
  meta: {
    round?: number;
    total_rounds?: number;
    set?: number;
    next_label?: string;
  };
}

// ─── Engine State Machine (PRD §5.4) ──────────────────────────────────────────

export type EngineState =
  | 'IDLE'
  | 'COUNTDOWN'
  | 'ACTIVE'
  | 'TRANSITIONING'
  | 'PAUSED'
  | 'COMPLETE';

// ─── Engine Events ────────────────────────────────────────────────────────────

export type EngineEventType =
  | 'step:start'
  | 'step:tick'
  | 'step:complete'
  | 'session:paused'
  | 'session:resumed'
  | 'session:complete'
  | 'transition:start'
  | 'countdown:tick';

export interface TickPayload {
  elapsed_ms: number;
  remaining_ms: number;
  progress: number; // 0–1
}

export interface StepStartPayload {
  step: WorkoutStep;
  step_index: number;
  total_steps: number;
}

export interface TransitionPayload {
  from_step: WorkoutStep | null;
  to_step: WorkoutStep;
}

export interface CountdownTickPayload {
  remaining_seconds: number;
}

export interface SessionCompletePayload {
  session_id: string;
  started_at: number;
  completed_at: number;
  duration_ms: number;
  steps_completed: number;
  steps_skipped: number;
  laps?: LapRecord[];
}

export type EngineEventPayload =
  | { type: 'step:start'; data: StepStartPayload }
  | { type: 'step:tick'; data: TickPayload }
  | { type: 'step:complete'; data: WorkoutStep }
  | { type: 'session:paused'; data: { timestamp: number } }
  | { type: 'session:resumed'; data: { timestamp: number } }
  | { type: 'session:complete'; data: SessionCompletePayload }
  | { type: 'transition:start'; data: TransitionPayload }
  | { type: 'countdown:tick'; data: CountdownTickPayload };

// ─── Audio Cues (PRD §5.6) ────────────────────────────────────────────────────

export type AudioCueId =
  | 'beep_start'
  | 'beep_rest'
  | 'beep_countdown'
  | 'beep_final'
  | 'chime_complete'
  | 'voice_exercise';

// ─── Timer Modes ─────────────────────────────────────────────────────────────

export type TimerMode = 'preset' | 'custom' | 'stopwatch' | 'program';

// ─── Stopwatch ────────────────────────────────────────────────────────────────

export interface LapRecord {
  lap_index: number;
  /** Total elapsed ms at time of lap */
  elapsed_ms: number;
  /** Time since previous lap */
  split_ms: number;
}

// ─── Custom Timer Builder ─────────────────────────────────────────────────────

export interface CustomInterval {
  id: string;
  label: string;
  work_ms: number;
  rest_ms: number;
  rounds: number;
}
