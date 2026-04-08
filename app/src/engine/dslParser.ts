/**
 * DSL Parser + Evaluator for Galawgaw conditional workout blocks (PRD §5.9).
 *
 * Grammar:
 *   expr       = or_expr
 *   or_expr    = and_expr ('||' and_expr)*
 *   and_expr   = unary ('&&' unary)*
 *   unary      = '!' unary | primary
 *   primary    = '(' expr ')' | 'always' | operand cmp_op operand
 *   operand    = ident ('%' number)? | number | duration | string
 *   cmp_op     = '>=' | '<=' | '>' | '<' | '==' | '!='
 *   duration   = number 's'   -- converted to milliseconds
 *
 * Supported variables: reps, time, round, set, user
 * Duration literals: 30s → 30000ms
 */

import type { ASTNode, Operand, CompareOp, EvalContext } from './dslTypes';

// ─── Tokenizer ────────────────────────────────────────────────────────────────

type TokenType =
  | 'IDENT' | 'NUMBER' | 'STRING' | 'DURATION'
  | 'GTE' | 'LTE' | 'GT' | 'LT' | 'EQ' | 'NEQ'
  | 'AND' | 'OR' | 'NOT' | 'MOD'
  | 'LPAREN' | 'RPAREN'
  | 'ALWAYS' | 'EOF';

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const src = input.trim();
  let i = 0;

  while (i < src.length) {
    if (/\s/.test(src[i])) { i++; continue; }

    // Two-char operators (must check before single-char)
    const two = src.slice(i, i + 2);
    if (two === '>=') { tokens.push({ type: 'GTE', value: '>=', pos: i }); i += 2; continue; }
    if (two === '<=') { tokens.push({ type: 'LTE', value: '<=', pos: i }); i += 2; continue; }
    if (two === '==') { tokens.push({ type: 'EQ',  value: '==', pos: i }); i += 2; continue; }
    if (two === '!=') { tokens.push({ type: 'NEQ', value: '!=', pos: i }); i += 2; continue; }
    if (two === '&&') { tokens.push({ type: 'AND', value: '&&', pos: i }); i += 2; continue; }
    if (two === '||') { tokens.push({ type: 'OR',  value: '||', pos: i }); i += 2; continue; }

    // Single-char operators
    const ch = src[i];
    if (ch === '>') { tokens.push({ type: 'GT',     value: '>',  pos: i }); i++; continue; }
    if (ch === '<') { tokens.push({ type: 'LT',     value: '<',  pos: i }); i++; continue; }
    if (ch === '!') { tokens.push({ type: 'NOT',    value: '!',  pos: i }); i++; continue; }
    if (ch === '%') { tokens.push({ type: 'MOD',    value: '%',  pos: i }); i++; continue; }
    if (ch === '(') { tokens.push({ type: 'LPAREN', value: '(', pos: i }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'RPAREN', value: ')', pos: i }); i++; continue; }

    // Number or duration (e.g. 30s)
    if (/[0-9]/.test(ch)) {
      let num = '';
      const pos = i;
      while (i < src.length && /[0-9]/.test(src[i])) { num += src[i++]; }
      if (src[i] === 's') {
        tokens.push({ type: 'DURATION', value: num, pos });
        i++;
      } else {
        tokens.push({ type: 'NUMBER', value: num, pos });
      }
      continue;
    }

    // String literal
    if (ch === '"') {
      let str = '';
      const pos = i++;
      while (i < src.length && src[i] !== '"') { str += src[i++]; }
      if (src[i] !== '"') throw new SyntaxError(`Unterminated string at pos ${pos}`);
      i++; // consume closing "
      tokens.push({ type: 'STRING', value: str, pos });
      continue;
    }

    // Identifier or 'always' keyword
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = '';
      const pos = i;
      while (i < src.length && /[a-zA-Z0-9_]/.test(src[i])) { ident += src[i++]; }
      tokens.push({ type: ident === 'always' ? 'ALWAYS' : 'IDENT', value: ident, pos });
      continue;
    }

    throw new SyntaxError(`Unexpected character '${ch}' at position ${i}`);
  }

  tokens.push({ type: 'EOF', value: '', pos: src.length });
  return tokens;
}

