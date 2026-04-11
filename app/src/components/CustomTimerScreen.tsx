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

// ─── Types ────────────────────────────────────────────────────────────────────

type ItemKind = 'exercise' | 'break' | 'group';

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

type ListItem = FlatItem | GroupItem;

type EditTarget = { id: string; type: 'flat' | 'group' } | null;

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
 * Recursively convert the item tree into WorkoutBlocks, preserving group
 * hierarchy so that rounds repeat the whole group (work → rest → repeat)
 * instead of repeating each child independently.
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
    } else {
      const stepType = item.kind === 'break' ? 'rest' as const : 'exercise' as const;
      const leaf: WorkoutBlock = {
        id:          item.id,
        type:        stepType,
        label:       item.label,
        duration_ms: item.duration * 1000,
      };
      if (item.rounds > 1) {
        // Wrap in a circuit so the step repeats `rounds` times on its own
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

function calcTotals(
  items: ListItem[],
  multiplier = 1,
): { totalSec: number; exercises: number; items: number } {
  let totalSec = 0;
  let exercises = 0;
  let itemCount = 0;
  for (const item of items) {
    if (item.kind === 'group') {
      const sub = calcTotals(item.children, multiplier * item.rounds);
      totalSec  += sub.totalSec;
      exercises += sub.exercises;
      itemCount += sub.items;
    } else {
      itemCount++;
      if (item.kind === 'exercise') exercises++;
      totalSec += item.duration * multiplier * item.rounds;
    }
  }
  return { totalSec, exercises, items: itemCount };
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface BuilderCtxValue {
  setItems:   React.Dispatch<React.SetStateAction<ListItem[]>>;
  setEditing: (target: EditTarget) => void;
}
const BuilderCtx = createContext<BuilderCtxValue>(null!);

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  green: 'rgba(169,229,187,',
  amber: 'rgba(254,178,70,',
  coral: 'rgba(255,132,129,',
  blue:  'rgba(88,166,255,',
} as const;

// ─── useDragOrder ─────────────────────────────────────────────────────────────
//
// Pointer-capture drag with:
//  • floating effect (box-shadow + scale) applied directly to the DOM element
//  • blue drop-indicator line at the target gap
//  • reorder committed only on pointerUp (no layout shifts during drag)

function useDragOrder<T extends { id: string }>(
  items: T[],
  onReorder: (next: T[]) => void,
) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndex,  setDropIndex]  = useState<number>(-1);

  // Refs track values that must be read in callbacks without re-memoizing
  const dragRef      = useRef<{ id: string; origIdx: number; startY: number } | null>(null);
  const dropIdxRef   = useRef(-1);
  const listRef      = useRef<HTMLDivElement>(null);

  const getHandleProps = useCallback(
    (id: string): React.HTMLAttributes<HTMLDivElement> => ({
      onPointerDown(e) {
        e.preventDefault();
        const origIdx = items.findIndex((it) => it.id === id);
        if (origIdx === -1) return;
        dragRef.current = { id, origIdx, startY: e.clientY };
        dropIdxRef.current = origIdx;
        setDraggingId(id);
        setDropIndex(origIdx);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      },

      onPointerMove(e) {
        if (!dragRef.current || dragRef.current.id !== id) return;
        const list = listRef.current;
        if (!list) return;

        const dy = e.clientY - dragRef.current.startY;

        // Only children that have data-id (item wrappers, not drop lines etc.)
        const children = (Array.from(list.children) as HTMLElement[]).filter(
          (el) => el.dataset.id,
        );

        // Apply floating style to the dragged element
        const dragEl = children.find((el) => el.dataset.id === id);
        if (dragEl) {
          // No transition on transform — must track cursor instantly
          dragEl.style.transform  = `translateY(${dy}px) scale(1.04)`;
          dragEl.style.zIndex     = '50';
          dragEl.style.position   = 'relative';
          dragEl.style.opacity    = '0.96';
          dragEl.style.boxShadow  =
            '0 36px 90px rgba(0,0,0,0.8), 0 0 0 2px rgba(88,166,255,0.7), 0 0 60px rgba(88,166,255,0.12)';
          dragEl.style.transition = 'box-shadow 0.1s, opacity 0.1s';
        }

        // Dim all other items so the floating card pops
        children.forEach((el) => {
          if (el.dataset.id !== id) {
            el.style.opacity    = '0.4';
            el.style.transition = 'opacity 0.18s';
          }
        });

        // Calculate drop index based on pointer vs. non-dragging items' centres
        let newDropIdx = items.length;
        for (let i = 0; i < children.length; i++) {
          const el = children[i];
          if (el.dataset.id === id) continue;
          const r = el.getBoundingClientRect();
          if (e.clientY < r.top + r.height / 2) {
            newDropIdx = i;
            break;
          }
        }

        if (newDropIdx !== dropIdxRef.current) {
          dropIdxRef.current = newDropIdx;
          setDropIndex(newDropIdx);
        }
      },

      onPointerUp() {
        if (!dragRef.current || dragRef.current.id !== id) return;

        // Reset visual styles on all elements
        const list = listRef.current;
        if (list) {
          const children = (Array.from(list.children) as HTMLElement[]).filter(
            (el) => el.dataset.id,
          );
          children.forEach((el) => {
            el.style.transform  = '';
            el.style.zIndex     = '';
            el.style.position   = '';
            el.style.boxShadow  = '';
            el.style.opacity    = '';
            el.style.transition = '';
          });
        }

        // Commit reorder
        const origIdx  = dragRef.current.origIdx;
        let   finalIdx = dropIdxRef.current;
        // Removing origIdx shifts subsequent positions down by 1
        if (finalIdx > origIdx) finalIdx--;

        dragRef.current = null;
        setDraggingId(null);
        setDropIndex(-1);
        dropIdxRef.current = -1;

        if (finalIdx !== origIdx && finalIdx >= 0 && finalIdx < items.length) {
          const next = [...items];
          const [moved] = next.splice(origIdx, 1);
          next.splice(finalIdx, 0, moved);
          onReorder(next);
        }
      },
    }),
    [items, onReorder],
  );

  return { listRef, getHandleProps, draggingId, dropIndex };
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
    listRef:    childListRef,
    getHandleProps: childHandleProps,
    draggingId: childDraggingId,
    dropIndex:  childDropIdx,
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
    const newItem: ListItem =
      kind === 'group'
        ? { id: uid(), kind: 'group', label: 'Group', rounds: 3, children: [], expanded: true }
        : {
            id:       uid(),
            kind,
            label:    kind === 'break' ? 'Rest' : 'Exercise',
            duration: kind === 'break' ? 30 : 45,
            rounds:   1,
          };
    ctx.setItems((prev) => addChildToGroup(prev, group.id, newItem));
    ctx.setEditing({ id: newItem.id, type: newItem.kind === 'group' ? 'group' : 'flat' });
  }

  const childCount = group.children.length;

  return (
    <div
      className="rounded-3xl"
      style={{
        background: `${C.blue}0.06)`,
        border:     `1px solid ${C.blue}0.22)`,
        // Whole card is a click zone when collapsed; just header when expanded
        cursor: !group.expanded ? 'pointer' : 'default',
      }}
      onClick={!group.expanded ? toggleExpanded : undefined}
    >
      {/* ── Header row — always clickable to toggle ── */}
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
            {group.children.length === 0 ? (
              <p
                className="text-xs text-center py-4 rounded-2xl"
                style={{
                  color:      'rgba(255,255,255,0.2)',
                  background: 'rgba(255,255,255,0.02)',
                  border:     '1px dashed rgba(255,255,255,0.08)',
                }}
              >
                Tap + below to add items inside this group
              </p>
            ) : (
              <div ref={childListRef} className="flex flex-col">
                {group.children.map((child, i) => (
                  <React.Fragment key={child.id}>
                    <DropLine active={childDraggingId !== null && childDropIdx === i} />
                    <div data-id={child.id} style={{ marginBottom: 8 }}>
                      {child.kind === 'group' ? (
                        <GroupContainer
                          group={child}
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
            )}

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
    { kind: 'exercise', label: 'Exercise', bg: `${C.green}0.9)`,  icon: '💪' },
    { kind: 'break',    label: 'Break',    bg: `${C.amber}0.9)`,  icon: '⏱' },
    { kind: 'group',    label: 'Group',    bg: `${C.blue}0.85)`,  icon: '📁' },
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
  const { totalSec, exercises } = calcTotals(items);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const durLabel = m > 0 ? `${m}m${s > 0 ? ` ${s}s` : ''}` : `${s}s`;

  return (
    <div
      className="flex items-center justify-around rounded-[40px] py-3 px-5"
      style={{ background: 'rgba(35,24,38,0.7)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      {[
        { label: 'Exercises', value: String(exercises) },
        { label: 'Duration',  value: durLabel },
        { label: 'Groups',    value: String(items.filter((i) => i.kind === 'group').length) },
      ].map(({ label, value }) => (
        <div key={label} className="flex flex-col items-center gap-0.5">
          <span
            className="font-display text-lg font-bold tabular-nums"
            style={{ color: 'var(--color-brand-primary)' }}
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
  const startSession = useTimerStore((s) => s.startSession);

  const [items,   setItems]   = useState<ListItem[]>([]);
  const [fabOpen, setFabOpen] = useState(false);
  const [error,   setError]   = useState('');
  const [editing, setEditing] = useState<EditTarget>(null);

  // Top-level drag
  const { listRef, getHandleProps, draggingId, dropIndex } = useDragOrder<ListItem>(
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
      newItem = { id: uid(), kind: 'group', label: 'Group', rounds: 3, children: [], expanded: true };
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
    setEditing({ id: newItem.id, type: newItem.kind === 'group' ? 'group' : 'flat' });
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

  // ── Resolve editing target ─────────────────────────────────────────────────

  const flatEditTarget: FlatItem | null = (() => {
    if (!editing || editing.type !== 'flat') return null;
    const found = findItemById(items, editing.id);
    return found && found.kind !== 'group' ? (found as FlatItem) : null;
  })();

  const groupEditTarget: { label: string; rounds: number } | null = (() => {
    if (!editing || editing.type !== 'group') return null;
    const found = findItemById(items, editing.id);
    return found && found.kind === 'group' ? { label: found.label, rounds: found.rounds } : null;
  })();

  // ── Start session ──────────────────────────────────────────────────────────

  function handleStart() {
    if (items.length === 0) { setError('Add at least one exercise to start.'); return; }
    const blocks = toWorkoutBlocks(items);
    startSession(blocks);
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

        {/* Header */}
        <div>
          <h1
            className="font-display text-2xl font-bold tracking-tight"
            style={{ color: 'var(--color-brand-text)' }}
          >
            Custom Timer
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-brand-text-muted)' }}>
            Tap <span style={{ color: 'rgba(254,178,70,0.9)' }}>+</span> to add exercises, breaks, or groups.
          </p>
        </div>

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
          <>
            <div ref={listRef} className="flex flex-col">
              {items.map((item, i) => (
                <React.Fragment key={item.id}>
                  <DropLine active={draggingId !== null && dropIndex === i} />
                  <div
                    data-id={item.id}
                    style={{ marginBottom: 12, animation: `listIn 0.22s ease-out ${i * 0.04}s both` }}
                  >
                    {item.kind === 'group' ? (
                      <GroupContainer
                        group={item}
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
              <DropLine active={draggingId !== null && dropIndex >= items.length} />
            </div>
          </>
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
      </div>
    </BuilderCtx.Provider>
  );
}
