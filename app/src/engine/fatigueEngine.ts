/**
 * Fatigue Engine — computes a 0–10 fatigue score from session history.
 *
 * Uses exponential decay weighting so recent sessions dominate older ones.
 * The score feeds into EvalContext.fatigue_score, enabling DSL conditions like:
 *
 *   fatigue_score >= 7 → skip heavy set
 *   fatigue_score < 4  → add bonus round
 *   readiness <= 5 || fatigue_score >= 6 → use lighter variant
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SessionRecord {
  /** ISO timestamp of session completion. */
  date: string;
  /** Fraction of planned steps completed: 0.0 – 1.0. */
  completion_ratio: number;
  /** User-reported fatigue after session (0 = none, 10 = exhausted). Optional. */
  post_fatigue_score?: number;
  /** User-reported readiness before session (0 = terrible, 10 = perfect). Optional. */
  pre_readiness_score?: number;
  /** Total session duration in ms (used for normalisation). Optional. */
  duration_ms?: number;
}

export type FatigueCategory = 'fresh' | 'moderate' | 'fatigued' | 'exhausted';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * λ for exponential decay weight: weight(i) = e^(-i * λ)
 * 0.35 → session 0 (today) weighs ~1.0, session 5 weighs ~0.17
 */
const DECAY_LAMBDA = 0.35;

/** Only consider the most recent N sessions. */
const MAX_SESSIONS = 10;

/** Smoothing constant — avoids extreme swings from single outlier sessions. */
const SMOOTHING = 0.2;

// ─── Core algorithm ───────────────────────────────────────────────────────────

/**
 * Estimate a fatigue score from completion_ratio when no explicit score is given.
 * Low completion → high fatigue.  Range: 1–9.
 */
function estimateFromRatio(ratio: number): number {
  // Clamp then invert: ratio 1.0 → score 1, ratio 0.0 → score 9
  const clamped = Math.min(1, Math.max(0, ratio));
  return 1 + (1 - clamped) * 8;
}

/**
 * Calculate a weighted fatigue score from session history.
 *
 * Algorithm:
 *   1. Sort sessions descending by date (newest = index 0)
 *   2. Take up to MAX_SESSIONS
 *   3. For each session i, weight = exp(-i * λ)
 *   4. Score source priority: post_fatigue_score → estimated from completion_ratio
 *   5. Weighted average, then Gaussian-smooth with SMOOTHING
 *
 * @param history - Array of session records in any date order.
 * @returns Fatigue score 0.0–10.0 (one decimal place). 0 if no history.
 */
export function calculateFatigueScore(history: SessionRecord[]): number {
  if (history.length === 0) return 0;

  // Sort descending (newest first), cap at MAX_SESSIONS
  const recent = [...history]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, MAX_SESSIONS);

  let weightedSum = 0;
  let totalWeight = 0;

  for (let i = 0; i < recent.length; i++) {
    const s = recent[i];
    const weight = Math.exp(-i * DECAY_LAMBDA);
    const raw = s.post_fatigue_score ?? estimateFromRatio(s.completion_ratio);

    // Adjust by readiness inverse: low readiness means the session outcome was under-resourced
    const readinessAdj = s.pre_readiness_score !== undefined
      ? (1 - s.pre_readiness_score / 10) * 1.5  // up to +1.5 if readiness was 0
      : 0;

    weightedSum += Math.min(10, raw + readinessAdj) * weight;
    totalWeight += weight;
  }

  const raw = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Smooth: blend with a neutral midpoint (5) by SMOOTHING factor
  const smoothed = raw * (1 - SMOOTHING) + 5 * SMOOTHING;

  return Math.min(10, Math.max(0, Math.round(smoothed * 10) / 10));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Classify a fatigue score into a human-readable category.
 *
 * | Score  | Category   |
 * |--------|------------|
 * | 0–3    | fresh      |
 * | 3–5.5  | moderate   |
 * | 5.5–8  | fatigued   |
 * | 8–10   | exhausted  |
 */
export function classifyFatigue(score: number): FatigueCategory {
  if (score <= 3)   return 'fresh';
  if (score <= 5.5) return 'moderate';
  if (score <= 8)   return 'fatigued';
  return 'exhausted';
}

/**
 * Modification factor for volume/intensity based on fatigue.
 * Returns a multiplier 0.70–1.00.
 *
 * Use in DSL conditions: `reps >= 10 * fatigueModFactor(fatigue_score)`
 * or simply let the runtime inject it:  `fatigue_score <= 5`
 *
 * At score 0  → factor 1.00 (full intensity)
 * At score 10 → factor 0.70 (30% reduction)
 */
export function fatigueModFactor(score: number): number {
  const clamped = Math.min(10, Math.max(0, score));
  return Math.round((1.0 - clamped * 0.03) * 100) / 100;
}

/**
 * Estimate next-session recovery state.
 * Returns hours recommended before training again.
 */
export function recommendedRestHours(score: number): number {
  if (score <= 3)  return 12;
  if (score <= 5)  return 24;
  if (score <= 7)  return 36;
  if (score <= 8.5) return 48;
  return 72;
}
