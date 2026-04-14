/**
 * exportVault.ts — Data Export Layer (PRD §5.x — data ownership)
 *
 * Pure serialization helpers with zero React / DOM dependencies (except the
 * final downloadVault() which triggers a browser anchor-click).
 *
 * Three supported formats:
 *   • JSON     — structured backup; machine-readable, developer-friendly
 *   • CSV      — row-per-session; works in Excel, Google Sheets, Numbers
 *   • Markdown — rich training log with YAML front matter (Obsidian / Notion)
 */

import { classifyFatigue } from '../engine/fatigueEngine';
import type { SessionRecord } from '../engine/fatigueEngine';
import type { CustomInterval } from '../engine/types';

// ─── Public types ─────────────────────────────────────────────────────────────

export type ExportFormat = 'json' | 'csv' | 'markdown';

/**
 * All user-owned data that can be exported.
 * Assembled by the caller (SettingsDrawer) from Zustand stores.
 */
export interface ExportPayload {
  /** Session records persisted in localStorage (up to 20). */
  sessionHistory:  SessionRecord[];
  /** Custom interval presets built by the user. */
  customIntervals: CustomInterval[];
  /** Current weighted fatigue score (0–10). */
  fatigueScore:    number;
  /** ISO timestamp of when the export was triggered. */
  exportedAt:      string;
}

// ─── Internal format helpers ──────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function fmtMs(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), rem = s % 60;
  return rem ? `${m}m ${rem}s` : `${m}m`;
}

function fmtDurationMs(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `~${m} min`;
  const h = Math.floor(m / 60), rem = m % 60;
  return rem ? `~${h}h ${rem}m` : `~${h}h`;
}

// ─── JSON ─────────────────────────────────────────────────────────────────────

/**
 * Serialise all user data to a structured JSON string.
 * Suitable for full backups and developer inspection.
 */
