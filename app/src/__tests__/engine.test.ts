import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useEngineStore } from '../store/engine';
import { ExecutionStep } from '../types/workout';

// Mock performance/Date for deterministic timing
beforeEach(() => {
  useEngineStore.getState().reset();
  vi.useFakeTimers();
});

const mockQueue: ExecutionStep[] = [
  { step_index: 0, block_id: 'ex-1', type: 'exercise', label: 'Pushups', duration_ms: 10000 },
  { step_index: 1, block_id: 'rest-1', type: 'rest', label: 'Rest', duration_ms: 5000 }
];

describe('Delta-based Timer Engine', () => {
  it('should load queue and start session correctly', () => {
    useEngineStore.getState().loadQueue(mockQueue);
    
    expect(useEngineStore.getState().state).toBe('IDLE');
    expect(useEngineStore.getState().queue.length).toBe(2);

    useEngineStore.getState().startSession();
    
    expect(useEngineStore.getState().state).toBe('ACTIVE');
    expect(useEngineStore.getState().durationMs).toBe(10000);
    expect(useEngineStore.getState().remainingMs).toBe(10000);
    expect(useEngineStore.getState().startEpochMs).toBeDefined();
  });

  it('should calculate elapsed time on tick', () => {
    useEngineStore.getState().loadQueue(mockQueue);
    useEngineStore.getState().startSession();

    // Advance mock time by 3 seconds (3000ms)
    vi.advanceTimersByTime(3000);
    
    useEngineStore.getState().tick();

    expect(useEngineStore.getState().elapsedMs).toBe(3000);
    expect(useEngineStore.getState().remainingMs).toBe(7000); // 10000 - 3000 = 7000
  });

  it('should pause and resume without losing delta track', () => {
    useEngineStore.getState().loadQueue(mockQueue);
    useEngineStore.getState().startSession();

    // Work for 5 seconds
    vi.advanceTimersByTime(5000);
    useEngineStore.getState().tick();

    // Pause system
    useEngineStore.getState().pauseSession();
    expect(useEngineStore.getState().state).toBe('PAUSED');
    expect(useEngineStore.getState().startEpochMs).toBeNull();
    
    // Simulate being paused for 20 seconds, should not affect remaining time
    vi.advanceTimersByTime(20000);

    // Resume system
    useEngineStore.getState().resumeSession();
    expect(useEngineStore.getState().state).toBe('ACTIVE');
    expect(useEngineStore.getState().startEpochMs).toBeDefined();

    // Tick again, remaining time shouldn't have jumped by 20s
    useEngineStore.getState().tick();
    expect(useEngineStore.getState().remainingMs).toBe(5000);
  });

  it('should auto-advance step when remaining drops below zero', () => {
    useEngineStore.getState().loadQueue(mockQueue);
    useEngineStore.getState().startSession();

    // Pass 11 seconds (duration is 10s)
    vi.advanceTimersByTime(11000);
    useEngineStore.getState().tick();

    // Should have advanced to step 2 (Rest, 5000ms duration)
    expect(useEngineStore.getState().currentStepIndex).toBe(1);
    expect(useEngineStore.getState().durationMs).toBe(5000);
    expect(useEngineStore.getState().state).toBe('ACTIVE');
  });

  it('should reach COMPLETE state after final step', () => {
    useEngineStore.getState().loadQueue(mockQueue);
    useEngineStore.getState().startSession(); // Step 0

    useEngineStore.getState().advanceStep();  // Skip to Step 1
    useEngineStore.getState().advanceStep();  // Skip past last step

    expect(useEngineStore.getState().state).toBe('COMPLETE');
  });
});
