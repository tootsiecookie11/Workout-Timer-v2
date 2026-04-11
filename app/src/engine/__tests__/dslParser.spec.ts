import { describe, it, expect, beforeEach } from 'vitest';
import { parseDSL, evaluateDSL, checkCondition, clearDSLCache, DSLError } from '../dslParser';
import type { EvalContext } from '../dslTypes';

const BASE_CTX: EvalContext = {
  reps:  10,
  time:  25000,  // 25 s in ms
  round: 2,
  set:   1,
  user:  null,
};

// ─── Parser — Structure ───────────────────────────────────────────────────────

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

// ─── Parser — New Features ────────────────────────────────────────────────────

describe('parseDSL — in operator', () => {
  it('parses "user in [...]" with multiple string items', () => {
    const ast = parseDSL('user in ["yes", "no", "skip"]');
    expect(ast).toEqual({
      kind: 'in',
      operand: { kind: 'var', name: 'user' },
      items: [
        { kind: 'str', value: 'yes' },
        { kind: 'str', value: 'no' },
        { kind: 'str', value: 'skip' },
      ],
    });
  });

  it('parses "round in [...]" with number items', () => {
    const ast = parseDSL('round in [1, 3, 5]');
    expect(ast).toEqual({
      kind: 'in',
      operand: { kind: 'var', name: 'round' },
      items: [
        { kind: 'num', value: 1 },
        { kind: 'num', value: 3 },
        { kind: 'num', value: 5 },
      ],
    });
  });

  it('parses "in" with an empty list', () => {
    const ast = parseDSL('user in []');
    expect(ast).toEqual({ kind: 'in', operand: { kind: 'var', name: 'user' }, items: [] });
  });

  it('"in" with a single item', () => {
    const ast = parseDSL('user in ["yes"]');
    expect(ast.kind).toBe('in');
    if (ast.kind === 'in') expect(ast.items).toHaveLength(1);
  });
});

describe('parseDSL — boolean and null literals', () => {
  it('parses "true" literal', () => {
    expect(parseDSL('active == true')).toEqual({
      kind: 'cmp',
      op: '==',
      left:  { kind: 'var', name: 'active' },
      right: { kind: 'bool', value: true },
    });
  });

  it('parses "false" literal', () => {
    expect(parseDSL('active == false')).toEqual({
      kind: 'cmp',
      op: '==',
      left:  { kind: 'var', name: 'active' },
      right: { kind: 'bool', value: false },
    });
  });

  it('parses "null" literal', () => {
    expect(parseDSL('user == null')).toEqual({
      kind: 'cmp',
      op: '==',
      left:  { kind: 'var', name: 'user' },
      right: { kind: 'null' },
    });
  });
});

describe('parseDSL — float numbers', () => {
  it('parses a float number operand', () => {
    expect(parseDSL('reps >= 7.5')).toEqual({
      kind: 'cmp',
      op: '>=',
      left:  { kind: 'var', name: 'reps' },
      right: { kind: 'num', value: 7.5 },
    });
  });
});

describe('parseDSL — duration variants', () => {
  it('parses duration in minutes (2m → 120000ms)', () => {
    expect(parseDSL('time < 2m')).toEqual({
      kind: 'cmp',
      op: '<',
      left:  { kind: 'var', name: 'time' },
      right: { kind: 'duration_ms', ms: 120_000 },
    });
  });

  it('parses duration in hours (1h → 3600000ms)', () => {
    expect(parseDSL('elapsed_ms < 1h')).toEqual({
      kind: 'cmp',
      op: '<',
      left:  { kind: 'var', name: 'elapsed_ms' },
      right: { kind: 'duration_ms', ms: 3_600_000 },
    });
  });

  it('parses float duration (1.5m → 90000ms)', () => {
    const ast = parseDSL('time < 1.5m');
    expect(ast).toEqual({
      kind: 'cmp',
      op: '<',
      left:  { kind: 'var', name: 'time' },
      right: { kind: 'duration_ms', ms: 90_000 },
    });
  });
});

describe('parseDSL — string quoting and escapes', () => {
  it('parses single-quoted string', () => {
    expect(parseDSL("user == 'yes'")).toEqual({
      kind: 'cmp',
      op: '==',
      left:  { kind: 'var', name: 'user' },
      right: { kind: 'str', value: 'yes' },
    });
  });

  it('handles escape sequences in double-quoted string', () => {
    const ast = parseDSL('user == "it\\"s ok"');
    expect(ast).toEqual({
      kind: 'cmp',
      op: '==',
      left:  { kind: 'var', name: 'user' },
      right: { kind: 'str', value: 'it"s ok' },
    });
  });
});

// ─── DSLError ─────────────────────────────────────────────────────────────────

