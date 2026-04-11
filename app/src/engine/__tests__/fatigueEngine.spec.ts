import { describe, it, expect } from 'vitest';
import {
  calculateFatigueScore,
  classifyFatigue,
  fatigueModFactor,
  recommendedRestHours,
} from '../fatigueEngine';
import type { SessionRecord } from '../fatigueEngine';

// ─── calculateFatigueScore ─────────────────────────────────────────────────────

describe('calculateFatigueScore', () => {
  it('returns 0 for empty history', () => {
    expect(calculateFatigueScore([])).toBe(0);
  });

  it('single perfect session (ratio=1.0) → low score', () => {
    const score = calculateFatigueScore([
      { date: new Date().toISOString(), completion_ratio: 1.0 },
    ]);
    expect(score).toBeLessThan(5);
  });

  it('single failed session (ratio=0.0) → high score', () => {
    const score = calculateFatigueScore([
      { date: new Date().toISOString(), completion_ratio: 0.0 },
    ]);
    expect(score).toBeGreaterThan(5);
  });

  it('explicit post_fatigue_score takes priority over ratio', () => {
    const score = calculateFatigueScore([
      { date: new Date().toISOString(), completion_ratio: 0.0, post_fatigue_score: 2 },
    ]);
    // Even with bad ratio, explicit score of 2 should give low score
    expect(score).toBeLessThan(4.5);
  });

  it('returns a number in [0, 10]', () => {
    const records: SessionRecord[] = [
      { date: new Date().toISOString(), completion_ratio: 0.3, post_fatigue_score: 9 },
      { date: new Date(Date.now() - 86400000).toISOString(), completion_ratio: 0.8 },
      { date: new Date(Date.now() - 172800000).toISOString(), completion_ratio: 0.1, post_fatigue_score: 10 },
    ];
    const score = calculateFatigueScore(records);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(10);
  });

  it('newer sessions are weighted more than older ones', () => {
    const now = Date.now();
    // Recent = very fatigued, old = fresh
    const highRecent = calculateFatigueScore([
      { date: new Date(now).toISOString(),             completion_ratio: 0.0, post_fatigue_score: 10 },
      { date: new Date(now - 7 * 86400000).toISOString(), completion_ratio: 1.0, post_fatigue_score: 0  },
    ]);
    // Recent = fresh, old = very fatigued
    const lowRecent = calculateFatigueScore([
      { date: new Date(now).toISOString(),             completion_ratio: 1.0, post_fatigue_score: 0  },
      { date: new Date(now - 7 * 86400000).toISOString(), completion_ratio: 0.0, post_fatigue_score: 10 },
    ]);
    expect(highRecent).toBeGreaterThan(lowRecent);
  });

  it('sorts sessions by date regardless of input order', () => {
    const now = Date.now();
    const inOrder = calculateFatigueScore([
      { date: new Date(now).toISOString(),               post_fatigue_score: 9, completion_ratio: 0.1 },
      { date: new Date(now - 86400000).toISOString(),    post_fatigue_score: 2, completion_ratio: 0.9 },
    ]);
    const reversed = calculateFatigueScore([
      { date: new Date(now - 86400000).toISOString(),    post_fatigue_score: 2, completion_ratio: 0.9 },
      { date: new Date(now).toISOString(),               post_fatigue_score: 9, completion_ratio: 0.1 },
    ]);
    expect(inOrder).toBeCloseTo(reversed, 5);
  });

  it('low readiness amplifies the score', () => {
    const withLowReadiness = calculateFatigueScore([
      { date: new Date().toISOString(), completion_ratio: 0.6, post_fatigue_score: 5, pre_readiness_score: 1 },
    ]);
    const withHighReadiness = calculateFatigueScore([
      { date: new Date().toISOString(), completion_ratio: 0.6, post_fatigue_score: 5, pre_readiness_score: 9 },
    ]);
    expect(withLowReadiness).toBeGreaterThan(withHighReadiness);
  });

  it('returns a value with at most one decimal place', () => {
    const score = calculateFatigueScore([
      { date: new Date().toISOString(), completion_ratio: 0.73 },
    ]);
    const decimals = score.toString().split('.')[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(1);
  });

  it('caps at 10 even with extreme inputs', () => {
    const records = Array.from({ length: 15 }, (_, i) => ({
      date: new Date(Date.now() - i * 86400000).toISOString(),
      completion_ratio: 0,
      post_fatigue_score: 10,
    }));
    expect(calculateFatigueScore(records)).toBeLessThanOrEqual(10);
  });
});

// ─── classifyFatigue ──────────────────────────────────────────────────────────

describe('classifyFatigue', () => {
  it('0–3 → fresh', () => {
    expect(classifyFatigue(0)).toBe('fresh');
    expect(classifyFatigue(2.5)).toBe('fresh');
    expect(classifyFatigue(3)).toBe('fresh');
  });

  it('3–5.5 → moderate', () => {
    expect(classifyFatigue(3.1)).toBe('moderate');
    expect(classifyFatigue(5)).toBe('moderate');
    expect(classifyFatigue(5.5)).toBe('moderate');
  });

  it('5.5–8 → fatigued', () => {
    expect(classifyFatigue(5.6)).toBe('fatigued');
    expect(classifyFatigue(7)).toBe('fatigued');
    expect(classifyFatigue(8)).toBe('fatigued');
  });

  it('8+–10 → exhausted', () => {
    expect(classifyFatigue(8.1)).toBe('exhausted');
    expect(classifyFatigue(10)).toBe('exhausted');
  });
});

// ─── fatigueModFactor ─────────────────────────────────────────────────────────

describe('fatigueModFactor', () => {
  it('returns 1.00 at score 0', () => {
    expect(fatigueModFactor(0)).toBe(1.0);
  });

  it('returns 0.70 at score 10', () => {
    expect(fatigueModFactor(10)).toBe(0.70);
  });

  it('is strictly decreasing', () => {
    expect(fatigueModFactor(3)).toBeGreaterThan(fatigueModFactor(7));
  });

  it('clamps below 0 → 1.0', () => {
    expect(fatigueModFactor(-5)).toBe(1.0);
  });

  it('clamps above 10 → 0.70', () => {
    expect(fatigueModFactor(20)).toBe(0.70);
  });
});

// ─── recommendedRestHours ─────────────────────────────────────────────────────

describe('recommendedRestHours', () => {
  it('fresh (≤3) → 12h', () => {
    expect(recommendedRestHours(2)).toBe(12);
  });

  it('moderate (4–5) → 24h', () => {
    expect(recommendedRestHours(4.5)).toBe(24);
  });

  it('fatigued (6–7) → 36h', () => {
    expect(recommendedRestHours(7)).toBe(36);
  });

  it('very fatigued (8–8.5) → 48h', () => {
    expect(recommendedRestHours(8.2)).toBe(48);
  });

  it('exhausted (>8.5) → 72h', () => {
    expect(recommendedRestHours(9)).toBe(72);
  });
});
