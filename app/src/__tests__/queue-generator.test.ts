import { describe, it, expect } from 'vitest';
import { generateQueue } from '../lib/queue-generator';
import { BlockASTNode } from '../types/workout';

describe('Queue Generator', () => {
  it('should flatten a simple circuit out into sequential execution steps', () => {
    const ast: BlockASTNode[] = [
      {
        id: 'circuit-1',
        type: 'circuit',
        label: 'Warmup',
        rounds: 2,
        children: [
          {
            id: 'ex-1',
            type: 'exercise',
            label: 'Jumping Jacks',
            duration_ms: 30000,
            rest_after: 10,
          }
        ]
      }
    ];

    const queue = generateQueue(ast);
    
    // Expect 4 steps: (Ex1 -> Rest) * 2 rounds
    expect(queue.length).toBe(4);
    
    expect(queue[0].type).toBe('exercise');
    expect(queue[0].meta?.round).toBe(1);
    
    expect(queue[1].type).toBe('rest');
    expect(queue[1].duration_ms).toBe(10000); // 10 seconds

    expect(queue[2].type).toBe('exercise');
    expect(queue[2].meta?.round).toBe(2);
    
    expect(queue[3].type).toBe('rest');
  });

  it('should preserve meta information for supersets', () => {
    const ast: BlockASTNode[] = [
      {
        id: 'super-1',
        type: 'superset',
        label: 'Arm Blaster',
        children: [
          {
            id: 'ex-1',
            type: 'exercise',
            label: 'Bicep Curls',
            reps: 10
          },
          {
            id: 'ex-2',
            type: 'exercise',
            label: 'Tricep Extensions',
            duration_ms: 45000
          }
        ]
      }
    ];

    const queue = generateQueue(ast);
    expect(queue.length).toBe(2);
    
    expect(queue[0].type).toBe('exercise');
    expect(queue[0].reps).toBe(10);
    expect(queue[0].meta?.set).toBe(1);
    
    expect(queue[1].type).toBe('exercise');
    expect(queue[1].duration_ms).toBe(45000);
    expect(queue[1].meta?.set).toBe(2);
  });
});
