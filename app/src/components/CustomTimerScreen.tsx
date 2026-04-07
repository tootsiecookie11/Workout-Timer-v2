import { useState } from 'react';
import { useTimerStore } from '../store/timerStore';
import type { CustomInterval } from '../engine/types';

function generateId() {
  return `ci_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function msToSec(ms: number): number {
  return ms / 1000;
}

function secToMs(sec: number): number {
  return sec * 1000;
}

interface IntervalCardProps {
  interval: CustomInterval;
  onUpdate: (id: string, patch: Partial<CustomInterval>) => void;
  onRemove: (id: string) => void;
}

function IntervalCard({ interval, onUpdate, onRemove }: IntervalCardProps) {
  return (
    <div
      className="rounded-2xl p-5 space-y-4"
      style={{
        background: 'rgba(35,24,38,0.8)',
        border: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      {/* Label + remove */}
      <div className="flex items-center gap-3">
        <input
          className="flex-1 bg-transparent font-display text-base font-medium outline-none border-b pb-1 transition-colors"
          style={{
            color: 'var(--color-brand-text)',
            borderColor: 'rgba(255,255,255,0.12)',
          }}
          value={interval.label}
          onChange={(e) => onUpdate(interval.id, { label: e.target.value })}
          placeholder="Exercise name"
          aria-label="Exercise name"
        />
        <button
          onClick={() => onRemove(interval.id)}
          className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-colors"
          style={{ color: 'var(--color-brand-tertiary)', background: 'rgba(255,132,129,0.08)' }}
          aria-label="Remove interval"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>
      </div>

      {/* Work / Rest / Rounds */}
      <div className="grid grid-cols-3 gap-3">
        {(
          [
            { field: 'work_ms' as const, label: 'Work', unit: 's', color: 'var(--color-brand-primary)' },
            { field: 'rest_ms' as const, label: 'Rest', unit: 's', color: 'var(--color-brand-secondary)' },
            { field: 'rounds' as const, label: 'Rounds', unit: '×', color: 'var(--color-brand-text-muted)' },
          ] as const
        ).map(({ field, label, unit, color }) => (
          <label key={field} className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color }}>
              {label}
            </span>
            <div
              className="flex items-center rounded-xl px-3 py-2 gap-1"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <input
                type="number"
                min={field === 'rounds' ? 1 : 0}
                className="flex-1 w-0 bg-transparent font-display text-base tabular-nums outline-none"
                style={{ color: 'var(--color-brand-text)' }}
                value={field === 'work_ms' || field === 'rest_ms' ? msToSec(interval[field]) : interval[field]}
                onChange={(e) => {
                  const raw = parseFloat(e.target.value) || 0;
                  const val = field === 'work_ms' || field === 'rest_ms' ? secToMs(raw) : Math.max(1, Math.round(raw));
                  onUpdate(interval.id, { [field]: val });
                }}
                aria-label={label}
              />
              <span className="text-xs" style={{ color: 'var(--color-brand-text-muted)' }}>{unit}</span>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

export default function CustomTimerScreen() {
  const customIntervals = useTimerStore((s) => s.customIntervals);
  const addCustomInterval = useTimerStore((s) => s.addCustomInterval);
  const removeCustomInterval = useTimerStore((s) => s.removeCustomInterval);
  const updateCustomInterval = useTimerStore((s) => s.updateCustomInterval);
  const startSession = useTimerStore((s) => s.startSession);
  const [error, setError] = useState('');

  const handleAdd = () => {
    addCustomInterval({
      id: generateId(),
      label: `Exercise ${customIntervals.length + 1}`,
      work_ms: 40_000,
      rest_ms: 20_000,
      rounds: 3,
    });
    setError('');
  };

  const handleStart = () => {
    if (customIntervals.length === 0) {
      setError('Add at least one exercise to start.');
      return;
    }
    const totalWork = customIntervals.reduce((sum, i) => sum + i.work_ms * i.rounds, 0);
    if (totalWork === 0) {
      setError('Work duration must be greater than 0.');
      return;
    }
    setError('');
    startSession();
  };

  // Summary totals
  const totalSteps = customIntervals.reduce((sum, i) => sum + i.rounds * (i.rest_ms > 0 ? 2 : 1), 0);
  const totalMs = customIntervals.reduce((sum, i) => sum + (i.work_ms + i.rest_ms) * i.rounds, 0);
  const totalMin = Math.round(totalMs / 60_000);

  return (
    <div className="min-h-screen pt-24 pb-10 px-5 max-w-lg mx-auto flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1
          className="font-display text-2xl font-bold tracking-tight"
          style={{ color: 'var(--color-brand-text)' }}
        >
          Build Your Timer
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-brand-text-muted)' }}>
          Add exercises, set work/rest durations, and go.
        </p>
      </div>

      {/* Intervals */}
      <div className="space-y-3">
        {customIntervals.length === 0 && (
          <div
            className="rounded-2xl py-12 flex flex-col items-center gap-3"
            style={{
              background: 'rgba(35,24,38,0.5)',
              border: '1px dashed rgba(255,255,255,0.1)',
              color: 'var(--color-brand-text-muted)',
            }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" opacity="0.4">
              <path d="M13 7h-2v4H7v2h4v4h2v-4h4v-2h-4V7zm-1-5C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
            </svg>
            <p className="text-sm font-medium">No exercises yet</p>
          </div>
        )}
        {customIntervals.map((interval) => (
          <IntervalCard
            key={interval.id}
            interval={interval}
            onUpdate={updateCustomInterval}
            onRemove={removeCustomInterval}
          />
        ))}
      </div>

      {/* Add button */}
      <button
        onClick={handleAdd}
        className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl font-bold text-sm uppercase tracking-widest transition-all duration-200 active:scale-98"
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px dashed rgba(255,255,255,0.14)',
          color: 'var(--color-brand-text-muted)',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
        </svg>
        Add Exercise
      </button>

      {/* Summary bar */}
      {customIntervals.length > 0 && (
        <div
          className="flex items-center justify-around rounded-2xl py-4"
          style={{
            background: 'rgba(35,24,38,0.7)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {[
            { label: 'Exercises', value: customIntervals.length },
            { label: 'Steps', value: totalSteps },
            { label: 'Est. Duration', value: `~${totalMin}m` },
          ].map(({ label, value }) => (
            <div key={label} className="flex flex-col items-center gap-1">
              <span className="font-display text-xl font-bold" style={{ color: 'var(--color-brand-text)' }}>
                {value}
              </span>
              <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--color-brand-text-muted)' }}>
                {label}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-sm text-center" style={{ color: 'var(--color-brand-tertiary)' }}>
          {error}
        </p>
      )}

      {/* Start CTA */}
      <button
        onClick={handleStart}
        disabled={customIntervals.length === 0}
        className="w-full py-4 rounded-2xl font-bold text-base uppercase tracking-widest transition-all duration-300 active:scale-98"
        style={
          customIntervals.length > 0
            ? {
                background: 'var(--color-brand-primary)',
                color: '#120b18',
                boxShadow: '0 0 40px rgba(169,229,187,0.3)',
              }
            : {
                background: 'rgba(169,229,187,0.08)',
                color: 'rgba(169,229,187,0.3)',
                cursor: 'not-allowed',
              }
        }
      >
        Start Workout
      </button>
    </div>
  );
}
