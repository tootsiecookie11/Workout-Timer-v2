import { describe, it, expect } from 'vitest';
import { parseDSL, evaluateDSL, checkCondition } from '../dslParser';
import type { EvalContext } from '../dslTypes';

const BASE_CTX: EvalContext = {
  reps:  10,
  time:  25000,  // 25s in ms
  round: 2,
  set:   1,
  user:  null,
};

// ─── Parser ───────────────────────────────────────────────────────────────────

describe('parseDSL — structure', () => {
  it('parses "always" keyword', () => {
    expect(parseDSL('always')).toEqual({ kind: 'always' });
  });

  it('parses simple >= comparison', () => {
    expect(parseDSL('reps >= 8')).toEqual({
      kind: 'cmp',
      op: '>=',
      left:  { kind: 'var', name: 'reps' },
      right: { kind: 'num', value: 8 },
    });
  });

  it('parses duration literal (30s → 30000ms)', () => {
    expect(parseDSL('time < 30s')).toEqual({
      kind: 'cmp',
      op: '<',
      left:  { kind: 'var', name: 'time' },
      right: { kind: 'duration_ms', ms: 30000 },
    });
  });

  it('parses modulo operand (round % 2)', () => {
    expect(parseDSL('round % 2 == 0')).toEqual({
      kind: 'cmp',
      op: '==',
      left:  { kind: 'mod', name: 'round', divisor: 2 },
      right: { kind: 'num', value: 0 },
    });
  });

  it('parses string comparison (user == "yes")', () => {
    expect(parseDSL('user == "yes"')).toEqual({
      kind: 'cmp',
      op: '==',
      left:  { kind: 'var', name: 'user' },
      right: { kind: 'str', value: 'yes' },
    });
  });

  it('parses AND expression', () => {
    const ast = parseDSL('reps >= 8 && round == 2');
    expect(ast.kind).toBe('and');
  });

  it('parses OR expression', () => {
    const ast = parseDSL('reps >= 10 || round == 3');
    expect(ast.kind).toBe('or');
  });

  it('parses NOT expression', () => {
    expect(parseDSL('!always')).toEqual({ kind: 'not', expr: { kind: 'always' } });
  });

  it('parses parenthesised compound expression', () => {
    const ast = parseDSL('(reps >= 8 && round == 1) || user == "skip"');
    expect(ast.kind).toBe('or');
  });

  it('throws SyntaxError on unknown operator', () => {
    expect(() => parseDSL('reps @@ 5')).toThrow(SyntaxError);
  });

  it('throws SyntaxError on unterminated string', () => {
    expect(() => parseDSL('user == "oops')).toThrow(SyntaxError);
  });
});

// ─── Evaluator ────────────────────────────────────────────────────────────────

describe('evaluateDSL — boolean outcomes', () => {
  it('"always" always returns true', () => {
    expect(evaluateDSL({ kind: 'always' }, BASE_CTX)).toBe(true);
  });

  it('reps >= 8 → true (reps=10)', () => {
    expect(checkCondition('reps >= 8', BASE_CTX)).toBe(true);
  });

  it('reps >= 12 → false (reps=10)', () => {
    expect(checkCondition('reps >= 12', BASE_CTX)).toBe(false);
  });

  it('time < 30s → true (time=25000)', () => {
    expect(checkCondition('time < 30s', BASE_CTX)).toBe(true);
  });

  it('time < 20s → false (time=25000)', () => {
    expect(checkCondition('time < 20s', BASE_CTX)).toBe(false);
  });

  it('round % 2 == 0 → true (round=2)', () => {
    expect(checkCondition('round % 2 == 0', BASE_CTX)).toBe(true);
  });

  it('round % 2 == 0 → false (round=1)', () => {
    expect(checkCondition('round % 2 == 0', { ...BASE_CTX, round: 1 })).toBe(false);
  });

  it('user == "yes" → false (user=null)', () => {
    expect(checkCondition('user == "yes"', BASE_CTX)).toBe(false);
  });

  it('user == "yes" → true (user="yes")', () => {
    expect(checkCondition('user == "yes"', { ...BASE_CTX, user: 'yes' })).toBe(true);
  });

  it('AND → true only when both sides are true', () => {
    expect(checkCondition('reps >= 8 && time < 30s', BASE_CTX)).toBe(true);
    expect(checkCondition('reps >= 8 && time < 10s', BASE_CTX)).toBe(false);
  });

  it('OR → true when at least one side is true', () => {
    expect(checkCondition('reps >= 20 || time < 30s', BASE_CTX)).toBe(true);
    expect(checkCondition('reps >= 20 || time < 5s',  BASE_CTX)).toBe(false);
  });

  it('NOT inverts the result', () => {
    expect(checkCondition('!always', BASE_CTX)).toBe(false);
  });

  it('!= operator', () => {
    expect(checkCondition('round != 3', BASE_CTX)).toBe(true);   // round=2
    expect(checkCondition('round != 2', BASE_CTX)).toBe(false);
  });

  it('== for numbers', () => {
    expect(checkCondition('round == 2', BASE_CTX)).toBe(true);
    expect(checkCondition('round == 3', BASE_CTX)).toBe(false);
  });

  it('complex nested: (reps >= 8 && round == 2) || user == "skip"', () => {
    // Both sides true → true
    expect(checkCondition('(reps >= 8 && round == 2) || user == "skip"', BASE_CTX)).toBe(true);
    // Left side false, right side false → false
    const ctx2 = { ...BASE_CTX, reps: 5, user: null };
    expect(checkCondition('(reps >= 8 && round == 2) || user == "skip"', ctx2)).toBe(false);
    // Left side false, right side true → true
    expect(checkCondition('(reps >= 8 && round == 2) || user == "skip"', { ...ctx2, user: 'skip' })).toBe(true);
  });

  it('throws ReferenceError for unknown variable', () => {
    const ast = parseDSL('unknown >= 5');
    expect(() => evaluateDSL(ast, BASE_CTX)).toThrow(ReferenceError);
  });
});
