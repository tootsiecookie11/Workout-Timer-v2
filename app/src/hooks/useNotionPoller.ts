import { useState, useEffect, useRef } from 'react';
import { useTimerStore } from '../store/timerStore';
import { supabase } from '../lib/supabase';

// Workstream 4: Mid-session polling to detect if the active Notion template was altered
export function useNotionPoller() {
  const [isDirty, setIsDirty] = useState(false);
  const engineState = useTimerStore((s) => s.engineState);
  const mode = useTimerStore((s) => s.mode);
  const sessionStartTime = useRef<string | null>(null);

  useEffect(() => {
    // We only poll during predetermined modes (from Notion) that are active
    if (mode !== 'preset' || (engineState !== 'ACTIVE' && engineState !== 'PAUSED')) {
      setIsDirty(false);
      return;
    }

    if (!sessionStartTime.current) {
      sessionStartTime.current = new Date().toISOString();
    }

    const intervalId = setInterval(async () => {
      if (document.hidden) return; // Save resources if tab is backgrounded
      
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      
      try {
        const workoutId = 'active_workout_placeholder_id'; // In a full app, this comes from the active workout metadata
        const response = await fetch(`/api/workout/${workoutId}/dirty?since=${encodeURIComponent(sessionStartTime.current!)}`, {
          headers: {
            'Authorization': `Bearer ${session.access_token}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          if (data.isDirty) {
            setIsDirty(true);
            clearInterval(intervalId); // Stop polling once dirty is flagged
          }
        }
      } catch (err) {
        console.warn('Dirty state poller failed:', err);
      }
    }, 30000); // Check every 30 seconds

    return () => clearInterval(intervalId);
  }, [engineState, mode]);

  return isDirty;
}