describe('DSLError', () => {
  it('is an instance of SyntaxError', () => {
    let err: unknown;
    try { parseDSL('reps @@ 5'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(SyntaxError);
    expect(err).toBeInstanceOf(DSLError);
  });

  it('pretty() includes caret pointing at error location', () => {
    let err: DSLError | undefined;
    try { parseDSL('@bad'); } catch (e) { if (e instanceof DSLError) err = e; }
    expect(err).toBeDefined();
    const pretty = err!.pretty();
    expect(pretty).toContain('DSL Error:');
    expect(pretty).toContain('@bad');
    expect(pretty).toContain('^');
  });

  it('exposes span with start/end positions', () => {
    let err: DSLError | undefined;
    try { parseDSL('reps @@ 5'); } catch (e) { if (e instanceof DSLError) err = e; }
    expect(err?.span).toBeDefined();
    expect(typeof err?.span.start).toBe('number');
    expect(typeof err?.span.end).toBe('number');
  });

  it('throws DSLError for unterminated single-quoted string', () => {
    expect(() => parseDSL("user == 'oops")).toThrow(DSLError);
  });

  it('throws DSLError with meaningful message for bad comparison', () => {
    let err: DSLError | undefined;
    try { parseDSL('reps always 5'); } catch (e) { if (e instanceof DSLError) err = e; }
    expect(err).toBeDefined();
    expect(err!.message).toMatch(/comparison operator/i);
  });
});

// ─── AST Cache ────────────────────────────────────────────────────────────────

describe('parseDSL — AST cache', () => {
  beforeEach(() => clearDSLCache());

  it('returns the same AST object for identical input strings', () => {
    const a = parseDSL('reps >= 8');
    const b = parseDSL('reps >= 8');
    expect(a).toBe(b); // referential equality — same object
  });

  it('returns different AST objects for different inputs', () => {
    const a = parseDSL('reps >= 8');
    const b = parseDSL('reps >= 9');
    expect(a).not.toBe(b);
  });

  it('trims whitespace before caching — leading/trailing spaces share the same AST', () => {
    const a = parseDSL('always');
    const b = parseDSL('  always  ');
    expect(a).toBe(b);
  });
});

// ─── Evaluator — Existing Tests ───────────────────────────────────────────────

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
    expect(checkCondition('(reps >= 8 && round == 2) || user == "skip"', BASE_CTX)).toBe(true);
    const ctx2 = { ...BASE_CTX, reps: 5, user: null };
    expect(checkCondition('(reps >= 8 && round == 2) || user == "skip"', ctx2)).toBe(false);
    expect(checkCondition('(reps >= 8 && round == 2) || user == "skip"', { ...ctx2, user: 'skip' })).toBe(true);
  });

  it('throws ReferenceError for unknown variable', () => {
    const ast = parseDSL('unknown >= 5');
    expect(() => evaluateDSL(ast, BASE_CTX)).toThrow(ReferenceError);
  });
});

// ─── Evaluator — New Features ─────────────────────────────────────────────────

describe('evaluateDSL — in operator', () => {
  it('user in list → true when user matches', () => {
    expect(checkCondition('user in ["yes", "no", "skip"]', { ...BASE_CTX, user: 'no' })).toBe(true);
  });

  it('user in list → false when user not in list', () => {
    expect(checkCondition('user in ["yes", "no"]', { ...BASE_CTX, user: 'maybe' })).toBe(false);
  });

  it('user in list → false when user is null and list has no null', () => {
    expect(checkCondition('user in ["yes", "no"]', BASE_CTX)).toBe(false);
  });

  it('round in list → true', () => {
    expect(checkCondition('round in [1, 2, 3]', BASE_CTX)).toBe(true);   // round=2
  });

  it('round in list → false', () => {
    expect(checkCondition('round in [1, 3, 5]', BASE_CTX)).toBe(false);  // round=2
  });

  it('empty list always returns false', () => {
    expect(checkCondition('user in []', { ...BASE_CTX, user: 'yes' })).toBe(false);
  });

  it('"in" can be composed with && and ||', () => {
    const cond = 'round in [1, 2] && user in ["yes", "go"]';
    expect(checkCondition(cond, { ...BASE_CTX, round: 2, user: 'yes' })).toBe(true);
    expect(checkCondition(cond, { ...BASE_CTX, round: 3, user: 'yes' })).toBe(false);
  });
});

describe('evaluateDSL — boolean and null literals', () => {
  it('user == null → true when user is null', () => {
    expect(checkCondition('user == null', BASE_CTX)).toBe(true);
  });

  it('user == null → false when user is set', () => {
    expect(checkCondition('user == null', { ...BASE_CTX, user: 'yes' })).toBe(false);
  });

  it('user != null → true when user is set', () => {
    expect(checkCondition('user != null', { ...BASE_CTX, user: 'yes' })).toBe(true);
  });

  it('evaluates "true" literal as operand', () => {
    // true == true → always true
    expect(evaluateDSL(
      { kind: 'cmp', op: '==', left: { kind: 'bool', value: true }, right: { kind: 'bool', value: true } },
      BASE_CTX,
    )).toBe(true);
  });

  it('evaluates "false" literal as operand', () => {
    expect(evaluateDSL(
      { kind: 'cmp', op: '==', left: { kind: 'bool', value: false }, right: { kind: 'bool', value: true } },
      BASE_CTX,
    )).toBe(false);
  });
});

describe('evaluateDSL — float numbers', () => {
  it('reps >= 7.5 → true (reps=10)', () => {
    expect(checkCondition('reps >= 7.5', BASE_CTX)).toBe(true);
  });

  it('reps <= 9.9 → false (reps=10)', () => {
    expect(checkCondition('reps <= 9.9', BASE_CTX)).toBe(false);
  });
});

describe('evaluateDSL — duration variants', () => {
  it('time < 2m → true (time=25000, 25s < 2min)', () => {
    expect(checkCondition('time < 2m', BASE_CTX)).toBe(true);
  });

  it('elapsed_ms < 1h → true when elapsed is small', () => {
    expect(checkCondition('elapsed_ms < 1h', { ...BASE_CTX, elapsed_ms: 60_000 })).toBe(true);
  });

  it('time < 1.5m → true (time=25000, 25s < 1.5min=90s)', () => {
    expect(checkCondition('time < 1.5m', BASE_CTX)).toBe(true);
  });

  it('time < 0.4m → false (time=25000, 25s > 0.4min=24s)', () => {
    expect(checkCondition('time < 0.4m', BASE_CTX)).toBe(false);
  });
});

describe('evaluateDSL — single-quoted strings', () => {
  it("user == 'yes' → true when user is 'yes'", () => {
    expect(checkCondition("user == 'yes'", { ...BASE_CTX, user: 'yes' })).toBe(true);
  });
});
