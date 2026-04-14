import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useContext,
  createContext,
} from 'react';
import { useTimerStore } from '../store/timerStore';
import type { WorkoutBlock } from '../engine/types';
import type { WorkoutGraph, GraphNode, GraphEdge } from '../engine/dslTypes';
import { GRAPH_END } from '../engine/dslTypes';

// ─── Types ────────────────────────────────────────────────────────────────────

type ItemKind = 'exercise' | 'break' | 'group' | 'decision';

interface FlatItem {
  id:       string;
  kind:     'exercise' | 'break';
  label:    string;
  /** seconds */
  duration: number;
  rounds:   number;
}

interface GroupItem {
  id:       string;
  kind:     'group';
  label:    string;
  rounds:   number;
  /** Supports arbitrary nesting */
  children: ListItem[];
  expanded: boolean;
}

interface BranchOption {
  id:       string;
  label:    string;
  children: ListItem[];
}

interface DecisionItem {
  id:       string;
  kind:     'decision';
  /** The question shown to the user at runtime (e.g. "Feeling strong?") */
  prompt:   string;
  options:  BranchOption[];
  expanded: boolean;
}

type ListItem = FlatItem | GroupItem | DecisionItem;

type EditTarget = { id: string; type: 'flat' | 'group' | 'decision' } | null;

// ─── Recursive utilities ──────────────────────────────────────────────────────

function uid(): string {
  return `ci_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function fmtSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

function findItemById(items: ListItem[], id: string): ListItem | null {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.kind === 'group') {
      const found = findItemById(item.children, id);
      if (found) return found;
    }
    if (item.kind === 'decision') {
      for (const opt of item.options) {
        const found = findItemById(opt.children, id);
        if (found) return found;
      }
    }
  }
  return null;
}

function updateItemById(
  items: ListItem[],
  id: string,
  fn: (item: ListItem) => ListItem,
): ListItem[] {
  return items.map((item) => {
    if (item.id === id) return fn(item);
    if (item.kind === 'group') {
      return { ...item, children: updateItemById(item.children, id, fn) };
    }
    if (item.kind === 'decision') {
      return {
        ...item,
        options: item.options.map((opt) => ({
          ...opt,
          children: updateItemById(opt.children, id, fn),
        })),
      };
    }
    return item;
  });
}

function removeItemById(items: ListItem[], id: string): ListItem[] {
  return items
    .filter((item) => item.id !== id)
    .map((item) => {
      if (item.kind === 'group') {
        return { ...item, children: removeItemById(item.children, id) };
      }
      if (item.kind === 'decision') {
        return {
          ...item,
          options: item.options.map((opt) => ({
            ...opt,
            children: removeItemById(opt.children, id),
          })),
        };
      }
      return item;
    });
}

function addChildToGroup(
  items: ListItem[],
  groupId: string,
  child: ListItem,
): ListItem[] {
  return updateItemById(items, groupId, (item) => {
    if (item.kind !== 'group') return item;
    return { ...item, children: [...item.children, child] };
  });
}

/**
 * Recursively convert the item tree into WorkoutBlocks for the flat TimerEngine
 * path. Decision items are excluded — workouts containing decisions use
 * toWorkoutGraph + startGraphSession instead.
 */
function toWorkoutBlocks(items: ListItem[]): WorkoutBlock[] {
  const result: WorkoutBlock[] = [];
  for (const item of items) {
    if (item.kind === 'group') {
      result.push({
        id:       item.id,
        type:     'circuit',
        label:    item.label,
        rounds:   item.rounds,
        children: toWorkoutBlocks(item.children),
      });
    } else if (item.kind === 'decision') {
      // Decisions require the graph engine — skip in flat mode.
      continue;
    } else {
      const stepType = item.kind === 'break' ? 'rest' as const : 'exercise' as const;
      const leaf: WorkoutBlock = {
        id:          item.id,
        type:        stepType,
        label:       item.label,
        duration_ms: item.duration * 1000,
      };
      if (item.rounds > 1) {
        result.push({
          id:       `${item.id}_circuit`,
          type:     'circuit',
          label:    item.label,
          rounds:   item.rounds,
          children: [leaf],
        });
      } else {
        result.push(leaf);
      }
    }
  }
  return result;
}

/** Returns true if any item (at any depth) is a Decision block. */
function hasDecision(items: ListItem[]): boolean {
  for (const item of items) {
    if (item.kind === 'decision') return true;
    if (item.kind === 'group' && hasDecision(item.children)) return true;
  }
  return false;
}

/**
 * Convert the item tree into a WorkoutGraph for startGraphSession.
 * Decision items become conditional routing nodes whose edges carry
 * userPrompt + DSL user-match conditions. Group children are flattened
 * (rounds are unrolled up to 10 to stay practical in graph mode).
 */
function toWorkoutGraph(items: ListItem[]): WorkoutGraph {
  const nodes = new Map<string, GraphNode>();

  // Walk items in reverse, chaining each node's edge to the next.
  // Returns the entry node id for this sequence (or continueTo if empty).
  function buildSequence(list: ListItem[], continueTo: string): string {
    let nextId = continueTo;

    for (let i = list.length - 1; i >= 0; i--) {
      const item = list[i];

      if (item.kind === 'decision') {
        const routingId = item.id;
        const edges: GraphEdge[] = item.options.map((opt) => ({
          to:         buildSequence(opt.children, nextId),
          condition:  `user == "${opt.label.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
          userPrompt: item.prompt,
          label:      opt.label,
        }));
        // Unconditional fallback: if no option matched, continue to next item
        edges.push({ to: nextId });

        const block: WorkoutBlock = { id: routingId, type: 'conditional', label: item.prompt };
        nodes.set(routingId, { id: routingId, block, edges });
        nextId = routingId;

      } else if (item.kind === 'group') {
        // Unroll rounds (cap at 10 to bound graph size)
        const reps = Math.min(item.rounds, 10);
        let chainEnd = nextId;
        for (let r = reps - 1; r >= 0; r--) {
          chainEnd = buildSequence(item.children, chainEnd);
        }
        nextId = chainEnd;

      } else {
        // FlatItem — exercise or break
        const nodeId = item.id;
        const block: WorkoutBlock = {
          id:          nodeId,
          type:        item.kind === 'break' ? 'rest' : 'exercise',
          label:       item.label,
          duration_ms: item.duration * 1000,
        };
        nodes.set(nodeId, { id: nodeId, block, edges: [{ to: nextId }] });
        nextId = nodeId;
      }
    }

    return nextId;
  }

  const entryId = buildSequence(items, GRAPH_END);
  return { nodes, entryId };
}

function calcTotals(
  items: ListItem[],
  multiplier = 1,
): { totalSec: number; exercises: number; items: number; decisions: number } {
  let totalSec  = 0;
  let exercises = 0;
  let itemCount = 0;
  let decisions = 0;
  for (const item of items) {
    if (item.kind === 'group') {
      const sub = calcTotals(item.children, multiplier * item.rounds);
      totalSec  += sub.totalSec;
      exercises += sub.exercises;
      itemCount += sub.items;
      decisions += sub.decisions;
    } else if (item.kind === 'decision') {
      decisions++;
      itemCount++;
      // Count exercises across all branches (informational only — branches are exclusive)
      for (const opt of item.options) {
        const sub = calcTotals(opt.children, multiplier);
        exercises += sub.exercises;
        decisions += sub.decisions;
      }
    } else {
      itemCount++;
      if (item.kind === 'exercise') exercises++;
      totalSec += item.duration * multiplier * item.rounds;
    }
  }
  return { totalSec, exercises, items: itemCount, decisions };
}

// ─── Workout DSL ──────────────────────────────────────────────────────────────
//
// A plain-text DSL for defining workouts. Completely separate from dslParser.ts
// which handles condition expressions (edge conditions for GraphEngine).
//
// Grammar:
//   workout   = item*
//   item      = exercise | rest | group | decision
//   exercise  = 'exercise' string? duration
//   rest      = ('rest'|'break') string? duration
//   group     = 'group' string? ('x' NUMBER) string? '{' item* '}'
//   decision  = 'decision' string '{' branch+ '}'
//   branch    = string '{' item* '}'
//   duration  = (NUMBER unit?)+ where unit = 's'|'m'|'h'
//               30s → 30 | 2m → 120 | 1m30s → 90 | bare number → seconds
//   string    = '"' [^"]* '"'
//   Comments: // or # to end of line

class DSLWorkoutError extends Error {
  readonly line:       number;
  readonly col:        number;
  readonly sourceLine: string;

  constructor(message: string, line: number, col: number, sourceLine: string) {
    super(message);
    this.name       = 'DSLWorkoutError';
    this.line       = line;
    this.col        = col;
    this.sourceLine = sourceLine;
  }

  pretty(): string {
    const indent = '  ';
    const caretOffset = Math.max(0, this.col - 1);
    return (
      `Line ${this.line}: ${this.message}\n` +
      `${indent}${this.sourceLine}\n` +
      `${indent}${' '.repeat(caretOffset)}^`
    );
  }
}

// ── Tokenizer ──────────────────────────────────────────────────────────────────

interface WToken {
  type:   'KW' | 'STRING' | 'NUMBER' | 'IDENT' | 'LBRACE' | 'RBRACE' | 'EOF';
  value?: string | number;   // present for KW, STRING, NUMBER, IDENT
  line:   number;
  col:    number;
}

const WORKOUT_KEYWORDS = new Set(['exercise', 'rest', 'break', 'group', 'decision']);

