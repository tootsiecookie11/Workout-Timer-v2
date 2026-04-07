import { BlockASTNode, ExecutionStep } from '../types/workout';

export function generateQueue(blocks: BlockASTNode[]): ExecutionStep[] {
  const queue: ExecutionStep[] = [];
  let stepIndex = 0;

  function traverse(node: BlockASTNode, roundMeta?: { round?: number; set?: number }) {
    if (node.type === 'circuit') {
      const rounds = node.rounds || 1;
      for (let r = 1; r <= rounds; r++) {
        if (node.children) {
          node.children.forEach(child => traverse(child, { ...roundMeta, round: r }));
        }
      }
    } else if (node.type === 'superset') {
      if (node.children) {
        node.children.forEach((child, idx) => traverse(child, { ...roundMeta, set: idx + 1 }));
      }
    } else if (node.type === 'exercise' || node.type === 'rest') {
       queue.push({
         step_index: stepIndex++,
         block_id: node.id,
         type: node.type,
         label: node.label,
         duration_ms: node.duration_ms,
         reps: node.reps,
         audio_cue: node.type === 'exercise' ? 'beep_start' : 'beep_rest',
         meta: roundMeta || {}
       });
    }

    if (node.rest_after) {
       queue.push({
         step_index: stepIndex++,
         block_id: `${node.id}-rest`,
         type: 'rest',
         label: 'Rest',
         duration_ms: node.rest_after * 1000,
         audio_cue: 'beep_rest',
         meta: {}
       });
    }
  }

  blocks.forEach(b => traverse(b));
  return queue;
}
