import { SessionCompletePayload } from '../engine/types';

export interface ShareData {
  title: string;
  text:  string;
  url?:  string;
}

/**
 * Generates a textual recap of the workout for social sharing.
 */
export function generateWorkoutRecap(
  workoutName: string,
  session:     SessionCompletePayload,
  readiness:   number | null,
  fatigue:     number
): string {
  const durationMin = Math.round(session.duration_ms / 60000);
  const ratio = Math.round((session.steps_completed / Math.max(1, session.steps_completed + session.steps_skipped)) * 100);
  
  const emoji = fatigue >= 8 ? '🔥' : fatigue >= 5 ? '💪' : '⚡';
  
  return `
${emoji} Just finished "${workoutName}" on Galawgaw!
⏱️ Time: ${durationMin}m
✅ Completion: ${ratio}%
${readiness !== null ? `🧠 Readiness: ${readiness}/10` : ''}
🥵 Post-Fatigue: ${fatigue}/10

#Galawgaw #WorkoutTimer #FitnessLogic
  `.trim();
}

/**
 * Uses the Web Share API to trigger the native share sheet.
 * Falls back to clipboard if API is unavailable.
 */
export async function shareSession(data: ShareData): Promise<boolean> {
  if (navigator.share) {
    try {
      await navigator.share(data);
      return true;
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('[shareSession] Error sharing:', err);
      }
      return false;
    }
  } else {
    // Fallback: Copy to clipboard
    try {
      await navigator.clipboard.writeText(`${data.title}\n${data.text}\n${data.url || ''}`);
      return true;
    } catch (err) {
      console.error('[shareSession] Clipboard failed:', err);
      return false;
    }
  }
}