function tokenizeWorkout(src: string): WToken[] {
  const tokens: WToken[] = [];
  const srcLines = src.split('\n');

  for (let li = 0; li < srcLines.length; li++) {
    const ln  = srcLines[li];
    const lno = li + 1;
    let   ci  = 0;

    while (ci < ln.length) {
      // Whitespace
      if (/\s/.test(ln[ci])) { ci++; continue; }

      // Comments (# or //)
      if (ln[ci] === '#' || (ln[ci] === '/' && ln[ci + 1] === '/')) break;

      const startCi = ci;

      // String literal
      if (ln[ci] === '"') {
        ci++;
        let str = '';
        while (ci < ln.length && ln[ci] !== '"') {
          if (ln[ci] === '\\' && ci + 1 < ln.length) {
            const esc = ln[++ci];
            str += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc;
            ci++;
          } else {
            str += ln[ci++];
          }
        }
        if (ci >= ln.length) {
          throw new DSLWorkoutError('Unterminated string literal', lno, startCi + 1, ln);
        }
        ci++; // closing "
        tokens.push({ type: 'STRING', value: str, line: lno, col: startCi + 1 });
        continue;
      }

      // Number
      if (/[0-9]/.test(ln[ci])) {
        let num = '';
        while (ci < ln.length && /[0-9]/.test(ln[ci])) num += ln[ci++];
        tokens.push({ type: 'NUMBER', value: parseInt(num, 10), line: lno, col: startCi + 1 });
        continue;
      }

      // Braces
      if (ln[ci] === '{') { tokens.push({ type: 'LBRACE', line: lno, col: startCi + 1 }); ci++; continue; }
      if (ln[ci] === '}') { tokens.push({ type: 'RBRACE', line: lno, col: startCi + 1 }); ci++; continue; }

      // Identifier or keyword (allows digits after the first char, e.g. x3)
      if (/[a-zA-Z_]/.test(ln[ci])) {
        let ident = '';
        while (ci < ln.length && /[a-zA-Z0-9_]/.test(ln[ci])) ident += ln[ci++];
        const lower = ident.toLowerCase();
        tokens.push(
          WORKOUT_KEYWORDS.has(lower)
            ? { type: 'KW',    value: lower, line: lno, col: startCi + 1 }
            : { type: 'IDENT', value: ident, line: lno, col: startCi + 1 },
        );
        continue;
      }

      throw new DSLWorkoutError(
        `Unexpected character '${ln[ci]}'`,
        lno, startCi + 1, ln,
      );
    }
  }

  tokens.push({ type: 'EOF', line: srcLines.length, col: 1 });
  return tokens;
}

// ── Recursive descent parser ───────────────────────────────────────────────────

class WorkoutDSLParser {
  private pos = 0;
  private readonly tokens: WToken[];
  private readonly srcLines: string[];

  constructor(tokens: WToken[], src: string) {
    this.tokens   = tokens;
    this.srcLines = src.split('\n');
  }

  private peek():    WToken { return this.tokens[this.pos]; }
  private consume(): WToken { return this.tokens[this.pos++]; }

  private srcLine(lineNo: number): string { return this.srcLines[lineNo - 1] ?? ''; }

  private error(msg: string, tok?: WToken): never {
    const t = tok ?? this.peek();
    throw new DSLWorkoutError(msg, t.line, t.col, this.srcLine(t.line));
  }

  /**
   * Parse one number+unit sequence, consuming as many (number unit?) pairs as
   * are present. Handles: 30s | 2m | 1m30s | 1h30m | bare 90 (→ seconds).
   * Returns seconds.
   */
  private parseDuration(): number {
    if (this.peek().type !== 'NUMBER') {
      this.error('Expected duration (e.g. 30s, 2m, 1m30s)');
    }
    let total = 0;

    while (this.peek().type === 'NUMBER') {
      const n = this.consume().value as number;

      if (this.peek().type !== 'IDENT') {
        total += n; // bare number → seconds
        break;
      }

      const unit = (this.consume().value as string).toLowerCase();
      if      (unit === 's') { total += n;         break; }
      else if (unit === 'm') { total += n * 60;          }
      else if (unit === 'h') { total += n * 3600;        }
      else                   { total += n;         break; } // unknown unit → secs
    }

    return total;
  }

  private parseOptStr(fallback: string): string {
    if (this.peek().type === 'STRING') return this.consume().value as string;
    return fallback;
  }

  private parseRepeat(defaultRounds = 3): number {
    const tok = this.peek();
    if (tok.type !== 'IDENT') return defaultRounds;
    const val = tok.value as string;
    if (/^x\d+$/i.test(val)) {
      this.consume();
      const n = parseInt(val.slice(1), 10);
      return isNaN(n) || n < 1 ? defaultRounds : n;
    }
    return defaultRounds;
  }

  parseItems(): ListItem[] {
    const items: ListItem[] = [];
    while (this.peek().type !== 'EOF' && this.peek().type !== 'RBRACE') {
      items.push(this.parseItem());
    }
    return items;
  }

  private parseItem(): ListItem {
    const tok = this.peek();
    if (tok.type !== 'KW') {
      this.error(
        `Expected exercise, rest, group, or decision — got '${
          tok.type === 'STRING' ? `"${tok.value}"` : String(tok.value ?? tok.type)
        }'`,
      );
    }
    switch (tok.value as string) {
      case 'exercise': return this.parseExercise();
      case 'rest':
      case 'break':    return this.parseRest();
      case 'group':    return this.parseGroup();
      case 'decision': return this.parseDecision();
      default:         this.error(`Unknown keyword '${tok.value}'`);
    }
  }

  private parseExercise(): FlatItem {
    this.consume(); // 'exercise'
    const label    = this.parseOptStr('Exercise');
    const duration = this.parseDuration();
    return { id: uid(), kind: 'exercise', label, duration, rounds: 1 };
  }

  private parseRest(): FlatItem {
    this.consume(); // 'rest' | 'break'
    const label    = this.parseOptStr('Rest');
    const duration = this.parseDuration();
    return { id: uid(), kind: 'break', label, duration, rounds: 1 };
  }

  private parseGroup(): GroupItem {
    this.consume(); // 'group'
    // Accept any order of string and x<N> before {
    let label  = 'Group';
    let rounds = 3;
    for (let i = 0; i < 2; i++) {
      if (this.peek().type === 'STRING') {
        label = this.consume().value as string;
      } else {
        const r = this.parseRepeat(-1);
        if (r !== -1) rounds = r;
        else break;
      }
    }
    if (this.peek().type !== 'LBRACE') this.error("Expected '{' to open group body");
    this.consume();
    const children = this.parseItems();
    if (this.peek().type !== 'RBRACE') this.error("Expected '}' to close group body");
    this.consume();
    return { id: uid(), kind: 'group', label, rounds, children, expanded: false };
  }

  private parseDecision(): DecisionItem {
    this.consume(); // 'decision'
    const prompt = this.parseOptStr('Choose your path');
    if (this.peek().type !== 'LBRACE') this.error("Expected '{' after decision prompt");
    this.consume();

    const options: BranchOption[] = [];
    while (this.peek().type !== 'RBRACE' && this.peek().type !== 'EOF') {
      if (this.peek().type !== 'STRING') this.error('Expected branch label string (e.g. "Heavy sets")');
      const branchLabel = this.consume().value as string;
      if (this.peek().type !== 'LBRACE') this.error("Expected '{' to open branch body");
      this.consume();
      const children = this.parseItems();
      if (this.peek().type !== 'RBRACE') this.error("Expected '}' to close branch body");
      this.consume();
      options.push({ id: uid(), label: branchLabel, children });
    }

    if (options.length < 2) {
      const t = this.peek();
      throw new DSLWorkoutError('Decision must have at least 2 branches', t.line, t.col, this.srcLine(t.line));
    }
    if (this.peek().type !== 'RBRACE') this.error("Expected '}' to close decision block");
    this.consume();
    return { id: uid(), kind: 'decision', prompt, options, expanded: false };
  }

  parse(): ListItem[] {
    const items = this.parseItems();
    if (this.peek().type !== 'EOF') {
      this.error('Unexpected content after end of workout');
    }
    return items;
  }
}

function parseDSLWorkout(src: string): ListItem[] {
  const tokens = tokenizeWorkout(src);
  return new WorkoutDSLParser(tokens, src).parse();
}

// ── Serializer ────────────────────────────────────────────────────────────────

function fmtDuration(secs: number): string {
  if (secs <= 0)    return '0s';
  if (secs < 60)    return `${secs}s`;
  if (secs < 3600) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return s > 0 ? `${m}m${s}s` : `${m}m`;
  }
  const h  = Math.floor(secs / 3600);
  const rm = Math.floor((secs % 3600) / 60);
  return rm > 0 ? `${h}h${rm}m` : `${h}h`;
}

function serializeDSLWorkout(items: ListItem[], depth = 0): string {
  const pad  = '  '.repeat(depth);
  const pad1 = '  '.repeat(depth + 1);
  const lines: string[] = [];

  for (const item of items) {
    if (item.kind === 'exercise') {
      lines.push(`${pad}exercise "${item.label}" ${fmtDuration(item.duration)}`);
    } else if (item.kind === 'break') {
      lines.push(`${pad}rest "${item.label}" ${fmtDuration(item.duration)}`);
    } else if (item.kind === 'group') {
      const body = serializeDSLWorkout(item.children, depth + 1);
      lines.push(`${pad}group "${item.label}" x${item.rounds} {`);
      if (body) lines.push(body);
      lines.push(`${pad}}`);
    } else if (item.kind === 'decision') {
      lines.push(`${pad}decision "${item.prompt}" {`);
      for (const opt of item.options) {
        const body = serializeDSLWorkout(opt.children, depth + 2);
        lines.push(`${pad1}"${opt.label}" {`);
        if (body) lines.push(body);
        lines.push(`${pad1}}`);
      }
      lines.push(`${pad}}`);
    }
  }

  return lines.join('\n');
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface BuilderCtxValue {
  setItems:   React.Dispatch<React.SetStateAction<ListItem[]>>;
  setEditing: (target: EditTarget) => void;
}
const BuilderCtx = createContext<BuilderCtxValue>(null!);

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  green:  'rgba(169,229,187,',
  amber:  'rgba(254,178,70,',
  coral:  'rgba(255,132,129,',
  blue:   'rgba(88,166,255,',
  violet: 'rgba(168,85,247,',
} as const;

