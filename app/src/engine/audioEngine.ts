// ─── Audio Engine ─────────────────────────────────────────────────────────────
// Handles workout audio cues: countdown beeps (Web Audio API) and
// next-exercise voice announcements (SpeechSynthesis).

class AudioEngine {
  private ctx: AudioContext | null = null;

  /** Controls Web Audio API beeps (countdown ticks, start/step dings). */
  beepsEnabled = true;
  /** Controls SpeechSynthesis exercise announcements. */
  voiceEnabled = true;
  /** Controls navigator.vibrate() calls for haptic feedback. */
  hapticsEnabled = true;

  // ── Web Audio context ──────────────────────────────────────────────────────

  private getCtx(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) return null;

    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new Ctor() as AudioContext;
    }
    // Resume if the browser suspended it (requires prior user gesture)
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  // ── Core beep primitive ────────────────────────────────────────────────────

  /**
   * Schedule a single sine-wave beep.
   * @param frequency  Hz
   * @param durationMs Envelope length in ms
   * @param gain       Peak gain (0–1)
   * @param delayMs    Offset from now in ms (for chaining)
   */
  private scheduleBeep(
    frequency: number,
    durationMs: number,
    peakGain = 0.35,
    delayMs  = 0,
  ): void {
    const ctx = this.getCtx();
    if (!ctx || !this.beepsEnabled) return;

    const t = ctx.currentTime + delayMs / 1000;

    const osc      = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.type            = 'sine';
    osc.frequency.value = frequency;

    // Fast 5 ms attack, exponential decay to silence
    gainNode.gain.setValueAtTime(0, t);
    gainNode.gain.linearRampToValueAtTime(peakGain, t + 0.005);
    gainNode.gain.exponentialRampToValueAtTime(0.001, t + durationMs / 1000);

    osc.start(t);
    osc.stop(t + durationMs / 1000 + 0.02);
  }

  // ── Public cue API ─────────────────────────────────────────────────────────

  /**
   * Low-pitch tick played on each countdown second (5 → 1).
   * One short 330 Hz blip per second.
   */
  playCountdownTick(): void {
    this.scheduleBeep(330, 110, 0.3);
  }

  /**
   * High-pitch double-beep played when the first exercise step begins.
   * Two 880 Hz tones 180 ms apart signal "go!".
   */
  playStartBeep(): void {
    this.scheduleBeep(880, 160, 0.45);
    this.scheduleBeep(880, 160, 0.45, 190);
  }

  /**
   * Single mid-pitch ding played at the start of each subsequent step
   * (work → rest or rest → work transitions after the first).
   */
  playStepBeep(): void {
    this.scheduleBeep(660, 120, 0.3);
  }

  private lastAnnouncedText = '';
  private lastAnnouncedTime = 0;

  /**
   * Announce the next exercise name using the browser's Speech Synthesis API.
   * Cancels any in-flight utterance first to avoid overlap.
   * Includes a throttle guard to prevent annoying repetitions of the same cue
   * within a short window (e.g. 2.5s).
   *
   * @param name   Exercise label to speak (e.g. "Push-ups")
   * @param isRest Pass true to speak "Rest" instead
   */
  announceExercise(name: string, isRest = false): void {
    if (!this.voiceEnabled) return;
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    const text = (isRest ? 'Rest' : name).trim();
    if (!text) return;

    // Guard: Don't repeat the exact same text if announced within the last 2.5s.
    // This handles cases where transitions or ticks might double-trigger cues.
    const now = Date.now();
    if (text === this.lastAnnouncedText && now - this.lastAnnouncedTime < 2500) {
      return;
    }

    window.speechSynthesis.cancel();

    this.lastAnnouncedText = text;
    this.lastAnnouncedTime = now;

    const utt   = new SpeechSynthesisUtterance(text);
    utt.rate    = 0.95; // Slightly faster for natural feel
    utt.pitch   = 1.0;
    utt.volume  = 1;

    // Voice selection: always prefer local (on-device) voices so cues work
    // in a basement gym with no signal. Cloud voices (e.g. Google WaveNet)
    // have localService === false and silently drop the utterance offline.
    const voices = window.speechSynthesis.getVoices();
    const localEn =
      voices.find(v => v.localService && v.lang === 'en-US') ||
      voices.find(v => v.localService && v.lang.startsWith('en-'));
    const anyEn =
      voices.find(v => v.lang === 'en-US') ||
      voices.find(v => v.lang.startsWith('en-'));
    // localEn first; fall back to any English if no local voice is registered
    const chosen = localEn ?? anyEn;
    if (chosen) utt.voice = chosen;

    window.speechSynthesis.speak(utt);
  }

  /** Stop any in-flight speech (e.g. on session end or pause). */
  cancelSpeech(): void {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }

  // ── Haptics ────────────────────────────────────────────────────────────────

  /**
   * Trigger a vibration pattern if haptics are enabled and the Vibration API
   * is available. Silently no-ops on unsupported platforms (desktop, iOS Safari).
   *
   * @param pattern  Single duration (ms) or a vibrate/pause alternating array.
   *                 Common patterns used in this app:
   *                   50            — countdown tick
   *                   [100, 50, 100] — session start double-buzz
   *                   [50,30,50,30,100] — session complete celebratory pulse
   */
  vibrate(pattern: number | number[] = 35): void {
    if (!this.hapticsEnabled) return;
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  }
}

// Singleton — share one AudioContext across the app lifetime.
export const audioEngine = new AudioEngine();
