/**
 * GraphEngine — Phase 3 graph-traversal session runner.
 *
 * Walks a WorkoutGraph DAG, evaluating DSL conditions on each outgoing edge
 * at step completion to determine the next node. Emits the same EngineEventPayload
 * events as TimerEngine plus two graph-specific events:
 *
 *   'graph:branch'           — a conditional DSL edge was taken
 *   'graph:choice_required'  — engine is waiting for user input before advancing
 *
 * The EvalContext is mutable mid-session via updateEvalContext() so callers can
 * inject live values (reps entered by user, readiness score, etc.).
 *
 * Usage:
 *   const engine = new GraphEngine({ graph, evalContext, onEvent });
 *   engine.start();
 *   // ... UI renders events ...
 *   engine.updateEvalContext({ reps: 12 });
 *   // When 'graph:choice_required' fires:
 *   engine.resolveChoice('skip');
 */

import type {
  EngineState,
  EngineEventPayload,
  WorkoutStep,
  SessionCompletePayload,
  StepType,
} from './types';
import type {
  WorkoutGraph,
  GraphEdge,
  EvalContext,
  GraphBranchPayload,
  GraphChoiceRequiredPayload,
} from './dslTypes';
import { GRAPH_END } from './dslTypes';
import { checkCondition } from './dslParser';

// ─── Extended event type ──────────────────────────────────────────────────────

export type GraphEngineEvent =
  | EngineEventPayload
  | { type: 'graph:branch';          data: GraphBranchPayload }
  | { type: 'graph:choice_required'; data: GraphChoiceRequiredPayload };

// ─── Internal helpers ─────────────────────────────────────────────────────────

