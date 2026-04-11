/**
 * DSL Parser + Evaluator for Galawgaw conditional workout blocks (PRD §5.9).
 *
 * Grammar:
 *   expr       = or_expr
 *   or_expr    = and_expr ('||' and_expr)*
 *   and_expr   = unary ('&&' unary)*
 *   unary      = '!' unary | primary
 *   primary    = '(' expr ')' | 'always' | operand ('in' '[' items ']' | cmp_op operand)
 *   items      = operand (',' operand)*
 *   operand    = ident ('%' number)? | number | float | duration | string | 'true' | 'false' | 'null'
 *   cmp_op     = '>=' | '<=' | '>' | '<' | '==' | '!='
 *   duration   = number ('s' | 'm' | 'h')  -- converted to milliseconds
 *                30s → 30000 | 2m → 120000 | 1h → 3600000
 *
 * Supported variables: reps, time, round, set, user, elapsed_ms, remaining_ms, lap
 */

import type { ASTNode, Operand, CompareOp, EvalContext } from './dslTypes';
import type { Span } from './dslTypes';

// ─── DSLError ─────────────────────────────────────────────────────────────────

/**
 * Thrown by parseDSL on malformed input. Extends SyntaxError so existing
 * `toThrow(SyntaxError)` assertions continue to pass.
 *
 * @example
 * try { parseDSL('reps @@ 5') }
 * catch (e) {
 *   if (e instanceof DSLError) console.log(e.pretty());
 * }
 */
export class DSLError extends SyntaxError {
  readonly span: Span;
  readonly source: string;

  constructor(message: string, source: string, span: Span) {
    super(message);
    this.name = 'DSLError';
    this.source = source;
    this.span = span;
  }

  /**
   * Returns a multi-line string with the source excerpt and a caret
   * pointing at the error location — ready to print to a console or UI.
   *
   * @example
   * DSL Error: Unexpected character '@'
   *   reps @@ 5
   *       ^
   */
  pretty(): string {
    const excerpt = '  ' + this.source;
    const caretLen = Math.max(1, this.span.end - this.span.start);
    const caret = '  ' + ' '.repeat(this.span.start) + '^'.repeat(caretLen);
    return `DSL Error: ${this.message}\n${excerpt}\n${caret}`;
  }
}

// ─── Token Types ──────────────────────────────────────────────────────────────

type TokenType =
  | 'IDENT' | 'NUMBER' | 'FLOAT' | 'STRING' | 'DURATION'
  | 'GTE' | 'LTE' | 'GT' | 'LT' | 'EQ' | 'NEQ'
  | 'AND' | 'OR' | 'NOT' | 'MOD'
  | 'LPAREN' | 'RPAREN'
  | 'LBRACKET' | 'RBRACKET' | 'COMMA'
  | 'ALWAYS' | 'IN' | 'TRUE' | 'FALSE' | 'NULL'
  | 'EOF';

interface Token {
  type: TokenType;
  value: string;
  span: Span;
}

// ─── Tokenizer ────────────────────────────────────────────────────────────────

const KEYWORDS: Record<string, TokenType> = {
  always: 'ALWAYS',
  in:     'IN',
  true:   'TRUE',
  false:  'FALSE',
  null:   'NULL',
};