export function serializeJSON(payload: ExportPayload): string {
  return JSON.stringify(
    {
      exportedAt:     payload.exportedAt,
      app:            'Galawgaw Workout Timer v2',
      currentFatigue: payload.fatigueScore,
      sessionHistory:  payload.sessionHistory,
      customIntervals: payload.customIntervals,
    },
    null,
    2,
  );
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

function csvRow(cells: (string | number)[]): string {
  return cells
    .map((c) => `"${String(c).replace(/"/g, '""')}"`)
    .join(',');
}

/**
 * Serialise to a multi-section CSV.
 * Two logical tables are separated by a blank line:
 *   1. Session History
 *   2. Custom Timer Templates (omitted when empty)
 */
export function serializeCSV(payload: ExportPayload): string {
  const lines: string[] = [];

  lines.push(csvRow(['GALAWGAW TRAINING VAULT']));
  lines.push(csvRow([`Exported: ${fmtDate(payload.exportedAt)}`]));
  lines.push('');

  // ── Session History ──────────────────────────────────────────────────────
  lines.push(csvRow(['SESSION HISTORY']));
  lines.push(csvRow([
    'Date',
    'Completion %',
    'Readiness (0–10)',
    'Post-Fatigue (0–10)',
    'Duration',
  ]));

  const sorted = [...payload.sessionHistory].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  for (const s of sorted) {
    lines.push(csvRow([
      fmtDate(s.date),
      `${(s.completion_ratio * 100).toFixed(0)}%`,
      s.pre_readiness_score  !== undefined ? s.pre_readiness_score  : '',
      s.post_fatigue_score   !== undefined ? s.post_fatigue_score   : '',
      s.duration_ms          !== undefined ? fmtDurationMs(s.duration_ms) : '',
    ]));
  }

  // ── Custom Timer Templates ───────────────────────────────────────────────
  if (payload.customIntervals.length > 0) {
    lines.push('');
    lines.push(csvRow(['CUSTOM TIMER TEMPLATES']));
    lines.push(csvRow(['Name', 'Work', 'Rest', 'Rounds', 'Total Duration']));

    for (const ci of payload.customIntervals) {
      lines.push(csvRow([
        ci.label,
        fmtMs(ci.work_ms),
        fmtMs(ci.rest_ms),
        ci.rounds,
        fmtDurationMs((ci.work_ms + ci.rest_ms) * ci.rounds),
      ]));
    }
  }

  return lines.join('\r\n'); // RFC 4180 line endings
}

// ─── Markdown ─────────────────────────────────────────────────────────────────

/**
 * Serialise to a rich Markdown document with YAML front matter.
 * Designed to be dropped into Obsidian or pasted into a Notion page.
 */
export function serializeMarkdown(payload: ExportPayload): string {
  const now   = new Date(payload.exportedAt);
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD

  const totalSessions   = payload.sessionHistory.length;
  const avgCompletion   = totalSessions > 0
    ? payload.sessionHistory.reduce((a, s) => a + s.completion_ratio, 0) / totalSessions
    : 0;
  const totalDurationMs = payload.sessionHistory.reduce(
    (a, s) => a + (s.duration_ms ?? 0), 0,
  );
  const fatCat = classifyFatigue(payload.fatigueScore);

  const lines: string[] = [];

  // ── YAML front matter ────────────────────────────────────────────────────
  lines.push('---');
  lines.push(`title: "Training Log — Galawgaw"`);
  lines.push(`date: "${today}"`);
  lines.push(`tags: [training, workout, galawgaw]`);
  lines.push(`fatigue_score: ${payload.fatigueScore}`);
  lines.push(`total_sessions: ${totalSessions}`);
  lines.push('---');
  lines.push('');

  // ── Title + export note ──────────────────────────────────────────────────
  lines.push('# Training Log');
  lines.push('');
  lines.push(
    `> Exported **${now.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    })}** from Galawgaw Workout Timer v2.`,
  );
  lines.push('');

  // ── Summary stats ────────────────────────────────────────────────────────
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total Sessions | **${totalSessions}** |`);
  if (totalSessions > 0) {
    lines.push(`| Avg Completion | **${(avgCompletion * 100).toFixed(0)}%** |`);
  }
  if (totalDurationMs > 0) {
    lines.push(`| Total Training Time | **${fmtDurationMs(totalDurationMs)}** |`);
  }
  lines.push(`| Current Fatigue Score | **${payload.fatigueScore}/10** — ${fatCat} |`);
  lines.push('');

  // ── Session history ───────────────────────────────────────────────────────
  if (totalSessions > 0) {
    lines.push('## Session History');
    lines.push('');
    lines.push('| Date | Completion | Readiness | Post-Fatigue | Duration |');
    lines.push('|------|-----------|-----------|-------------|----------|');

    const sorted = [...payload.sessionHistory].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    for (const s of sorted) {
      const completion = `${(s.completion_ratio * 100).toFixed(0)}%`;
      const readiness  = s.pre_readiness_score  !== undefined ? `${s.pre_readiness_score}/10`  : '—';
      const fatigue    = s.post_fatigue_score   !== undefined ? `${s.post_fatigue_score}/10`   : '—';
      const duration   = s.duration_ms          !== undefined ? fmtDurationMs(s.duration_ms)   : '—';
      lines.push(`| ${fmtDate(s.date)} | ${completion} | ${readiness} | ${fatigue} | ${duration} |`);
    }
    lines.push('');
  }

  // ── Custom timer templates ────────────────────────────────────────────────
  if (payload.customIntervals.length > 0) {
    lines.push('## Custom Timer Templates');
    lines.push('');

    for (const ci of payload.customIntervals) {
      lines.push(`### ${ci.label}`);
      lines.push('');
      lines.push(`- **Work:** ${fmtMs(ci.work_ms)}`);
      lines.push(`- **Rest:** ${fmtMs(ci.rest_ms)}`);
      lines.push(`- **Rounds:** ${ci.rounds}`);
      lines.push(`- **Total:** ${fmtDurationMs((ci.work_ms + ci.rest_ms) * ci.rounds)}`);
      lines.push('');
    }
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push('*Generated by Galawgaw Workout Timer — your data, your vault.*');

  return lines.join('\n');
}

// ─── Download trigger ─────────────────────────────────────────────────────────

const MIME_TYPES: Record<ExportFormat, string> = {
  json:     'application/json',
  csv:      'text/csv',
  markdown: 'text/markdown',
};

const FILE_EXT: Record<ExportFormat, string> = {
  json:     'json',
  csv:      'csv',
  markdown: 'md',
};

/**
 * Serialize `payload` in the requested `format` and trigger a browser
 * file-save dialog. Safe to call from any click handler.
 */
export function downloadVault(format: ExportFormat, payload: ExportPayload): void {
  let content: string;
  if (format === 'json')     content = serializeJSON(payload);
  else if (format === 'csv') content = serializeCSV(payload);
  else                       content = serializeMarkdown(payload);

  const dateSlug = new Date(payload.exportedAt).toISOString().slice(0, 10);
  const filename  = `galawgaw-vault-${dateSlug}.${FILE_EXT[format]}`;

  const blob = new Blob([content], { type: `${MIME_TYPES[format]};charset=utf-8` });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
