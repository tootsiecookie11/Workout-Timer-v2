export type BlockType = 'exercise' | 'rest' | 'superset' | 'circuit' | 'amrap' | 'emom' | 'logic';

export interface BlockASTNode {
  id: string;
  type: BlockType;
  label: string;
  duration_ms?: number;
  reps?: number;
  rest_after?: number; // seconds
  rounds?: number;     // for circuit
  children?: BlockASTNode[]; // for superset/circuit
}

export interface ExecutionStep {
  step_index: number;
  block_id: string;
  type: BlockType;
  label: string;
  duration_ms?: number;
  reps?: number;
  audio_cue?: string;
  meta: {
    round?: number;
    set?: number;
  };
}
