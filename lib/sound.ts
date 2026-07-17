'use client';

/**
 * v9 — SOUND EFFECTS. The Settings toggle ("callit-pref-sound") finally
 * drives something: tiny synthesized UI sounds, generated with the Web
 * Audio API — no audio files, nothing to download, nothing to license.
 *
 * DESIGN BRIEF (owner): sounds exist to make trading feel comfortable and
 * rewarding, never to nag. Every cue is therefore:
 *   - QUIET   — peak gain ≤ 0.09, far below system alert volume;
 *   - SHORT   — 90–450 ms, sine/triangle only (no buzzy square/saw);
 *   - WARM    — soft attack, exponential decay, a touch of lowpass;
 *   - RARE    — per-sound throttle so a burst of toasts can't machine-gun.
 *
 * API: play('fill' | 'success' | 'win' | 'tick' | 'error').
 *   fill    — a trade filled: soft two-note "pop-up" (the money sound).
 *   success — a request went through (deposit/withdrawal/sign-in): gentle
 *             major-third chime.
 *   win     — something resolved in the user's favor: a little three-note
 *             rising arpeggio, the most celebratory cue we allow ourselves.
 *   tick    — small confirmations (vote cast, toggle): one soft blip.
 *   error   — something failed: one low, muted thud. Deliberately duller
 *             and quieter than the success cues — failure should never be
 *             the loudest thing on the page.
 *
 * The preference is read from localStorage ON EVERY CALL (no module state
 * to go stale when the user flips the toggle), defaults to ON to match the
 * Settings default, and everything no-ops on the server, in browsers
 * without AudioContext, and when storage is unreadable.
 */

const PREF_KEY = 'callit-pref-sound';

/** Per-sound minimum gap — a re-render storm must not become a drumroll. */
const THROTTLE_MS = 250;

export type SoundName = 'fill' | 'success' | 'win' | 'tick' | 'error';

interface Note {
  /** Frequency in Hz. */
  f: number;
  /** Start offset within the cue, seconds. */
  at: number;
  /** Decay length, seconds. */
  dur: number;
  /** Peak gain for this note. */
  gain: number;
  type: OscillatorType;
}

/** A5/C#6/E6-flavored pentatonic-ish picks — consonant, nothing shrill. */
const CUES: Record<SoundName, Note[]> = {
  tick: [{ f: 880, at: 0, dur: 0.09, gain: 0.05, type: 'sine' }],
  fill: [
    { f: 523.25, at: 0, dur: 0.12, gain: 0.07, type: 'triangle' }, // C5
    { f: 783.99, at: 0.07, dur: 0.16, gain: 0.06, type: 'sine' }, // G5
  ],
  success: [
    { f: 659.25, at: 0, dur: 0.14, gain: 0.06, type: 'sine' }, // E5
    { f: 830.61, at: 0.09, dur: 0.2, gain: 0.055, type: 'sine' }, // G#5
  ],
  win: [
    { f: 523.25, at: 0, dur: 0.14, gain: 0.07, type: 'triangle' }, // C5
    { f: 659.25, at: 0.1, dur: 0.14, gain: 0.065, type: 'triangle' }, // E5
    { f: 783.99, at: 0.2, dur: 0.25, gain: 0.06, type: 'sine' }, // G5
  ],
  error: [{ f: 196, at: 0, dur: 0.18, gain: 0.05, type: 'sine' }], // G3
};

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== '0'; // default ON
  } catch {
    return false; // storage unreadable — err on silence
  }
}

let ctx: AudioContext | null = null;
const lastPlayed = new Map<SoundName, number>();

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  return ctx;
}

/**
 * Play a UI cue. Safe to call from anywhere, any time: it silently no-ops
 * when sounds are off, unsupported, throttled, or the tab hasn't had the
 * user gesture browsers require before audio may start.
 */
export function play(name: SoundName): void {
  if (!soundEnabled()) return;

  const now = Date.now();
  const last = lastPlayed.get(name) ?? 0;
  if (now - last < THROTTLE_MS) return;
  lastPlayed.set(name, now);

  const ac = audioContext();
  if (!ac) return;
  // Autoplay policy: resume() only succeeds after a user gesture. Every
  // call site here IS a click handler's aftermath, so this resolves — but
  // if it doesn't, we just stay silent rather than queue sounds.
  if (ac.state === 'suspended') {
    void ac.resume().catch(() => {});
    if (ac.state === 'suspended') return;
  }

  try {
    // One shared lowpass keeps everything rounded and un-piercing.
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2400;
    filter.connect(ac.destination);

    const t0 = ac.currentTime;
    for (const n of CUES[name]) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = n.type;
      osc.frequency.value = n.f;
      // Soft 12 ms attack (no click), exponential decay to silence.
      const start = t0 + n.at;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(n.gain, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + n.dur);
      osc.connect(gain);
      gain.connect(filter);
      osc.start(start);
      osc.stop(start + n.dur + 0.05);
    }
  } catch {
    // Audio is decoration — a failure here must never surface.
  }
}
