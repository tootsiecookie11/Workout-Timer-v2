import type { WorkoutBlock, WorkoutStep, StepType, CustomInterval } from './types';

let _stepCounter = 0;

function nextIndex(): number {
  return _stepCounter++;
}

function resetCounter(): void {
  _stepCounter = 0;
}

// ─── Core Traversal ───────────────────────────────────────────────────────────

/**
 * Recursively expands a block tree into a flat ordered queue of WorkoutSteps.
 * PRD §5.3: depth-first traversal, max nesting depth 5.
 */
function expandBlock(
  block: WorkoutBlock,
  round: number,
  totalRounds: number,
  depth: number,
  nextStepLabel: string | undefined,
): WorkoutStep[] {
  if (depth > 5) return []; // guard against deep nesting

  const steps: WorkoutStep[] = [];

  switch (block.type) {
    case 'exercise':
    case 'rest': {
      const stepType: StepType = block.type === 'rest' ? 'rest' : 'exercise';
      steps.push({
        step_index: nextIndex(),
        block_id: block.id,
        type: stepType,
        label: block.label,
        duration_ms: block.duration_ms ?? 0,
        audio_cue: block.audio_cue,
        meta: {
          round,
          total_rounds: totalRounds,
          next_label: nextStepLabel,
        },
      });

      // Inject rest-after step
      if (block.rest_after_ms && block.rest_after_ms > 0) {
        steps.push({
          step_index: nextIndex(),
          block_id: `${block.id}_rest`,
          type: 'rest',
          label: 'Rest',
          duration_ms: block.rest_after_ms,
          audio_cue: 'beep_rest',
          meta: { round, total_rounds: totalRounds, next_label: nextStepLabel },
        });
      }
      break;
    }

    case 'superset': {
      const children = block.children ?? [];
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const nextLabel = i < children.length - 1 ? children[i + 1].label : nextStepLabel;
        steps.push(...expandBlock(child, round, totalRounds, depth + 1, nextLabel));
      }
      break;
    }

    case 'circuit':
    case 'amrap': {
      const rounds = block.rounds ?? 1;
      const children = block.children ?? [];
      for (let r = 1; r <= rounds; r++) {
        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          const isLastChildLastRound = i === children.length - 1 && r === rounds;
          const nextLabel = isLastChildLastRound
            ? nextStepLabel
            : i < children.length - 1
            ? children[i + 1].label
            : children[0].label;
          steps.push(...expandBlock(child, r, rounds, depth + 1, nextLabel));
        }
      }
      break;
    }

    case 'emom': {
      // Each child goes on-the-minute; duration is always 60s per slot
      const rounds = block.rounds ?? 1;
      const children = block.children ?? [];
      for (let r = 1; r <= rounds; r++) {
        for (let i = 0; i < children.length; i++) {
          const child = { ...children[i], duration_ms: 60_000 };
          steps.push(...expandBlock(child, r, rounds, depth + 1, undefined));
        }
      }
      break;
    }

    case 'conditional': {
      // Conditionals are resolved at runtime. Emit the block as-is with a
      // special marker so the engine can evaluate and skip if needed.
      steps.push({
        step_index: nextIndex(),
        block_id: block.id,
        type: 'exercise',
        label: block.label,
        duration_ms: block.duration_ms ?? 0,
        meta: { round, total_rounds: totalRounds, next_label: nextStepLabel },
      });
      break;
    }
  }

  return steps;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Convert a block tree into a flat, immutable step queue.
 * Generated in < 100ms for workouts up to 200 steps (PRD §5.3).
 */
export function generateQueue(blocks: WorkoutBlock[]): WorkoutStep[] {
  resetCounter();

  if (blocks.length === 0) return [];

  const allSteps: WorkoutStep[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const nextBlockLabel = i < blocks.length - 1 ? blocks[i + 1].label : undefined;
    allSteps.push(...expandBlock(block, 1, 1, 0, nextBlockLabel));
  }

  // Re-index sequentially after expansion (indices may be discontinuous)
  return allSteps.map((step, idx) => ({ ...step, step_index: idx }));
}

/**
 * Convert a CustomInterval list (from the Custom Timer builder) into a step queue.
 */
export function generateQueueFromCustom(intervals: CustomInterval[]): WorkoutStep[] {
  const blocks: WorkoutBlock[] = intervals.map((interval) => ({
    id: interval.id,
    type: 'circuit' as const,
    label: interval.label,
    rounds: interval.rounds,
    children: [
      ...(interval.work_ms > 0
        ? [
            {
              id: `${interval.id}_work`,
              type: 'exercise' as const,
              label: interval.label,
              duration_ms: interval.work_ms,
              audio_cue: 'beep_start' as const,
            },
          ]
        : []),
      ...(interval.rest_ms > 0
        ? [
            {
              id: `${interval.id}_rest`,
              type: 'rest' as const,
              label: 'Rest',
              duration_ms: interval.rest_ms,
              audio_cue: 'beep_rest' as const,
            },
          ]
        : []),
    ],
  }));

  return generateQueue(blocks);
}

/**
 * Total duration of a step queue in milliseconds.
 */
export function totalDurationMs(steps: WorkoutStep[]): number {
  return steps.reduce((sum, s) => sum + s.duration_ms, 0);
}