// ─── useDragOrder ─────────────────────────────────────────────────────────────
//
// Pointer-capture drag (mouse + touch via unified pointer events) with:
//  • floating clone that follows the exact container shape (border-radius aware)
//  • ghost uses box-shadow instead of outline so it follows rounded corners
//  • dropIdx exposed as React state so DropLine components can react to it
//  • siblings shift via CSS transform to open a gap at the insertion point
//  • reorder committed only on pointerUp — no layout shifts during drag

// ── Internal drag state (per useDragOrder instance) ──────────────────────────
interface DragState {
  id:         string;
  origIdx:    number;
  offsetY:    number;  // pointer Y offset from element top
  itemHeight: number;
  floater:    HTMLElement;
  origEl:     HTMLElement;
}

function useDragOrder<T extends { id: string }>(
  items: T[],
  onReorder: (next: T[]) => void,
) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // dropIdx as state so DropLine components re-render when the target gap changes
  const [dropIdx, setDropIdx] = useState<number>(-1);

  const dragRef    = useRef<DragState | null>(null);
  const dropIdxRef = useRef(-1);
  const listRef    = useRef<HTMLDivElement>(null);

  // ── Shared cleanup ─────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    const dr = dragRef.current;
    if (!dr) return;

    dr.floater.remove();

    // Restore ghost — clear all inline overrides
    dr.origEl.style.opacity    = '';
    dr.origEl.style.boxShadow  = '';
    dr.origEl.style.filter     = '';
    dr.origEl.style.transition = '';

    // Restore all sibling shifts
    const list = listRef.current;
    if (list) {
      (Array.from(list.children) as HTMLElement[])
        .filter((el) => el.dataset.id)
        .forEach((el) => {
          el.style.transform  = '';
          el.style.transition = '';
        });
    }

    dragRef.current    = null;
    dropIdxRef.current = -1;
    setDraggingId(null);
    setDropIdx(-1);
  }, []);

  useEffect(() => () => { dragRef.current?.floater.remove(); }, []);

  const getHandleProps = useCallback(
    (id: string): React.HTMLAttributes<HTMLDivElement> => ({
      // Prevent browser scroll/pan so the element can be dragged on touch devices
      style: { touchAction: 'none' } as React.CSSProperties,

      onPointerDown(e) {
        e.preventDefault();
        const origIdx = items.findIndex((it) => it.id === id);
        if (origIdx === -1) return;

        const origEl = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-id]');
        if (!origEl) return;

        const rect       = origEl.getBoundingClientRect();
        const itemHeight = rect.height;
        const br         = window.getComputedStyle(origEl).borderRadius;

        // ── Floating clone — shape follows the original's border-radius ────
        const floater = origEl.cloneNode(true) as HTMLElement;
        floater.removeAttribute('data-id');
        floater.id = '__dnd_floater__';
        Object.assign(floater.style, {
          position:      'fixed',
          top:           `${rect.top}px`,
          left:          `${rect.left}px`,
          width:         `${rect.width}px`,
          height:        `${rect.height}px`,
          margin:        '0',
          // overflow:hidden clips any children that extend past border-radius
          // so box-shadow + outline both follow the true shape
          overflow:      'hidden',
          pointerEvents: 'none',
          zIndex:        '9999',
          borderRadius:  br,
          willChange:    'top',
          transform:     'scale(1.04) rotate(0.5deg)',
          // The 0 0 0 2px layer is the shape-following blue outline
          boxShadow:     '0 24px 56px rgba(0,0,0,0.82), 0 0 0 2px rgba(88,166,255,0.9), 0 0 36px rgba(88,166,255,0.22)',
          transition:    'transform 0.16s cubic-bezier(0.2,0,0,1), box-shadow 0.16s',
        });
        document.body.appendChild(floater);

        // ── Ghost — box-shadow instead of outline so it follows border-radius ──
        Object.assign(origEl.style, {
          opacity:    '0.25',
          boxShadow:  '0 0 0 1.5px rgba(255,255,255,0.15)',
          filter:     'grayscale(0.4) blur(0.3px)',
          transition: 'opacity 0.15s, filter 0.15s',
        });

        dragRef.current = {
          id, origIdx,
          offsetY:    e.clientY - rect.top,
          itemHeight,
          floater,
          origEl,
        };
        dropIdxRef.current = origIdx;
        setDraggingId(id);
        setDropIdx(origIdx);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      },

      onPointerMove(e) {
        const dr = dragRef.current;
        if (!dr || dr.id !== id) return;
        const list = listRef.current;
        if (!list) return;

        // Move floater — position is instant, no transition on top
        dr.floater.style.top        = `${e.clientY - dr.offsetY}px`;
        dr.floater.style.transform  = 'scale(1.04) rotate(0.5deg)';
        dr.floater.style.transition = 'box-shadow 0.1s';

        // ── Recalculate drop index ─────────────────────────────────────────
        const children = (Array.from(list.children) as HTMLElement[]).filter(
          (el) => el.dataset.id,
        );

        let newDropIdx = items.length;
        for (let i = 0; i < children.length; i++) {
          if (children[i].dataset.id === id) continue;
          const r = children[i].getBoundingClientRect();
          if (e.clientY < r.top + r.height / 2) {
            newDropIdx = i;
            break;
          }
        }

        // ── Shift siblings — snap-spring timing, expo ease-out ─────────────
        const gap = dr.itemHeight + 8;
        children.forEach((el, i) => {
          if (el.dataset.id === id) return;
          let shift = 0;
          if (dr.origIdx < newDropIdx) {
            if (i > dr.origIdx && i <= newDropIdx - 1) shift = -gap;
          } else {
            if (i >= newDropIdx && i < dr.origIdx) shift = gap;
          }
          el.style.transform  = shift ? `translateY(${shift}px)` : '';
          el.style.transition = 'transform 0.2s cubic-bezier(0.16,1,0.3,1)';
        });

        // Only trigger re-render when the insertion slot actually changes
        if (newDropIdx !== dropIdxRef.current) {
          dropIdxRef.current = newDropIdx;
          setDropIdx(newDropIdx);
        }
      },

      onPointerUp() {
        const dr = dragRef.current;
        if (!dr || dr.id !== id) return;

        const origIdx  = dr.origIdx;
        let   finalIdx = dropIdxRef.current;
        if (finalIdx > origIdx) finalIdx--;

        cleanup();

        if (finalIdx !== origIdx && finalIdx >= 0 && finalIdx < items.length) {
          const next = [...items];
          const [moved] = next.splice(origIdx, 1);
          next.splice(finalIdx, 0, moved);
          onReorder(next);
        }
      },

      onLostPointerCapture() {
        if (dragRef.current?.id === id) cleanup();
      },
    }),
    [items, onReorder, cleanup],
  );

  return { listRef, getHandleProps, draggingId, dropIdx };
}

// ─── DropLine ─────────────────────────────────────────────────────────────────
// Always rendered; CSS-animated height so there are NO layout shift pops.

function DropLine({ active }: { active: boolean }) {
  return (
    <div
      style={{
        height:       active ? 3 : 0,
        background:   active ? 'rgba(88,166,255,1)' : 'transparent',
        borderRadius: 2,
        margin:       active ? '5px 0' : '0',
        boxShadow:    active
          ? '0 0 18px rgba(88,166,255,0.9), 0 0 6px rgba(88,166,255,1)'
          : 'none',
        transition:   'height 0.14s cubic-bezier(0.4,0,0.2,1), margin 0.14s, box-shadow 0.14s',
        overflow:     'hidden',
        pointerEvents: 'none',
      }}
    />
  );
}

// ─── DragHandle ───────────────────────────────────────────────────────────────

function DragHandle() {
  return (
    <div
      className="flex flex-col gap-[4px] cursor-grab active:cursor-grabbing shrink-0 touch-none"
      style={{ padding: '4px 6px' }}
      aria-hidden="true"
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="w-4 h-[2px] rounded-full"
          style={{ background: 'rgba(255,255,255,0.22)' }}
        />
      ))}
    </div>
  );
}

// ─── ItemPill ─────────────────────────────────────────────────────────────────

function ItemPill({
  item,
  onEdit,
  onRemove,
  dragHandleProps,
}: {
  item:            FlatItem;
  onEdit:          () => void;
  onRemove:        () => void;
  dragHandleProps: React.HTMLAttributes<HTMLDivElement>;
}) {
  const isBreak = item.kind === 'break';
  const accent  = isBreak ? C.amber : C.green;

  return (
    <div
      className="flex items-center gap-3 rounded-[40px] px-3 py-2.5"
      style={{
        background: `${accent}0.08)`,
        border:     `1px solid ${accent}0.22)`,
      }}
    >
      {/* Drag handle — stop propagation so group toggle doesn't fire */}
      <div {...dragHandleProps} onClick={(e) => e.stopPropagation()}>
        <DragHandle />
      </div>

      {/* Icon chip */}
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-sm"
        style={{ background: `${accent}0.14)`, color: `${accent}0.85)` }}
      >
        {isBreak ? '⏱' : '💪'}
      </div>

      {/* Label → tap to edit */}
      <button
        onClick={onEdit}
        className="flex-1 text-left text-sm font-semibold truncate"
        style={{ color: 'var(--color-brand-text)' }}
      >
        {item.label}
      </button>

      {/* Duration badge */}
      <span
        className="text-[11px] font-bold px-2.5 py-0.5 rounded-full shrink-0"
        style={{ background: 'rgba(254,178,70,0.15)', color: 'rgba(254,178,70,0.9)' }}
      >
        {fmtSec(item.duration)}
      </span>

      {/* Rounds badge (> 1 only) */}
      {!isBreak && item.rounds > 1 && (
        <span
          className="text-[11px] font-bold px-2.5 py-0.5 rounded-full shrink-0"
          style={{ background: `${accent}0.12)`, color: `${accent}0.85)` }}
        >
          ×{item.rounds}
        </span>
      )}

      {/* Remove */}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
        style={{ color: 'rgba(255,132,129,0.5)', background: 'rgba(255,132,129,0.07)' }}
        aria-label="Remove"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
        </svg>
      </button>
    </div>
  );
}

