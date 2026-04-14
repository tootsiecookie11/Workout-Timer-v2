import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { audioEngine } from '../engine/audioEngine';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TransitionDuration = 'short' | 'normal' | 'long';

/**
 * User-configurable Notion database IDs.
 * Mirrors the env vars (VITE_NOTION_*_DB_ID) but stored in localStorage so
 * the user can enter them in the Settings drawer without touching .env files.
 * Empty string means "not set" — hooks fall back to the env var in that case.
 */
export interface NotionConfig {
  workoutsDatabaseId: string;
  blocksDatabaseId:   string;
  programsDatabaseId: string;
  sessionsDatabaseId: string;
}

/**
 * Per-duration dismiss timings consumed by timerStore's transition:start
 * handler to control how long the TransitionOverlay stays visible.
 */
export const TRANSITION_DISMISS_MS: Record<
  TransitionDuration,
  { work: number; rest: number }
> = {
  short:  { work: 600,  rest: 900  },
  normal: { work: 900,  rest: 1400 },
  long:   { work: 1400, rest: 2000 },
};

// ─── Store shape ──────────────────────────────────────────────────────────────

export interface SettingsState {
  /** Play Web Audio API beeps on countdown ticks and step transitions. */
  enableBeeps:         boolean;
  /** Speak next-exercise name via SpeechSynthesis during transitions. */
  enableVoiceCues:     boolean;
  /** Vibrate on step advances and session completion (where supported). */
  enableHaptics:       boolean;
  /** Controls TransitionOverlay dismiss delay. */
  transitionDuration:  TransitionDuration;
  /**
   * Locally-selected active program ID.
   * Takes precedence over Notion's `is_active` flag.
   * Null means fall back to Notion's active status.
   */
  activeProgramId:     string | null;
  /**
   * User-supplied Notion database IDs.
   * Each field overrides the corresponding VITE_NOTION_*_DB_ID env var when
   * non-empty, so the app works without any .env configuration.
   */
  notionConfig:        NotionConfig;
  /** Whether the global settings drawer is currently open. (Transient state) */
  isSettingsOpen:      boolean;
  /** Optional ID of an element to scroll to within the drawer once it opens. */
  settingsScrollTarget: string | null;
}

export interface SettingsActions {
  setEnableBeeps:           (v: boolean)            => void;
  setEnableVoiceCues:       (v: boolean)            => void;
  setEnableHaptics:         (v: boolean)            => void;
  setTransitionDuration:    (v: TransitionDuration) => void;
  setActiveProgramId:       (id: string | null)     => void;
  setWorkoutsDatabaseId:    (id: string)             => void;
  setBlocksDatabaseId:      (id: string)             => void;
  setProgramsDatabaseId:    (id: string)             => void;
  setSessionsDatabaseId:    (id: string)             => void;
  setIsSettingsOpen:        (open: boolean)          => void;
  setSettingsScrollTarget:  (id: string | null)     => void;
  /** Helper to open settings and optionally target a section */
  openSettings:             (target?: string)        => void;
}

export type SettingsStore = SettingsState & SettingsActions;

// ─── Store ────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'galawgaw_settings_v1';

export const useSettingsStore = create<SettingsStore>()(
  subscribeWithSelector(
    persist(
      (set) => ({
        // ── Defaults ────────────────────────────────────────────────────────
        enableBeeps:        true,
        enableVoiceCues:    true,
        enableHaptics:      true,
        transitionDuration: 'normal' as TransitionDuration,
        activeProgramId:    null,
        notionConfig: {
          workoutsDatabaseId: '',
          blocksDatabaseId:   '',
          programsDatabaseId: '',
          sessionsDatabaseId: '',
        },
        isSettingsOpen: false,
        settingsScrollTarget: null,

        // ── Actions ─────────────────────────────────────────────────────────
        setEnableBeeps:        (v)  => set({ enableBeeps: v }),
        setEnableVoiceCues:    (v)  => set({ enableVoiceCues: v }),
        setEnableHaptics:      (v)  => set({ enableHaptics: v }),
        setTransitionDuration: (v)  => set({ transitionDuration: v }),
        setActiveProgramId:    (id) => set({ activeProgramId: id }),

        setWorkoutsDatabaseId: (id) =>
          set((s) => ({ notionConfig: { ...s.notionConfig, workoutsDatabaseId: id } })),
        setBlocksDatabaseId: (id) =>
          set((s) => ({ notionConfig: { ...s.notionConfig, blocksDatabaseId: id } })),
        setProgramsDatabaseId: (id) =>
          set((s) => ({ notionConfig: { ...s.notionConfig, programsDatabaseId: id } })),
        setSessionsDatabaseId: (id) =>
          set((s) => ({ notionConfig: { ...s.notionConfig, sessionsDatabaseId: id } })),
        setIsSettingsOpen: (open) => set({ isSettingsOpen: open }),
        setSettingsScrollTarget: (id) => set({ settingsScrollTarget: id }),
        openSettings: (target) => set({ 
          isSettingsOpen: true, 
          settingsScrollTarget: target || null 
        }),
      }),
      {
        name:    STORAGE_KEY,
        // Only persist state fields, not action functions
        partialize: (s) => ({
          enableBeeps:        s.enableBeeps,
          enableVoiceCues:    s.enableVoiceCues,
          enableHaptics:      s.enableHaptics,
          transitionDuration: s.transitionDuration,
          activeProgramId:    s.activeProgramId,
          notionConfig:       s.notionConfig,
        }),
      },
    ),
  ),
);

// ─── Side-effects: push settings into AudioEngine on change + startup ─────────
// fireImmediately = true ensures the persisted value takes effect before the
// first session starts (not just on the next change).

useSettingsStore.subscribe(
  (s) => s.enableBeeps,
  (enabled) => { audioEngine.beepsEnabled = enabled; },
  { fireImmediately: true },
);

useSettingsStore.subscribe(
  (s) => s.enableVoiceCues,
  (enabled) => { audioEngine.voiceEnabled = enabled; },
  { fireImmediately: true },
);

useSettingsStore.subscribe(
  (s) => s.enableHaptics,
  (enabled) => { audioEngine.hapticsEnabled = enabled; },
  { fireImmediately: true },
);

// ─── Haptic helper ────────────────────────────────────────────────────────────

/**
 * Convenience wrapper around audioEngine.vibrate().
 * Respects the enableHaptics setting (enforced inside audioEngine).
 *
 * @param pattern  Single duration (ms) or a vibrate/pause alternating array.
 *                 Defaults to a single 35 ms pulse.
 *
 * @example
 * haptic();                    // brief tap
 * haptic(50);                  // countdown tick
 * haptic([100, 50, 100]);      // session-start double-buzz
 * haptic([50,30,50,30,100]);   // session-complete celebratory pulse
 */
export function haptic(pattern: number | number[] = 35): void {
  audioEngine.vibrate(pattern);
}