// ─── Recursive Descent Parser ─────────────────────────────────────────────────

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token { return this.tokens[this.pos]; }

  private consume(): Token {
    const tok = this.tokens[this.pos++];
    return tok;
  }

  private expect(type: TokenType): Token {
    const tok = this.consume();
    if (tok.type !== type) {
      throw new SyntaxError(
        `Expected '${type}' but got '${tok.type}' ("${tok.value}") at pos ${tok.pos}`,
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

    const left  = this.parseOperand();
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
        throw new SyntaxError(
          `Expected comparison operator at pos ${tok.pos}, got '${tok.type}'`,
        );
    }
  }

  private parseOperand(): Operand {
    const tok = this.peek();

    if (tok.type === 'NUMBER') {
      this.consume();
      return { kind: 'num', value: parseInt(tok.value, 10) };
    }

    if (tok.type === 'DURATION') {
      this.consume();
      return { kind: 'duration_ms', ms: parseInt(tok.value, 10) * 1000 };
    }

    if (tok.type === 'STRING') {
      this.consume();
      return { kind: 'str', value: tok.value };
    }

    if (tok.type === 'IDENT') {
      this.consume();
      // Check for modulo: varname % number
      if (this.peek().type === 'MOD') {
        this.consume();
        const numTok = this.expect('NUMBER');
        return { kind: 'mod', name: tok.value, divisor: parseInt(numTok.value, 10) };
      }
      return { kind: 'var', name: tok.value };
    }

    throw new SyntaxError(`Expected operand at pos ${tok.pos}, got '${tok.type}'`);
  }
}

// ─── Evaluator ────────────────────────────────────────────────────────────────

function resolveOperand(op: Operand, ctx: EvalContext): number | string {
  switch (op.kind) {
    case 'num':         return op.value;
    case 'str':         return op.value;
    case 'duration_ms': return op.ms;
    case 'var': {
      const val = (ctx as Record<string, unknown>)[op.name];
      if (val === undefined) {
        throw new ReferenceError(`Unknown DSL variable '${op.name}'`);
      }
      return val as number | string;
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

function applyOp(left: number | string, op: CompareOp, right: number | string): boolean {
  switch (op) {
    case '>=': return (left as number) >= (right as number);
    case '<=': return (left as number) <= (right as number);
    case '>':  return (left as number) >  (right as number);
    case '<':  return (left as number) <  (right as number);
    case '==': return left === right;
    case '!=': return left !== right;
  }
}

export function evaluateDSL(ast: ASTNode, ctx: EvalContext): boolean {
  switch (ast.kind) {
    case 'always': return true;
    case 'not':    return !evaluateDSL(ast.expr, ctx);
    case 'and':    return evaluateDSL(ast.left, ctx) && evaluateDSL(ast.right, ctx);
    case 'or':     return evaluateDSL(ast.left, ctx) || evaluateDSL(ast.right, ctx);
    case 'cmp':    return applyOp(resolveOperand(ast.left, ctx), ast.op, resolveOperand(ast.right, ctx));
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Parse a DSL condition string into an AST. Throws SyntaxError on malformed input. */
export function parseDSL(input: string): ASTNode {
  return new Parser(tokenize(input.trim())).parse();
}

/**
 * Parse-and-evaluate in one call.
 * For hot paths (e.g. repeated evaluation of the same edge), cache the AST with parseDSL()
 * and call evaluateDSL() directly.
 */
export function checkCondition(condition: string, ctx: EvalContext): boolean {
  return evaluateDSL(parseDSL(condition), ctx);
}