// ─── InnerFAB (always-visible add row at the bottom of each group) ────────────

function InnerFAB({ onAdd }: { onAdd: (kind: ItemKind) => void }) {
  const actions: {
    kind:   ItemKind;
    label:  string;
    bg:     string;
    border: string;
    color:  string;
    icon:   string;
  }[] = [
    {
      kind:   'exercise',
      label:  'Exercise',
      bg:     `${C.green}0.1)`,
      border: `${C.green}0.28)`,
      color:  `${C.green}0.9)`,
      icon:   '💪',
    },
    {
      kind:   'break',
      label:  'Break',
      bg:     `${C.amber}0.1)`,
      border: `${C.amber}0.28)`,
      color:  `${C.amber}0.9)`,
      icon:   '⏱',
    },
    {
      kind:   'group',
      label:  'Group',
      bg:     `${C.blue}0.1)`,
      border: `${C.blue}0.28)`,
      color:  `${C.blue}0.9)`,
      icon:   '📁',
    },
    {
      kind:   'decision',
      label:  'Decision',
      bg:     `${C.violet}0.1)`,
      border: `${C.violet}0.28)`,
      color:  `${C.violet}0.9)`,
      icon:   '⚡',
    },
  ];

  return (
    <div
      className="mt-4 pt-3 flex gap-2"
      style={{ borderTop: `1px dashed ${C.blue}0.18)` }}
    >
      {actions.map(({ kind, label, bg, border, color, icon }) => (
        <button
          key={kind}
          onClick={(e) => { e.stopPropagation(); onAdd(kind); }}
          className="flex-1 flex flex-col items-center gap-1 py-3 rounded-2xl text-[11px] font-bold transition-all active:scale-95"
          style={{
            background: bg,
            border:     `1px solid ${border}`,
            color,
          }}
        >
          <span className="text-base leading-none">{icon}</span>
          <span>+ {label}</span>
        </button>
      ))}
    </div>
  );
}

// ─── GroupContainer ───────────────────────────────────────────────────────────
// Recursive — a GroupItem's children can themselves contain GroupContainers.