const DURATION_SUFFIXES = new Set(['s', 'm', 'h']);

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  function tok(type: TokenType, value: string, start: number): Token {
    return { type, value, span: { start, end: i } };
  }

  while (i < src.length) {
    // Skip whitespace
    if (/\s/.test(src[i])) { i++; continue; }

    const start = i;

    // Two-char operators (must check before single-char)
    const two = src.slice(i, i + 2);
    if (two === '>=') { i += 2; tokens.push(tok('GTE', '>=', start)); continue; }
    if (two === '<=') { i += 2; tokens.push(tok('LTE', '<=', start)); continue; }
    if (two === '==') { i += 2; tokens.push(tok('EQ',  '==', start)); continue; }
    if (two === '!=') { i += 2; tokens.push(tok('NEQ', '!=', start)); continue; }
    if (two === '&&') { i += 2; tokens.push(tok('AND', '&&', start)); continue; }
    if (two === '||') { i += 2; tokens.push(tok('OR',  '||', start)); continue; }

    const ch = src[i];

    // Single-char operators and punctuation
    switch (ch) {
      case '>': tokens.push(tok('GT',       '>',  start)); i++; continue;
      case '<': tokens.push(tok('LT',       '<',  start)); i++; continue;
      case '!': tokens.push(tok('NOT',      '!',  start)); i++; continue;
      case '%': tokens.push(tok('MOD',      '%',  start)); i++; continue;
      case '(': tokens.push(tok('LPAREN',   '(',  start)); i++; continue;
      case ')': tokens.push(tok('RPAREN',   ')',  start)); i++; continue;
      case '[': tokens.push(tok('LBRACKET', '[',  start)); i++; continue;
      case ']': tokens.push(tok('RBRACKET', ']',  start)); i++; continue;
      case ',': tokens.push(tok('COMMA',    ',',  start)); i++; continue;
    }

    // ── Number, float, or duration ───────────────────────────────────────────
    if (/[0-9]/.test(ch)) {
      let num = '';
      while (i < src.length && /[0-9]/.test(src[i])) num += src[i++];

      // Decimal part: 3.14
      let isFloat = false;
      if (src[i] === '.' && /[0-9]/.test(src[i + 1] ?? '')) {
        num += src[i++]; // '.'
        while (i < src.length && /[0-9]/.test(src[i])) num += src[i++];
        isFloat = true;
      }

      // Duration suffix (works for integers and floats: 30s, 1.5m, 2h)
      if (DURATION_SUFFIXES.has(src[i])) {
        num += src[i++];
        tokens.push({ type: 'DURATION', value: num, span: { start, end: i } });
        continue;
      }

      tokens.push(tok(isFloat ? 'FLOAT' : 'NUMBER', num, start));
      continue;
    }

    // ── String literal — double-quoted ───────────────────────────────────────
    if (ch === '"') {
      let str = '';
      i++; // skip opening "
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length) {
          const esc = src[++i];
          switch (esc) {
            case 'n': str += '\n'; break;
            case 't': str += '\t'; break;
            case '"': str += '"';  break;
            case '\\': str += '\\'; break;
            default: str += esc;
          }
          i++;
        } else {
          str += src[i++];
        }
      }
      if (i >= src.length) {
        throw new DSLError('Unterminated string literal', src, { start, end: i });
      }
      i++; // skip closing "
      tokens.push({ type: 'STRING', value: str, span: { start, end: i } });
      continue;
    }

    // ── String literal — single-quoted ───────────────────────────────────────
    if (ch === "'") {
      let str = '';
      i++; // skip opening '
      while (i < src.length && src[i] !== "'") {
        if (src[i] === '\\' && i + 1 < src.length) {
          const esc = src[++i];
          switch (esc) {
            case 'n': str += '\n'; break;
            case 't': str += '\t'; break;
            case "'": str += "'";  break;
            case '\\': str += '\\'; break;
            default: str += esc;
          }
          i++;
        } else {
          str += src[i++];
        }
      }
      if (i >= src.length) {
        throw new DSLError('Unterminated string literal', src, { start, end: i });
      }
      i++; // skip closing '
      tokens.push({ type: 'STRING', value: str, span: { start, end: i } });
      continue;
    }

    // ── Identifier or keyword ────────────────────────────────────────────────
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = '';
      while (i < src.length && /[a-zA-Z0-9_]/.test(src[i])) ident += src[i++];
      const type = KEYWORDS[ident] ?? 'IDENT';
      tokens.push(tok(type, ident, start));
      continue;
    }

    throw new DSLError(
      `Unexpected character '${ch}'`,
      src,
      { start, end: start + 1 },
    );
  }

  tokens.push({ type: 'EOF', value: '', span: { start: src.length, end: src.length } });
  return tokens;
}