function nodeToStep(
  nodeId: string,
  graph: WorkoutGraph,
  stepIndex: number,
  _totalSteps: number,
  nextLabel?: string,
): WorkoutStep | null {
  const node = graph.nodes.get(nodeId);
  if (!node) return null;
  const { block } = node;
  const type: StepType = block.type === 'rest' ? 'rest' : 'exercise';
  return {
    step_index: stepIndex,
    block_id:   block.id,
    type,
    label:      block.label,
    duration_ms: block.duration_ms ?? 0,
    meta: { next_label: nextLabel },
  };
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface GraphEngineOptions {
  graph:        WorkoutGraph;
  evalContext:  EvalContext;
  onEvent:      (event: GraphEngineEvent) => void;
  /** Heartbeat interval in ms. Default 100. */
  heartbeatMs?: number;
  /** Override for testing — defaults to Date.now. */
  timeSource?:  () => number;
  /**
   * Called with a vibration pattern when haptic feedback should fire.
   * Mirrors TimerEngineOptions.onHaptic — injectable so the engine stays
   * free of direct hardware dependencies.
   */
  onHaptic?: (pattern: number | number[]) => void;
}

// ─── GraphEngine ──────────────────────────────────────────────────────────────

export class GraphEngine {
  private readonly graph:       WorkoutGraph;
  private          evalCtx:     EvalContext;
  private readonly onEvent:     (e: GraphEngineEvent) => void;
  private readonly heartbeatMs: number;
  private readonly timeSource:  () => number;

  private _state:          EngineState = 'IDLE';
  private _currentNodeId:  string;
  private _stepIndex:      number  = 0;
  private _stepStart:      number  = 0;
  private _pausedMs:       number  = 0;
  private _pauseStart:     number | null = null;
  private _hb:             ReturnType<typeof setInterval> | null = null;
  private _totalSteps:     number;
  private _onHaptic:       ((pattern: number | number[]) => void) | undefined;

  // Session accumulators
  private readonly _sessionId:    string = crypto.randomUUID();
  private          _sessionStart: number = 0;
  private          _stepsCompleted = 0;
  private          _stepsSkipped   = 0;
  private          _lastStep:      WorkoutStep | null = null;
  private          _pendingFrom:   WorkoutStep | null = null;

  // User-choice flow
  private _waitingForChoice = false;

  constructor(opts: GraphEngineOptions) {
    this.graph        = opts.graph;
    this.evalCtx      = { ...opts.evalContext };
    this.onEvent      = opts.onEvent;
    this.heartbeatMs  = opts.heartbeatMs ?? 100;
    this.timeSource   = opts.timeSource  ?? (() => Date.now());
    this._onHaptic    = opts.onHaptic;
    this._currentNodeId = opts.graph.entryId;
    this._totalSteps    = opts.graph.nodes.size;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  get currentState(): EngineState { return this._state; }
  get currentNodeId(): string     { return this._currentNodeId; }

  /** Start the 3-2-1 countdown then begin the first node. */
  start(): void {
    if (this._state !== 'IDLE') return;
    this._sessionStart = this.timeSource();
    this._state = 'COUNTDOWN';
    this._runCountdown(3, () => {
      this._state = 'ACTIVE';
      this._beginStep(this._currentNodeId, null);
    });
  }

  pause(): void {
    if (this._state !== 'ACTIVE') return;
    this._stopHeartbeat();
    this._pauseStart = this.timeSource();
    this._state = 'PAUSED';
    this._emit({ type: 'session:paused', data: { timestamp: this._pauseStart } });
  }

  resume(): void {
    if (this._state !== 'PAUSED') return;
    if (this._pauseStart !== null) {
      this._pausedMs += this.timeSource() - this._pauseStart;
      this._pauseStart = null;
    }
    this._state = 'ACTIVE';
    this._emit({ type: 'session:resumed', data: { timestamp: this.timeSource() } });
    if (this._lastStep) this._runHeartbeat(this._lastStep);
  }

  /** Skip current step, evaluate edges, advance. */
  skip(): void {
    if (this._state !== 'ACTIVE' && this._state !== 'PAUSED') return;
    this._stopHeartbeat();
    this._stepsSkipped++;
    this._advance();
  }

  destroy(): void {
    this._stopHeartbeat();
    this._state = 'IDLE';
  }

  /** Patch the live EvalContext — safe to call at any time during a session. */
  updateEvalContext(patch: Partial<EvalContext>): void {
    this.evalCtx = { ...this.evalCtx, ...patch };
  }

  /**
   * Resolve a pending user choice (call after receiving 'graph:choice_required').
   * @param answer - The option string the user selected.
   */
  resolveChoice(answer: string): void {
    if (!this._waitingForChoice) return;
    this._waitingForChoice = false;
    this.evalCtx = { ...this.evalCtx, user: answer };

    // Pass skipUserPrompt=true so the second evaluation skips the prompt-trigger
    // check and falls through to DSL condition matching instead.
    const result = this._resolveEdge(this._currentNodeId, true);
    if (result.waiting) return; // still waiting (shouldn't normally happen)

    if (result.nextId === GRAPH_END) {
      this._finishSession();
    } else {
      this._beginStep(result.nextId, this._pendingFrom);
    }
  }

  // ── Private: Countdown ───────────────────────────────────────────────────

  private _runCountdown(seconds: number, onDone: () => void): void {
    let remaining = seconds;

    const tick = (): void => {
      if (remaining <= 0) { onDone(); return; }
      this._emit({ type: 'countdown:tick', data: { remaining_seconds: remaining } });
      this._onHaptic?.(50);
      remaining--;
      setTimeout(tick, 1000);
    };

    tick(); // fire immediately (emits 3, then queues 2, then 1, then done)
  }

  // ── Private: Step lifecycle ──────────────────────────────────────────────

  private _beginStep(nodeId: string, fromStep: WorkoutStep | null): void {
    if (nodeId === GRAPH_END || !this.graph.nodes.has(nodeId)) {
      this._finishSession();
      return;
    }

    this._currentNodeId = nodeId;
    const node = this.graph.nodes.get(nodeId)!;

    // Routing nodes (conditional, circuit shell, etc.) have no runnable step —
    // evaluate their edges immediately and advance without emitting step events.
    const ROUTING_TYPES = new Set(['conditional', 'circuit', 'superset', 'amrap', 'emom']);
    if (ROUTING_TYPES.has(node.block.type)) {
      const result = this._resolveEdge(nodeId);
      if (result.waiting) {
        this._waitingForChoice = true;
        this._pendingFrom = fromStep;
        return;
      }
      if (result.nextId === GRAPH_END) { this._finishSession(); }
      else { this._beginStep(result.nextId, fromStep); }
      return;
    }

    // Peek at the first unconditional successor for next_label
    const peekId   = this._peekNextId(nodeId);
    const peekNode = peekId && peekId !== GRAPH_END ? this.graph.nodes.get(peekId) : undefined;

    const step = nodeToStep(nodeId, this.graph, this._stepIndex, this._totalSteps, peekNode?.block.label);
    if (!step) { this._finishSession(); return; }

    this._lastStep = step;

    // Reset per-step timing
    this._stepStart  = this.timeSource();
    this._pausedMs   = 0;
    this._pauseStart = null;

    // Mirror TimerEngine: fire transition + step:start together
    this._emit({ type: 'transition:start', data: { from_step: fromStep, to_step: step } });
    this._emit({
      type: 'step:start',
      data: { step, step_index: this._stepIndex, total_steps: this._totalSteps },
    });

    // Haptic feedback: double-buzz on first step, single tick on transitions
    this._onHaptic?.(this._stepIndex === 0 ? [100, 50, 100] : 50);

    if (step.duration_ms === 0) {
      // Unlimited (stopwatch) — heartbeat only, no auto-advance
      this._runHeartbeat(step);
      return;
    }

    this._runHeartbeat(step);
  }

  private _runHeartbeat(step: WorkoutStep): void {
    this._stopHeartbeat();

    this._hb = setInterval(() => {
      if (this._state !== 'ACTIVE') return;

      const now        = this.timeSource();
      const pauseExtra = this._pauseStart ? now - this._pauseStart : 0;
      const elapsed    = now - this._stepStart - this._pausedMs - pauseExtra;
      const duration   = step.duration_ms;
      const remaining  = duration > 0 ? Math.max(0, duration - elapsed) : 0;
      const progress   = duration > 0 ? Math.min(1, elapsed / duration) : 0;

      // Keep DSL context current
      this.evalCtx = {
        ...this.evalCtx,
        time:         elapsed,
        elapsed_ms:   elapsed,
        remaining_ms: remaining,
      };

      this._emit({ type: 'step:tick', data: { elapsed_ms: elapsed, remaining_ms: remaining, progress } });

      if (duration > 0 && elapsed >= duration) {
        this._stopHeartbeat();
        if (step.type === 'exercise') this._stepsCompleted++;
        this._emit({ type: 'step:complete', data: step });
        this._advance();
      }
    }, this.heartbeatMs);
  }

  // ── Private: Edge resolution + advancement ───────────────────────────────

  private _advance(): void {
    const fromStep = this._lastStep;
    this._stepIndex++;

    const result = this._resolveEdge(this._currentNodeId);

    if (result.waiting) {
      // Pause flow — wait for resolveChoice()
      this._waitingForChoice = true;
      this._pendingFrom = fromStep;
      return;
    }

    if (result.nextId === GRAPH_END) {
      this._finishSession();
    } else {
      this._beginStep(result.nextId, fromStep);
    }
  }

  /**
   * Evaluate outgoing edges from nodeId using the current EvalContext.
   * Returns the first edge whose condition is true (or unconditional).
   * Emits 'graph:branch' when a conditional edge is taken.
   * Emits 'graph:choice_required' and returns { waiting: true } for prompt edges.
   *
   * @param skipUserPrompt - When true (used by resolveChoice on second pass),
   *   skip the userPrompt trigger and fall through to DSL condition evaluation.
   *   This prevents an infinite re-prompt loop after the user has made a choice.
   */
  private _resolveEdge(nodeId: string, skipUserPrompt = false): { nextId: string; waiting: boolean } {
    const node = this.graph.nodes.get(nodeId);
    if (!node || node.edges.length === 0) return { nextId: GRAPH_END, waiting: false };

    for (const edge of node.edges) {
      // Unconditional — always taken
      if (!edge.condition) {
        return { nextId: edge.to, waiting: false };
      }

      // User-prompt edge — ask UI before evaluating (skipped on post-choice re-evaluation)
      if (edge.userPrompt && !skipUserPrompt) {
        const promptEdges = node.edges.filter(e => e.userPrompt);
        const payload: GraphChoiceRequiredPayload = {
          node_id: nodeId,
          prompt:  edge.userPrompt,
          options: promptEdges.map(e => e.label ?? e.condition ?? e.to),
        };
        this._emit({ type: 'graph:choice_required', data: payload });
        return { nextId: '', waiting: true };
      }

      // DSL condition — evaluate against live context
      try {
        if (checkCondition(edge.condition, this.evalCtx)) {
          this._emitBranch(nodeId, edge);
          return { nextId: edge.to, waiting: false };
        }
      } catch {
        // Malformed condition — skip this edge, try next
      }
    }

    // No edge matched
    return { nextId: GRAPH_END, waiting: false };
  }

  /** Peek at the first unconditional successor id (for next_label display). */
  private _peekNextId(nodeId: string): string | null {
    const node = this.graph.nodes.get(nodeId);
    if (!node) return null;
    return node.edges.find(e => !e.condition)?.to ?? null;
  }

  // ── Private: Completion ──────────────────────────────────────────────────

  private _finishSession(): void {
    this._stopHeartbeat();
    this._state = 'COMPLETE';

    const completedAt = this.timeSource();
    const payload: SessionCompletePayload = {
      session_id:      this._sessionId,
      started_at:      this._sessionStart,
      completed_at:    completedAt,
      duration_ms:     completedAt - this._sessionStart,
      steps_completed: this._stepsCompleted,
      steps_skipped:   this._stepsSkipped,
    };
    this._emit({ type: 'session:complete', data: payload });
  }

  // ── Private: Utilities ───────────────────────────────────────────────────

  private _stopHeartbeat(): void {
    if (this._hb) { clearInterval(this._hb); this._hb = null; }
  }

  private _emitBranch(fromId: string, edge: GraphEdge): void {
    const payload: GraphBranchPayload = {
      from_node_id: fromId,
      to_node_id:   edge.to,
      edge,
      context:      this.evalCtx,
    };
    this._emit({ type: 'graph:branch', data: payload });
  }

  private _emit(event: GraphEngineEvent): void {
    this.onEvent(event);
  }
}