function GroupContainer({
  group,
  dragHandleProps,
}: {
  group:           GroupItem;
  dragHandleProps: React.HTMLAttributes<HTMLDivElement>;
}) {
  const ctx = useContext(BuilderCtx);

  // Each group manages its own children drag independently
  const {
    listRef:        childListRef,
    getHandleProps: childHandleProps,
    draggingId:     childDraggingId,
    dropIdx:        childDropIdx,
  } = useDragOrder<ListItem>(group.children, (newChildren) => {
    ctx.setItems((prev) =>
      updateItemById(prev, group.id, (item) => ({
        ...(item as GroupItem),
        children: newChildren,
      })),
    );
  });

  function toggleExpanded(e: React.MouseEvent) {
    // Don't toggle when clicking a button inside the header
    if ((e.target as HTMLElement).closest('button')) return;
    ctx.setItems((prev) =>
      updateItemById(prev, group.id, (item) => ({
        ...(item as GroupItem),
        expanded: !(item as GroupItem).expanded,
      })),
    );
  }

  function handleAddChild(kind: ItemKind) {
    let newItem: ListItem;
    if (kind === 'group') {
      newItem = { id: uid(), kind: 'group', label: 'Group', rounds: 3, children: [], expanded: false };
    } else if (kind === 'decision') {
      newItem = {
        id: uid(), kind: 'decision', prompt: 'Feeling strong?', expanded: false,
        options: [
          { id: uid(), label: 'Heavy sets',   children: [] },
          { id: uid(), label: 'Lighter reps', children: [] },
        ],
      };
    } else {
      newItem = {
        id:       uid(),
        kind,
        label:    kind === 'break' ? 'Rest' : 'Exercise',
        duration: kind === 'break' ? 30 : 45,
        rounds:   1,
      };
    }
    ctx.setItems((prev) => addChildToGroup(prev, group.id, newItem));
    ctx.setEditing({
      id:   newItem.id,
      type: newItem.kind === 'group' ? 'group' : newItem.kind === 'decision' ? 'decision' : 'flat',
    });
  }

  const childCount = group.children.length;

  return (
    <div
      className="rounded-3xl"
      style={{
        background: `${C.blue}0.06)`,
        border:     `1px solid ${C.blue}0.22)`,
      }}
    >
      {/* ── Header row — primary click zone to toggle expansion ── */}
      <div
        className="flex items-center gap-3 px-4 py-4 cursor-pointer select-none rounded-3xl"
        onClick={toggleExpanded}
        role="button"
        aria-expanded={group.expanded}
      >
        {/* Drag handle — stopPropagation so the click-toggle doesn't fire */}
        <div onClick={(e) => e.stopPropagation()} {...dragHandleProps}>
          <DragHandle />
        </div>

        {/* Icon */}
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-base"
          style={{ background: `${C.blue}0.14)`, color: `${C.blue}0.85)` }}
        >
          📁
        </div>

        {/* Label */}
        <span
          className="flex-1 text-sm font-semibold truncate"
          style={{ color: 'var(--color-brand-text)' }}
        >
          {group.label}
        </span>

        {/* Child count pill */}
        {childCount > 0 && (
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.35)' }}
          >
            {childCount} item{childCount !== 1 ? 's' : ''}
          </span>
        )}

        {/* Rounds badge */}
        <span
          className="text-[11px] font-bold px-2.5 py-0.5 rounded-full shrink-0"
          style={{ background: `${C.blue}0.12)`, color: `${C.blue}0.85)` }}
        >
          ×{group.rounds}
        </span>

        {/* Edit group */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            ctx.setEditing({ id: group.id, type: 'group' });
          }}
          className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-colors"
          style={{ color: `${C.blue}0.6)`, background: `${C.blue}0.1)` }}
          aria-label="Edit group"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
          </svg>
        </button>

        {/* Chevron */}
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-transform duration-200"
          style={{
            color:      `${C.blue}0.65)`,
            background: `${C.blue}0.08)`,
            transform:  group.expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
          aria-hidden="true"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 10l5 5 5-5z" />
          </svg>
        </div>

        {/* Remove group */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            ctx.setItems((prev) => removeItemById(prev, group.id));
          }}
          className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
          style={{ color: 'rgba(255,132,129,0.5)', background: 'rgba(255,132,129,0.07)' }}
          aria-label="Remove group"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>
      </div>

      {/* ── Expanded children area ── */}
      {group.expanded && (
        <div className="px-4 pb-5 pt-1">
          {/* Indent line */}
          <div
            className="ml-4 pl-4"
            style={{ borderLeft: `1.5px solid ${C.blue}0.18)` }}
          >
            <div ref={childListRef} className="flex flex-col">
              {group.children.map((child, i) => (
                <React.Fragment key={child.id}>
                  <DropLine active={childDraggingId !== null && childDropIdx === i} />
                  <div
                    data-id={child.id}
                    style={{ marginBottom: 8, animation: `listIn 0.2s ease-out ${i * 0.04}s both` }}
                  >
                    {child.kind === 'group' ? (
                      <GroupContainer
                        group={child}
                        dragHandleProps={childHandleProps(child.id)}
                      />
                    ) : child.kind === 'decision' ? (
                      <DecisionContainer
                        item={child}
                        dragHandleProps={childHandleProps(child.id)}
                      />
                    ) : (
                      <ItemPill
                        item={child}
                        onEdit={() => ctx.setEditing({ id: child.id, type: 'flat' })}
                        onRemove={() => ctx.setItems((prev) => removeItemById(prev, child.id))}
                        dragHandleProps={childHandleProps(child.id)}
                      />
                    )}
                  </div>
                </React.Fragment>
              ))}
              <DropLine active={childDraggingId !== null && childDropIdx >= group.children.length} />
            </div>

            {/* Inner FAB — add items to this group */}
            <InnerFAB onAdd={handleAddChild} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── EditSheet ────────────────────────────────────────────────────────────────

interface EditSheetProps {
  initial:   FlatItem;
  onConfirm: (v: { label: string; duration: number; rounds: number }) => void;
  onClose:   () => void;
}

function EditSheet({ initial, onConfirm, onClose }: EditSheetProps) {
  const [label,    setLabel]    = useState(initial.label);
  const [duration, setDuration] = useState(initial.duration);
  const [rounds,   setRounds]   = useState(initial.rounds);

  const isBreak = initial.kind === 'break';
  const accent  = isBreak ? C.amber : C.green;

  const [rawDur, setRawDur] = useState(() => {
    const m = Math.floor(initial.duration / 60);
    const s = initial.duration % 60;
    return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : String(initial.duration);
  });

  function parseDuration(str: string): number {
    const parts = str.split(':');
    if (parts.length === 2) return (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
    return parseInt(str) || 0;
  }

  function handleDurBlur() {
    const sec = Math.max(1, parseDuration(rawDur));
    setDuration(sec);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    setRawDur(m > 0 ? `${m}:${String(s).padStart(2, '0')}` : String(sec));
  }

  function stepper(field: 'duration' | 'rounds', delta: number) {
    if (field === 'duration') {
      const next = Math.max(1, duration + delta);
      setDuration(next);
      const m = Math.floor(next / 60);
      const s = next % 60;
      setRawDur(m > 0 ? `${m}:${String(s).padStart(2, '0')}` : String(next));
    } else {
      setRounds((r) => Math.max(1, r + delta));
    }
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'rgba(18,11,24,0.72)', backdropFilter: 'blur(8px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-t-[2rem] px-6 pt-5 pb-10 flex flex-col gap-5"
        style={{
          background:   'rgba(29,18,34,0.98)',
          border:       '1px solid rgba(255,255,255,0.08)',
          borderBottom: 'none',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center">
          <div className="w-10 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.15)' }} />
        </div>

        <div className="flex items-center justify-between">
          <span
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: `${accent}0.6)` }}
          >
            {isBreak ? 'Break' : 'Exercise'}
          </span>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center"
            style={{ color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.06)' }}
            aria-label="Close"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        {!isBreak && (
          <input
            autoFocus
            className="w-full bg-transparent font-display text-2xl font-light text-center outline-none border-b pb-2"
            style={{ color: 'var(--color-brand-text)', borderColor: `${accent}0.25)` }}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Exercise name"
          />
        )}

        <div className="flex flex-col gap-2">
          <span
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: 'var(--color-brand-text-muted)' }}
          >
            Duration
          </span>
          <div
            className="flex items-center rounded-[40px] px-4 py-2"
            style={{ border: `2px solid rgba(254,178,70,0.35)` }}
          >
            <button
              onClick={() => stepper('duration', -5)}
              className="w-9 h-9 rounded-full flex items-center justify-center text-xl font-bold active:scale-90"
              style={{ color: 'rgba(254,178,70,0.8)' }}
            >−</button>
            <input
              className="flex-1 bg-transparent text-center font-display text-xl font-semibold outline-none tabular-nums"
              style={{ color: 'var(--color-brand-text)' }}
              value={rawDur}
              onChange={(e) => setRawDur(e.target.value)}
              onBlur={handleDurBlur}
              placeholder="0:45"
            />
            <button
              onClick={() => stepper('duration', 5)}
              className="w-9 h-9 rounded-full flex items-center justify-center text-xl font-bold active:scale-90"
              style={{ color: 'rgba(254,178,70,0.8)' }}
            >+</button>
          </div>
        </div>

        {!isBreak && (
          <div className="flex flex-col gap-2">
            <span
              className="text-xs font-bold uppercase tracking-widest"
              style={{ color: 'var(--color-brand-text-muted)' }}
            >
              Rounds
            </span>
            <div
              className="flex items-center rounded-[40px] px-4 py-2"
              style={{ border: `2px solid ${accent}0.3)` }}
            >
              <button
                onClick={() => stepper('rounds', -1)}
                className="w-9 h-9 rounded-full flex items-center justify-center text-xl font-bold active:scale-90"
                style={{ color: `${accent}0.8)` }}
              >−</button>
              <span
                className="flex-1 text-center font-display text-xl font-semibold tabular-nums"
                style={{ color: 'var(--color-brand-text)' }}
              >
                {rounds}
              </span>
              <button
                onClick={() => stepper('rounds', 1)}
                className="w-9 h-9 rounded-full flex items-center justify-center text-xl font-bold active:scale-90"
                style={{ color: `${accent}0.8)` }}
              >+</button>
            </div>
          </div>
        )}

        <button
          onClick={() => onConfirm({ label: label.trim() || initial.label, duration, rounds })}
          className="w-full py-4 rounded-[40px] font-bold text-sm uppercase tracking-widest transition-all active:scale-[0.98]"
          style={{
            background: `${accent}0.9)`,
            color:      '#120b18',
            boxShadow:  `0 0 32px ${accent}0.2)`,
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

// ─── GroupEditSheet ───────────────────────────────────────────────────────────

function GroupEditSheet({
  initial,
  onConfirm,
  onClose,
}: {
  initial:   { label: string; rounds: number };
  onConfirm: (v: { label: string; rounds: number }) => void;
  onClose:   () => void;
}) {
  const [label,  setLabel]  = useState(initial.label);
  const [rounds, setRounds] = useState(initial.rounds);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'rgba(18,11,24,0.72)', backdropFilter: 'blur(8px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-t-[2rem] px-6 pt-5 pb-10 flex flex-col gap-5"
        style={{
          background:   'rgba(29,18,34,0.98)',
          border:       '1px solid rgba(255,255,255,0.08)',
          borderBottom: 'none',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center">
          <div className="w-10 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.15)' }} />
        </div>
        <div className="flex items-center justify-between">
          <span
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: `${C.blue}0.6)` }}
          >
            Group
          </span>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center"
            style={{ color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.06)' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        <input
          autoFocus
          className="w-full bg-transparent font-display text-2xl font-light text-center outline-none border-b pb-2"
          style={{ color: 'var(--color-brand-text)', borderColor: `${C.blue}0.25)` }}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Group name"
        />

        <div className="flex flex-col gap-2">
          <span
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: 'var(--color-brand-text-muted)' }}
          >
            Rounds
          </span>
          <div
            className="flex items-center rounded-[40px] px-4 py-2"
            style={{ border: `2px solid ${C.blue}0.3)` }}
          >
            <button
              onClick={() => setRounds((r) => Math.max(1, r - 1))}
              className="w-9 h-9 rounded-full flex items-center justify-center text-xl font-bold active:scale-90"
              style={{ color: `${C.blue}0.8)` }}
            >−</button>
            <span
              className="flex-1 text-center font-display text-xl font-semibold tabular-nums"
              style={{ color: 'var(--color-brand-text)' }}
            >
              {rounds}
            </span>
            <button
              onClick={() => setRounds((r) => r + 1)}
              className="w-9 h-9 rounded-full flex items-center justify-center text-xl font-bold active:scale-90"
              style={{ color: `${C.blue}0.8)` }}
            >+</button>
          </div>
        </div>

        <button
          onClick={() => onConfirm({ label: label.trim() || initial.label, rounds })}
          className="w-full py-4 rounded-[40px] font-bold text-sm uppercase tracking-widest transition-all active:scale-[0.98]"
          style={{
            background: `${C.blue}0.85)`,
            color:      '#120b18',
            boxShadow:  `0 0 32px ${C.blue}0.18)`,
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

// ─── DecisionEditSheet ────────────────────────────────────────────────────────

function DecisionEditSheet({
  initial,
  onConfirm,
  onClose,
}: {
  initial:   { prompt: string; options: { id: string; label: string }[] };
  onConfirm: (v: { prompt: string; options: { id: string; label: string }[] }) => void;
  onClose:   () => void;
}) {
  const [prompt,  setPrompt]  = useState(initial.prompt);
  const [options, setOptions] = useState(initial.options);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'rgba(18,11,24,0.72)', backdropFilter: 'blur(8px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-t-[2rem] px-6 pt-5 pb-10 flex flex-col gap-5"
        style={{
          background:   'rgba(29,18,34,0.98)',
          border:       '1px solid rgba(255,255,255,0.08)',
          borderBottom: 'none',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center">
          <div className="w-10 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.15)' }} />
        </div>

        <div className="flex items-center justify-between">
          <span
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: `${C.violet}0.65)` }}
          >
            Decision
          </span>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center"
            style={{ color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.06)' }}
            aria-label="Close"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        {/* Prompt */}
        <div className="flex flex-col gap-1.5">
          <span
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: 'var(--color-brand-text-muted)' }}
          >
            Prompt
          </span>
          <input
            autoFocus
            className="w-full bg-transparent font-display text-xl font-light text-center outline-none border-b pb-2"
            style={{ color: 'var(--color-brand-text)', borderColor: `${C.violet}0.28)` }}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Feeling strong?"
          />
        </div>

        {/* Options */}
        <div className="flex flex-col gap-2">
          <span
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: 'var(--color-brand-text-muted)' }}
          >
            Options
          </span>
          {options.map((opt, i) => (
            <div key={opt.id} className="flex items-center gap-2.5">
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 tabular-nums"
                style={{ background: `${C.violet}0.12)`, color: `${C.violet}0.75)` }}
              >
                {i + 1}
              </div>
              <input
                className="flex-1 bg-transparent text-sm font-medium outline-none py-2 border-b"
                style={{ color: 'var(--color-brand-text)', borderColor: 'rgba(255,255,255,0.09)' }}
                value={opt.label}
                onChange={(e) =>
                  setOptions((prev) =>
                    prev.map((o) => (o.id === opt.id ? { ...o, label: e.target.value } : o)),
                  )
                }
                placeholder={`Option ${i + 1}`}
              />
              {options.length > 2 && (
                <button
                  onClick={() => setOptions((prev) => prev.filter((o) => o.id !== opt.id))}
                  className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                  style={{ color: 'rgba(255,132,129,0.5)', background: 'rgba(255,132,129,0.07)' }}
                  aria-label="Remove option"
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                  </svg>
                </button>
              )}
            </div>
          ))}

          <button
            onClick={() =>
              setOptions((prev) => [...prev, { id: uid(), label: `Option ${prev.length + 1}` }])
            }
            className="mt-1 flex items-center gap-2 text-xs font-bold uppercase tracking-widest transition-all active:scale-95"
            style={{ color: `${C.violet}0.65)` }}
          >
            <span
              className="w-5 h-5 rounded-full flex items-center justify-center text-sm"
              style={{ background: `${C.violet}0.1)`, border: `1px solid ${C.violet}0.2)` }}
            >+</span>
            Add option
          </button>
        </div>

        <button
          onClick={() =>
            onConfirm({
              prompt:  prompt.trim() || 'Feeling strong?',
              options: options.map((o) => ({ ...o, label: o.label.trim() || `Option` })),
            })
          }
          className="w-full py-4 rounded-[40px] font-bold text-sm uppercase tracking-widest transition-all active:scale-[0.98]"
          style={{
            background: `${C.violet}0.85)`,
            color:      '#120b18',
            boxShadow:  `0 0 32px ${C.violet}0.18)`,
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

// ─── OptionBranch ─────────────────────────────────────────────────────────────
// One branch of a DecisionItem. Renders as a labelled mini-list with its own
// drag-and-drop and an InnerFAB for adding items to the branch.

function OptionBranch({
  option,
  accent,
  decisionId,
}: {
  option:     BranchOption;
  accent:     string;
  decisionId: string;
}) {
  const ctx = useContext(BuilderCtx);

  const { listRef, getHandleProps, draggingId, dropIdx } = useDragOrder<ListItem>(
    option.children,
    (newChildren) => {
      ctx.setItems((prev) =>
        updateItemById(prev, decisionId, (it) => ({
          ...(it as DecisionItem),
          options: (it as DecisionItem).options.map((o) =>
            o.id === option.id ? { ...o, children: newChildren } : o,
          ),
        })),
      );
    },
  );

  function handleAddChild(kind: ItemKind) {
    let newItem: ListItem;
    if (kind === 'group') {
      newItem = { id: uid(), kind: 'group', label: 'Group', rounds: 3, children: [], expanded: false };
    } else if (kind === 'decision') {
      newItem = {
        id: uid(), kind: 'decision', prompt: 'Feeling strong?', expanded: false,
        options: [
          { id: uid(), label: 'Option A', children: [] },
          { id: uid(), label: 'Option B', children: [] },
        ],
      };
    } else {
      newItem = {
        id:       uid(),
        kind,
        label:    kind === 'break' ? 'Rest' : 'Exercise',
        duration: kind === 'break' ? 30 : 45,
        rounds:   1,
      };
    }
    ctx.setItems((prev) =>
      updateItemById(prev, decisionId, (it) => ({
        ...(it as DecisionItem),
        options: (it as DecisionItem).options.map((o) =>
          o.id === option.id ? { ...o, children: [...o.children, newItem] } : o,
        ),
      })),
    );
    ctx.setEditing({
      id:   newItem.id,
      type: newItem.kind === 'group' ? 'group' : newItem.kind === 'decision' ? 'decision' : 'flat',
    });
  }

  return (
    <div>
      {/* Option label pill */}
      <div className="flex items-center gap-2 mb-3">
        <div
          className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-full"
          style={{
            background: `${accent}0.1)`,
            color:      `${accent}0.85)`,
            border:     `1px solid ${accent}0.22)`,
          }}
        >
          {option.label}
        </div>
        {option.children.length === 0 && (
          <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.2)' }}>
            empty branch
          </span>
        )}
      </div>

      {/* Children list */}
      <div
        className="ml-2 pl-4"
        style={{ borderLeft: `1.5px solid ${accent}0.18)` }}
      >
        <div ref={listRef} className="flex flex-col">
          {option.children.map((child, i) => (
            <React.Fragment key={child.id}>
              <DropLine active={draggingId !== null && dropIdx === i} />
              <div
                data-id={child.id}
                style={{ marginBottom: 8, animation: `listIn 0.2s ease-out ${i * 0.04}s both` }}
              >
                {child.kind === 'group' ? (
                  <GroupContainer group={child} dragHandleProps={getHandleProps(child.id)} />
                ) : child.kind === 'decision' ? (
                  <DecisionContainer item={child} dragHandleProps={getHandleProps(child.id)} />
                ) : (
                  <ItemPill
                    item={child}
                    onEdit={() => ctx.setEditing({ id: child.id, type: 'flat' })}
                    onRemove={() => ctx.setItems((prev) => removeItemById(prev, child.id))}
                    dragHandleProps={getHandleProps(child.id)}
                  />
                )}
              </div>
            </React.Fragment>
          ))}
          <DropLine active={draggingId !== null && dropIdx >= option.children.length} />
        </div>

        <InnerFAB onAdd={handleAddChild} />
      </div>
    </div>
  );
}

// ─── DecisionContainer ────────────────────────────────────────────────────────
// Collapsible block showing the decision prompt and each option's branch list.

function DecisionContainer({
  item,
  dragHandleProps,
}: {
  item:            DecisionItem;
  dragHandleProps: React.HTMLAttributes<HTMLDivElement>;
}) {
  const ctx = useContext(BuilderCtx);

  const branchAccents = [C.green, C.amber, C.violet, C.coral, C.blue];

  function toggleExpanded(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('button')) return;
    ctx.setItems((prev) =>
      updateItemById(prev, item.id, (it) => ({
        ...(it as DecisionItem),
        expanded: !(it as DecisionItem).expanded,
      })),
    );
  }

  return (
    <div
      className="rounded-3xl"
      style={{
        background: `${C.violet}0.06)`,
        border:     `1px solid ${C.violet}0.22)`,
      }}
    >
      {/* ── Header ── */}
      <div
        className="flex items-center gap-3 px-4 py-4 cursor-pointer select-none rounded-3xl"
        onClick={toggleExpanded}
        role="button"
        aria-expanded={item.expanded}
      >
        <div onClick={(e) => e.stopPropagation()} {...dragHandleProps}>
          <DragHandle />
        </div>

        {/* Icon */}
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
          style={{ background: `${C.violet}0.14)`, color: `${C.violet}0.85)`, fontSize: '1rem' }}
        >
          ⚡
        </div>

        {/* Label */}
        <div className="flex flex-col flex-1 min-w-0 gap-0.5">
          <span
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: `${C.violet}0.55)` }}
          >
            Decision
          </span>
          <span
            className="text-sm font-semibold truncate"
            style={{ color: 'var(--color-brand-text)' }}
          >
            {item.prompt}
          </span>
        </div>

        {/* Paths count */}
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.35)' }}
        >
          {item.options.length} paths
        </span>

        {/* Edit */}
        <button
          onClick={(e) => { e.stopPropagation(); ctx.setEditing({ id: item.id, type: 'decision' }); }}
          className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-colors"
          style={{ color: `${C.violet}0.65)`, background: `${C.violet}0.1)` }}
          aria-label="Edit decision"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
          </svg>
        </button>

        {/* Chevron */}
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-transform duration-200"
          style={{
            color:      `${C.violet}0.65)`,
            background: `${C.violet}0.08)`,
            transform:  item.expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
          aria-hidden="true"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 10l5 5 5-5z" />
          </svg>
        </div>

        {/* Remove */}
        <button
          onClick={(e) => { e.stopPropagation(); ctx.setItems((prev) => removeItemById(prev, item.id)); }}
          className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
          style={{ color: 'rgba(255,132,129,0.5)', background: 'rgba(255,132,129,0.07)' }}
          aria-label="Remove decision"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>
      </div>

      {/* ── Expanded branches ── */}
      {item.expanded && (
        <div className="px-4 pb-5 pt-1 flex flex-col gap-6">
          {item.options.map((opt, i) => (
            <OptionBranch
              key={opt.id}
              option={opt}
              accent={branchAccents[i % branchAccents.length]}
              decisionId={item.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── DSLReference ─────────────────────────────────────────────────────────────

function DSLReference() {
  const REF = `exercise "Push-ups" 45s
rest "Rest" 30s
group "Circuit" x3 {
  exercise "Squats" 30s
  exercise "Lunges" 20s
  rest 15s
}
decision "Feeling strong?" {
  "Heavy sets" {
    exercise "Bench Press" 60s
  }
  "Lighter reps" {
    exercise "Push-ups" 45s
  }
}`;

  return (
    <div
      className="rounded-2xl px-4 py-4"
      style={{ background: 'rgba(35,24,38,0.5)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      <p
        className="text-[10px] font-bold uppercase tracking-widest mb-3"
        style={{ color: 'rgba(255,255,255,0.25)' }}
      >
        DSL Reference
      </p>
      <pre
        className="text-xs leading-relaxed overflow-x-auto"
        style={{
          color:      'rgba(237,228,250,0.45)',
          fontFamily: '"JetBrains Mono","Fira Code","Consolas",monospace',
          whiteSpace: 'pre',
          margin:     0,
        }}
      >
        {REF}
      </pre>
      <div className="mt-3 flex flex-wrap gap-2">
        {(['45s = 45 sec', '2m = 2 min', '1m30s = 90 sec'] as const).map((ex) => (
          <span
            key={ex}
            className="text-[10px] px-2 py-1 rounded-full"
            style={{
              background: 'rgba(169,229,187,0.07)',
              border:     '1px solid rgba(169,229,187,0.15)',
              color:      'rgba(169,229,187,0.6)',
              fontFamily: 'monospace',
            }}
          >
            {ex}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── DSLEditorPanel ───────────────────────────────────────────────────────────

function DSLEditorPanel({
  text,
  onChange,
  error,
  onCompile,
}: {
  text:      string;
  onChange:  (t: string) => void;
  error:     DSLWorkoutError | null;
  onCompile: () => void;
}) {
  const LINE_H    = 22;   // px — must match the CSS lineHeight set below
  const FONT_SZ   = 13;
  const PAD_TOP   = 12;
  const PAD_LEFT  = 44;   // space reserved for line-number gutter

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [scrollTop, setScrollTop] = React.useState(0);

  const lines        = text.split('\n');
  const errorLineIdx = error ? error.line - 1 : -1;

  return (
    <div className="flex flex-col gap-4">

      {/* ── Editor container ─────────────────────────────────────────────────── */}
      <div
        className="relative rounded-2xl overflow-hidden"
        style={{
          background:  'rgba(12,8,18,0.98)',
          border:      error
            ? '1px solid rgba(255,132,129,0.4)'
            : '1px solid rgba(255,255,255,0.1)',
          fontFamily:  '"JetBrains Mono","Fira Code","Consolas",monospace',
          fontSize:    FONT_SZ,
          lineHeight:  `${LINE_H}px`,
          transition:  'border-color 0.2s',
        }}
      >
        {/* Error-line highlight stripe */}
        {errorLineIdx >= 0 && (
          <div
            aria-hidden="true"
            style={{
              position:      'absolute',
              left:          0,
              right:         0,
              top:           PAD_TOP + errorLineIdx * LINE_H - scrollTop,
              height:        LINE_H,
              background:    'rgba(255,132,129,0.12)',
              pointerEvents: 'none',
              zIndex:        1,
            }}
          />
        )}

        {/* Line numbers — scroll-synced via translateY */}
        <div
          aria-hidden="true"
          style={{
            position:      'absolute',
            left:          0,
            top:           0,
            width:         PAD_LEFT,
            bottom:        0,
            paddingTop:    PAD_TOP,
            overflow:      'hidden',
            pointerEvents: 'none',
            userSelect:    'none',
            zIndex:        2,
          }}
        >
          {lines.map((_, i) => (
            <div
              key={i}
              style={{
                height:       LINE_H,
                lineHeight:   `${LINE_H}px`,
                textAlign:    'right',
                paddingRight: 10,
                fontSize:     11,
                fontWeight:   i === errorLineIdx ? 600 : 400,
                color:        i === errorLineIdx
                  ? 'rgba(255,132,129,0.8)'
                  : 'rgba(255,255,255,0.18)',
                transform:    `translateY(${-scrollTop}px)`,
              }}
            >
              {i + 1}
            </div>
          ))}
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          placeholder={
            `exercise "Push-ups" 45s\n` +
            `rest 30s\n` +
            `group "Circuit" x3 {\n` +
            `  exercise "Squats" 30s\n` +
            `}`
          }
          style={{
            display:       'block',
            position:      'relative',
            zIndex:        3,
            width:         '100%',
            minHeight:     220,
            maxHeight:     420,
            paddingTop:    PAD_TOP,
            paddingBottom: 16,
            paddingLeft:   PAD_LEFT,
            paddingRight:  16,
            background:    'transparent',
            color:         'rgba(237,228,250,0.9)',
            border:        'none',
            outline:       'none',
            resize:        'vertical',
            fontFamily:    'inherit',
            fontSize:      'inherit',
            lineHeight:    'inherit',
            caretColor:    'rgba(169,229,187,0.9)',
            overflowY:     'auto',
            tabSize:       2,
          }}
        />
      </div>

      {/* ── Error banner ─────────────────────────────────────────────────────── */}
      {error && (
        <div
          className="rounded-xl px-4 py-3"
          style={{
            background: 'rgba(255,132,129,0.08)',
            border:     '1px solid rgba(255,132,129,0.25)',
            color:      'rgba(255,132,129,0.85)',
            fontFamily: '"JetBrains Mono","Fira Code","Consolas",monospace',
            fontSize:   12,
          }}
        >
          <div className="font-bold mb-1.5" style={{ fontFamily: 'inherit' }}>
            ✗  Line {error.line}: {error.message}
          </div>
          <pre
            style={{
              margin:     0,
              whiteSpace: 'pre-wrap',
              wordBreak:  'break-word',
              opacity:    0.75,
              fontSize:   11,
            }}
          >
            {`  ${error.sourceLine}`}{'\n'}
            {`  ${' '.repeat(Math.max(0, error.col - 1))}^`}
          </pre>
        </div>
      )}

      {/* ── Compile button ────────────────────────────────────────────────────── */}
      <button
        onClick={onCompile}
        className="w-full py-4 rounded-[40px] font-bold text-sm uppercase tracking-widest transition-all active:scale-[0.98]"
        style={{
          background: 'var(--color-brand-primary)',
          color:      '#120b18',
          boxShadow:  '0 0 40px rgba(169,229,187,0.22)',
        }}
      >
        Compile → Visual
      </button>

      {/* ── Reference ─────────────────────────────────────────────────────────── */}
      <DSLReference />
    </div>
  );
}

// ─── GlobalFAB ────────────────────────────────────────────────────────────────

function GlobalFAB({
  open,
  onToggle,
  onAdd,
}: {
  open:     boolean;
  onToggle: () => void;
  onAdd:    (kind: ItemKind) => void;
}) {
  const items: { kind: ItemKind; label: string; bg: string; icon: string }[] = [
    { kind: 'exercise', label: 'Exercise', bg: `${C.green}0.9)`,   icon: '💪' },
    { kind: 'break',    label: 'Break',    bg: `${C.amber}0.9)`,   icon: '⏱' },
    { kind: 'group',    label: 'Group',    bg: `${C.blue}0.85)`,   icon: '📁' },
    { kind: 'decision', label: 'Decision', bg: `${C.violet}0.85)`, icon: '⚡' },
  ];

  return (
    <div className="fixed bottom-8 right-5 z-40 flex flex-col items-end gap-3">
      {/* Sub-items */}
      <div
        className="flex flex-col items-end gap-3 transition-all duration-300"
        style={{
          opacity:       open ? 1 : 0,
          transform:     open ? 'translateY(0)' : 'translateY(16px)',
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        {items.map(({ kind, label, bg, icon }) => (
          <button
            key={kind}
            onClick={() => { onAdd(kind); onToggle(); }}
            className="flex items-center gap-3 transition-all active:scale-[0.95]"
          >
            <span
              className="text-sm font-bold"
              style={{ color: 'rgba(237,228,250,0.85)', textShadow: '0 2px 6px rgba(0,0,0,0.5)' }}
            >
              {label}
            </span>
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-base font-bold"
              style={{ background: bg, boxShadow: '0 4px 14px rgba(0,0,0,0.35)', color: '#120b18' }}
            >
              {icon}
            </div>
          </button>
        ))}
      </div>

      {/* Main button */}
      <button
        onClick={onToggle}
        className="w-14 h-14 rounded-full flex items-center justify-center text-2xl font-bold transition-all duration-300 active:scale-95"
        style={{
          background: open ? `${C.coral}0.9)` : `${C.amber}0.9)`,
          color:      '#120b18',
          boxShadow:  open
            ? `0 4px 24px ${C.coral}0.35)`
            : `0 4px 24px ${C.amber}0.35)`,
          transform:  open ? 'rotate(135deg)' : 'rotate(0deg)',
        }}
        aria-label={open ? 'Close menu' : 'Add item'}
      >
        +
      </button>
    </div>
  );
}

// ─── SummaryBar ───────────────────────────────────────────────────────────────

function SummaryBar({ items }: { items: ListItem[] }) {
  const { totalSec, exercises, decisions } = calcTotals(items);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const durLabel = m > 0 ? `${m}m${s > 0 ? ` ${s}s` : ''}` : `${s}s`;

  const stats = [
    { label: 'Exercises', value: String(exercises),                           color: 'var(--color-brand-primary)' },
    { label: 'Duration',  value: durLabel,                                    color: 'var(--color-brand-primary)' },
    { label: 'Groups',    value: String(items.filter((i) => i.kind === 'group').length), color: 'var(--color-brand-primary)' },
    ...(decisions > 0
      ? [{ label: 'Decisions', value: String(decisions), color: `${C.violet}0.9)` }]
      : []),
  ];

  return (
    <div
      className="flex items-center justify-around rounded-[40px] py-3 px-5"
      style={{ background: 'rgba(35,24,38,0.7)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      {stats.map(({ label, value, color }) => (
        <div key={label} className="flex flex-col items-center gap-0.5">
          <span
            className="font-display text-lg font-bold tabular-nums"
            style={{ color }}
          >
            {value}
          </span>
          <span
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: 'var(--color-brand-text-muted)' }}
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function CustomTimerScreen() {
  const startSession      = useTimerStore((s) => s.startSession);
  const startGraphSession = useTimerStore((s) => s.startGraphSession);

  const [items,    setItems]    = useState<ListItem[]>([]);
  const [fabOpen,  setFabOpen]  = useState(false);
  const [error,    setError]    = useState('');
  const [editing,  setEditing]  = useState<EditTarget>(null);
  const [viewMode, setViewMode] = useState<'visual' | 'code'>('visual');
  const [dslText,  setDslText]  = useState('');
  const [dslError, setDslError] = useState<DSLWorkoutError | null>(null);

  // Top-level drag
  const { listRef, getHandleProps, draggingId, dropIdx } = useDragOrder<ListItem>(
    items,
    setItems,
  );

  // Context value — stable object via useMemo is not needed here since
  // setItems is stable (from useState) and setEditing is an inline fn
  const ctxValue: BuilderCtxValue = { setItems, setEditing };

  // ── Add items ──────────────────────────────────────────────────────────────

  function handleAdd(kind: ItemKind) {
    setError('');
    let newItem: ListItem;
    if (kind === 'group') {
      newItem = { id: uid(), kind: 'group', label: 'Group', rounds: 3, children: [], expanded: false };
    } else if (kind === 'decision') {
      newItem = {
        id: uid(), kind: 'decision', prompt: 'Feeling strong?', expanded: false,
        options: [
          { id: uid(), label: 'Heavy sets',   children: [] },
          { id: uid(), label: 'Lighter reps', children: [] },
        ],
      };
    } else {
      newItem = {
        id:       uid(),
        kind,
        label:    kind === 'break' ? 'Rest' : `Exercise ${items.filter((i) => i.kind === 'exercise').length + 1}`,
        duration: kind === 'break' ? 30 : 45,
        rounds:   1,
      };
    }
    setItems((prev) => [...prev, newItem]);
    setEditing({
      id:   newItem.id,
      type: newItem.kind === 'group' ? 'group' : newItem.kind === 'decision' ? 'decision' : 'flat',
    });
    setFabOpen(false);
  }

  // ── Confirm edits ──────────────────────────────────────────────────────────

  function handleFlatConfirm(v: { label: string; duration: number; rounds: number }) {
    if (!editing || editing.type !== 'flat') return;
    setItems((prev) => updateItemById(prev, editing.id, (item) => ({ ...item, ...v })));
    setEditing(null);
  }

  function handleGroupConfirm(v: { label: string; rounds: number }) {
    if (!editing || editing.type !== 'group') return;
    setItems((prev) => updateItemById(prev, editing.id, (item) => ({ ...item, ...v })));
    setEditing(null);
  }

  function handleDecisionConfirm(v: { prompt: string; options: { id: string; label: string }[] }) {
    if (!editing || editing.type !== 'decision') return;
    setItems((prev) =>
      updateItemById(prev, editing.id, (item) => {
        const dec = item as DecisionItem;
        // Merge new option labels; preserve existing children; add new options with empty children
        const newOptions = v.options.map((opt) => {
          const existing = dec.options.find((o) => o.id === opt.id);
          return existing ? { ...existing, label: opt.label } : { id: opt.id, label: opt.label, children: [] };
        });
        return { ...dec, prompt: v.prompt, options: newOptions };
      }),
    );
    setEditing(null);
  }

  // ── Resolve editing target ─────────────────────────────────────────────────

  const flatEditTarget: FlatItem | null = (() => {
    if (!editing || editing.type !== 'flat') return null;
    const found = findItemById(items, editing.id);
    return found && (found.kind === 'exercise' || found.kind === 'break') ? (found as FlatItem) : null;
  })();

  const groupEditTarget: { label: string; rounds: number } | null = (() => {
    if (!editing || editing.type !== 'group') return null;
    const found = findItemById(items, editing.id);
    return found && found.kind === 'group' ? { label: found.label, rounds: found.rounds } : null;
  })();

  const decisionEditTarget: { prompt: string; options: { id: string; label: string }[] } | null = (() => {
    if (!editing || editing.type !== 'decision') return null;
    const found = findItemById(items, editing.id);
    return found?.kind === 'decision'
      ? { prompt: found.prompt, options: found.options.map((o) => ({ id: o.id, label: o.label })) }
      : null;
  })();

  // ── DSL view mode ──────────────────────────────────────────────────────────

  function switchToCode() {
    const serialized = serializeDSLWorkout(items);
    setDslText(serialized || '');
    setDslError(null);
    setFabOpen(false);
    setViewMode('code');
  }

  function switchToVisual() {
    const trimmed = dslText.trim();
    if (!trimmed) {
      // Empty editor — switch to visual with existing items intact
      setDslError(null);
      setViewMode('visual');
      return;
    }
    setDslError(null);
    try {
      const parsed = parseDSLWorkout(dslText);
      setItems(parsed);
      setViewMode('visual');
    } catch (e) {
      if (e instanceof DSLWorkoutError) setDslError(e);
    }
  }

  // ── Start session ──────────────────────────────────────────────────────────

  function handleStart() {
    if (items.length === 0) { setError('Add at least one exercise to start.'); return; }
    if (hasDecision(items)) {
      const graph = toWorkoutGraph(items);
      if (graph.nodes.size === 0) { setError('Add at least one exercise to a branch to start.'); return; }
      startGraphSession(graph);
    } else {
      const blocks = toWorkoutBlocks(items);
      startSession(blocks);
    }
  }

  // ── Close FAB on outside tap ───────────────────────────────────────────────

  useEffect(() => {
    if (!fabOpen) return;
    const handler = (e: PointerEvent) => {
      const fab = document.getElementById('fab-root');
      if (fab && !fab.contains(e.target as Node)) setFabOpen(false);
    };
    window.addEventListener('pointerdown', handler, { capture: true });
    return () => window.removeEventListener('pointerdown', handler, { capture: true });
  }, [fabOpen]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <BuilderCtx.Provider value={ctxValue}>
      <div className="min-h-screen pt-24 pb-36 px-5 max-w-lg mx-auto flex flex-col gap-5">
        <style>{`
          @keyframes listIn {
            from { opacity:0; transform:translateY(10px); }
            to   { opacity:1; transform:translateY(0); }
          }
        `}</style>

        {/* Header + mode toggle */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1
              className="font-display text-2xl font-bold tracking-tight"
              style={{ color: 'var(--color-brand-text)' }}
            >
              Custom Timer
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--color-brand-text-muted)' }}>
              {viewMode === 'visual'
                ? <>Tap <span style={{ color: 'rgba(254,178,70,0.9)' }}>+</span> to add exercises, breaks, or groups.</>
                : 'Write your workout in DSL syntax, then compile.'}
            </p>
          </div>

          {/* Visual / Code tab toggle */}
          <div
            className="flex shrink-0 rounded-xl overflow-hidden"
            style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)' }}
          >
            {(['visual', 'code'] as const).map((m) => (
              <button
                key={m}
                onClick={() => m === 'code' ? switchToCode() : switchToVisual()}
                className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all duration-150"
                style={{
                  background: viewMode === m ? 'rgba(169,229,187,0.15)' : 'transparent',
                  color:      viewMode === m ? 'var(--color-brand-primary)' : 'rgba(255,255,255,0.35)',
                }}
              >
                {m === 'visual' ? 'Visual' : 'Code'}
              </button>
            ))}
          </div>
        </div>

        {/* ── Code view ──────────────────────────────────────────────────────── */}
        {viewMode === 'code' && (
          <DSLEditorPanel
            text={dslText}
            onChange={(t) => { setDslText(t); setDslError(null); }}
            error={dslError}
            onCompile={switchToVisual}
          />
        )}

        {/* ── Visual view ─────────────────────────────────────────────────────── */}
        {viewMode === 'visual' && (
          <>
            {/* Empty state */}
            {items.length === 0 && (
              <div
                className="rounded-[2rem] py-16 flex flex-col items-center gap-3"
                style={{ background: 'rgba(35,24,38,0.5)', border: '1px dashed rgba(255,255,255,0.1)' }}
              >
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center text-2xl"
                  style={{ background: 'rgba(254,178,70,0.1)', border: '1px solid rgba(254,178,70,0.2)' }}
                >
                  +
                </div>
                <p className="text-sm font-medium" style={{ color: 'var(--color-brand-text-muted)' }}>
                  Press the <span style={{ color: 'rgba(254,178,70,0.9)' }}>+</span> button to get started
                </p>
              </div>
            )}

            {/* Item list */}
            {items.length > 0 && (
              <div ref={listRef} className="flex flex-col">
                {items.map((item, i) => (
                  <React.Fragment key={item.id}>
                    <DropLine active={draggingId !== null && dropIdx === i} />
                    <div
                      data-id={item.id}
                      style={{ marginBottom: 12, animation: `listIn 0.22s ease-out ${i * 0.04}s both` }}
                    >
                      {item.kind === 'group' ? (
                        <GroupContainer
                          group={item}
                          dragHandleProps={getHandleProps(item.id)}
                        />
                      ) : item.kind === 'decision' ? (
                        <DecisionContainer
                          item={item}
                          dragHandleProps={getHandleProps(item.id)}
                        />
                      ) : (
                        <ItemPill
                          item={item}
                          onEdit={() => setEditing({ id: item.id, type: 'flat' })}
                          onRemove={() => setItems((prev) => removeItemById(prev, item.id))}
                          dragHandleProps={getHandleProps(item.id)}
                        />
                      )}
                    </div>
                  </React.Fragment>
                ))}
                <DropLine active={draggingId !== null && dropIdx >= items.length} />
              </div>
            )}

            {/* Summary + Start */}
            {items.length > 0 && (
              <>
                <SummaryBar items={items} />

                {error && (
                  <p className="text-xs text-center" style={{ color: 'rgba(255,132,129,0.85)' }}>
                    {error}
                  </p>
                )}

                <button
                  onClick={handleStart}
                  className="w-full py-4 rounded-[40px] font-bold text-sm uppercase tracking-widest transition-all active:scale-[0.98]"
                  style={{
                    background: 'var(--color-brand-primary)',
                    color:      '#120b18',
                    boxShadow:  '0 0 40px rgba(169,229,187,0.22)',
                  }}
                >
                  Start Workout
                </button>
              </>
            )}

            {/* Global FAB */}
            <div id="fab-root">
              <GlobalFAB
                open={fabOpen}
                onToggle={() => setFabOpen((o) => !o)}
                onAdd={handleAdd}
              />
            </div>

            {/* Edit sheet — flat item */}
            {editing?.type === 'flat' && flatEditTarget && (
              <EditSheet
                initial={flatEditTarget}
                onConfirm={handleFlatConfirm}
                onClose={() => setEditing(null)}
              />
            )}

            {/* Edit sheet — group */}
            {editing?.type === 'group' && groupEditTarget && (
              <GroupEditSheet
                initial={groupEditTarget}
                onConfirm={handleGroupConfirm}
                onClose={() => setEditing(null)}
              />
            )}

            {/* Edit sheet — decision */}
            {editing?.type === 'decision' && decisionEditTarget && (
              <DecisionEditSheet
                initial={decisionEditTarget}
                onConfirm={handleDecisionConfirm}
                onClose={() => setEditing(null)}
              />
            )}
          </>
        )}
      </div>
    </BuilderCtx.Provider>
  );
}