// ─── Recursive Descent Parser ─────────────────────────────────────────────────

class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly source: string,
  ) {}

  private peek(): Token { return this.tokens[this.pos]; }

  private consume(): Token { return this.tokens[this.pos++]; }

  private expect(type: TokenType): Token {
    const tok = this.consume();
    if (tok.type !== type) {
      throw new DSLError(
        `Expected '${type}' but got '${tok.type}' ("${tok.value}")`,
        this.source,
        tok.span,
      );
    }
    return tok;
  }

  parse(): ASTNode {
    const node = this.parseOr();
    this.expect('EOF');
    return node;
  }

  private parseOr(): ASTNode {
    let left = this.parseAnd();
    while (this.peek().type === 'OR') {
      this.consume();
      left = { kind: 'or', left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): ASTNode {
    let left = this.parseUnary();
    while (this.peek().type === 'AND') {
      this.consume();
      left = { kind: 'and', left, right: this.parseUnary() };
    }
    return left;
  }

  private parseUnary(): ASTNode {
    if (this.peek().type === 'NOT') {
      this.consume();
      return { kind: 'not', expr: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ASTNode {
    if (this.peek().type === 'LPAREN') {
      this.consume();
      const expr = this.parseOr();
      this.expect('RPAREN');
      return expr;
    }

    if (this.peek().type === 'ALWAYS') {
      this.consume();
      return { kind: 'always' };
    }

    const left = this.parseOperand();

    // Set-membership: operand in [item, item, ...]
    if (this.peek().type === 'IN') {
      this.consume();
      this.expect('LBRACKET');
      const items: Operand[] = [];
      if (this.peek().type !== 'RBRACKET') {
        items.push(this.parseOperand());
        while (this.peek().type === 'COMMA') {
          this.consume();
          items.push(this.parseOperand());
        }
      }
      this.expect('RBRACKET');
      return { kind: 'in', operand: left, items };
    }

    // Comparison: operand cmp_op operand
    const op    = this.parseCmpOp();
    const right = this.parseOperand();
    return { kind: 'cmp', op, left, right };
  }

  private parseCmpOp(): CompareOp {
    const tok = this.consume();
    switch (tok.type) {
      case 'GTE': return '>=';
      case 'LTE': return '<=';
      case 'GT':  return '>';
      case 'LT':  return '<';
      case 'EQ':  return '==';
      case 'NEQ': return '!=';
      default:
        throw new DSLError(
          `Expected comparison operator, got '${tok.type}' ("${tok.value}")`,
          this.source,
          tok.span,
        );
    }
  }

  private parseOperand(): Operand {
    const tok = this.peek();

    if (tok.type === 'TRUE')  { this.consume(); return { kind: 'bool', value: true }; }
    if (tok.type === 'FALSE') { this.consume(); return { kind: 'bool', value: false }; }
    if (tok.type === 'NULL')  { this.consume(); return { kind: 'null' }; }

    if (tok.type === 'NUMBER') {
      this.consume();
      return { kind: 'num', value: parseInt(tok.value, 10) };
    }

    if (tok.type === 'FLOAT') {
      this.consume();
      return { kind: 'num', value: parseFloat(tok.value) };
    }

    if (tok.type === 'DURATION') {
      this.consume();
      const raw    = tok.value;                        // e.g. "30s", "2m", "1h", "1.5m"
      const suffix = raw[raw.length - 1] as 's' | 'm' | 'h';
      const n      = parseFloat(raw.slice(0, -1));
      const ms     = suffix === 'h' ? n * 3_600_000
                   : suffix === 'm' ? n * 60_000
                   :                  n * 1_000;
      return { kind: 'duration_ms', ms };
    }

    if (tok.type === 'STRING') {
      this.consume();
      return { kind: 'str', value: tok.value };
    }

    if (tok.type === 'IDENT') {
      this.consume();
      // Modulo operand: varname % divisor
      if (this.peek().type === 'MOD') {
        this.consume();
        const numTok = this.expect('NUMBER');
        return { kind: 'mod', name: tok.value, divisor: parseInt(numTok.value, 10) };
      }
      return { kind: 'var', name: tok.value };
    }

    throw new DSLError(
      `Expected operand, got '${tok.type}' ("${tok.value}")`,
      this.source,
      tok.span,
    );
  }
}

// ─── Evaluator ────────────────────────────────────────────────────────────────

type ScalarValue = number | string | boolean | null;

function resolveOperand(op: Operand, ctx: EvalContext): ScalarValue {
  switch (op.kind) {
    case 'num':         return op.value;
    case 'str':         return op.value;
    case 'bool':        return op.value;
    case 'null':        return null;
    case 'duration_ms': return op.ms;
    case 'var': {
      const val = (ctx as Record<string, unknown>)[op.name];
      if (val === undefined) {
        throw new ReferenceError(`Unknown DSL variable '${op.name}'`);
      }
      return val as ScalarValue;
    }
    case 'mod': {
      const val = (ctx as Record<string, unknown>)[op.name];
      if (typeof val !== 'number') {
        throw new TypeError(`Variable '${op.name}' must be a number for modulo`);
      }
      return val % op.divisor;
    }
  }
}

function applyOp(left: ScalarValue, op: CompareOp, right: ScalarValue): boolean {
  switch (op) {
    case '==': return left === right;
    case '!=': return left !== right;
    case '>=': return (left as number) >= (right as number);
    case '<=': return (left as number) <= (right as number);
    case '>':  return (left as number) >  (right as number);
    case '<':  return (left as number) <  (right as number);
  }
}

export function evaluateDSL(ast: ASTNode, ctx: EvalContext): boolean {
  switch (ast.kind) {
    case 'always': return true;
    case 'not':    return !evaluateDSL(ast.expr, ctx);
    case 'and':    return evaluateDSL(ast.left, ctx) && evaluateDSL(ast.right, ctx);
    case 'or':     return evaluateDSL(ast.left, ctx) || evaluateDSL(ast.right, ctx);
    case 'cmp':    return applyOp(resolveOperand(ast.left, ctx), ast.op, resolveOperand(ast.right, ctx));
    case 'in': {
      const val = resolveOperand(ast.operand, ctx);
      return ast.items.some(item => resolveOperand(item, ctx) === val);
    }
  }
}

// ─── AST Cache ────────────────────────────────────────────────────────────────

/** Map preserves insertion order — oldest entries are evicted first. */
const _astCache = new Map<string, ASTNode>();
const AST_CACHE_MAX = 256;

/** Clear the internal parse cache. Primarily useful in tests. */
export function clearDSLCache(): void {
  _astCache.clear();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a DSL condition string into an AST.
 *
 * Results are memoized — repeated calls with the same input return the cached
 * AST object. For hot paths that repeatedly evaluate the same condition, cache
 * the AST here and call evaluateDSL() directly to skip re-parsing.
 *
 * Throws DSLError (a subclass of SyntaxError) on malformed input.
 */
export function parseDSL(input: string): ASTNode {
  const key = input.trim();

  const cached = _astCache.get(key);
  if (cached) return cached;

  const ast = new Parser(tokenize(key), key).parse();

  if (_astCache.size >= AST_CACHE_MAX) {
    // Evict oldest (Map insertion-order guarantees this is the first key)
    const oldest = _astCache.keys().next().value;
    if (oldest !== undefined) _astCache.delete(oldest);
  }

  _astCache.set(key, ast);
  return ast;
}

/**
 * Parse and evaluate a DSL condition string in one call.
 *
 * For hot paths (e.g. repeated evaluation of the same edge condition on every
 * tick), prefer caching with parseDSL() + evaluateDSL() directly.
 */
export function checkCondition(condition: string, ctx: EvalContext): boolean {
  return evaluateDSL(parseDSL(condition), ctx);
}
