// Web Audio synth — no asset deps, no frameworks.
//
// Synthesizes the game-feel sound effects: whistle snap, thud, crowd cheer,
// TD siren, FG bell, FG miss. All generated procedurally with oscillators +
// noise + filters. Volume scales with play gain.
//
// Usage:
//   import { initAudio, playSnap, setMuted, isMuted } from '../audio/synth.js';
//   // in a useEffect on first user interaction:
//   initAudio();
//   // in event handlers:
//   playSnap();
//   playThud(yardsGained);
//
// Browsers require user interaction before AudioContext can play. Call
// `initAudio()` from a click handler to "unlock" the context.

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let muted = false;

/** Create the AudioContext (call from a user click handler). */
export function initAudio(): void {
  if (ctx) return;
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const newCtx = new AC();
    const gain = newCtx.createGain();
    gain.gain.value = muted ? 0 : 0.6;
    gain.connect(newCtx.destination);
    ctx = newCtx;
    masterGain = gain;
  } catch {
    ctx = null;
    masterGain = null;
  }
}

/** Mute/unmute. Persists across plays. */
export function setMuted(v: boolean): void {
  muted = v;
  if (masterGain && ctx) {
    masterGain.gain.value = v ? 0 : 0.6;
  }
}

export function isMuted(): boolean {
  return muted;
}

/** Internal helper: ensure ctx is resumed (some browsers suspend until user interaction). */
function ensureRunning(): AudioContext | null {
  if (!ctx) return null;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  return ctx;
}

/** Envelope helper: ramp gain over time. */
function env(
  gain: GainNode,
  start: number,
  peak: number,
  attack: number,
  decay: number,
  end: number,
) {
  if (!ctx) return;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + attack);
  gain.gain.linearRampToValueAtTime(0.0001, start + attack + decay);
  gain.gain.setValueAtTime(0, end);
}

/** Play a single oscillator tone with a simple envelope. */
function playTone(
  freq: number,
  durationMs: number,
  type: OscillatorType = 'sine',
  peak = 0.4,
  attackMs = 5,
  decayMs?: number,
) {
  const c = ensureRunning();
  if (!c || !masterGain) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const now = c.currentTime;
  const dur = durationMs / 1000;
  const attack = attackMs / 1000;
  const decay = (decayMs ?? durationMs - attackMs) / 1000;
  env(g, now, peak, attack, decay, now + dur);
  osc.connect(g);
  g.connect(masterGain);
  osc.start(now);
  osc.stop(now + dur + 0.05);
}

/** Play a noise burst with bandpass filter — for "thud" and "crowd" effects. */
function playNoise(durationMs: number, peak: number, filterFreq: number, filterQ = 1) {
  const c = ensureRunning();
  if (!c || !masterGain) return;
  const bufferSize = Math.floor(c.sampleRate * (durationMs / 1000));
  const buf = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize); // decay
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = 'bandpass';
  filt.frequency.value = filterFreq;
  filt.Q.value = filterQ;
  const g = c.createGain();
  env(g, c.currentTime, peak, 0.005, durationMs / 1000 - 0.01, c.currentTime + durationMs / 1000);
  src.connect(filt);
  filt.connect(g);
  g.connect(masterGain);
  src.start();
}

// === Public effect API ========================================================

/** Sharp whistle-snap: high triangle burst. */
export function playSnap(): void {
  playTone(1800, 80, 'triangle', 0.35, 1, 70);
  playNoise(60, 0.2, 3000, 4);
}

/** Thud on a tackle/loss: low noise burst. Intensity scales with yards lost. */
export function playThud(intensity = 1): void {
  playTone(60, 120, 'sine', 0.3 * intensity, 2, 100);
  playNoise(120, 0.4 * intensity, 200, 0.7);
}

/** Crowd cheer for big plays. Duration + volume scales with gain. */
export function playCheer(intensity = 1): void {
  const c = ensureRunning();
  if (!c || !masterGain) return;
  // Layered noise + lowpass sweep for "crowd roar"
  const bufferSize = Math.floor(c.sampleRate * (0.6 + 0.4 * intensity));
  const buf = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    // Random noise shaped with a quick rise + slow decay
    const env = Math.sin((i / bufferSize) * Math.PI);
    data[i] = (Math.random() * 2 - 1) * env;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(800, c.currentTime);
  filt.frequency.linearRampToValueAtTime(2200, c.currentTime + 0.3 * intensity);
  filt.Q.value = 2;
  const g = c.createGain();
  env(g, c.currentTime, 0.35 * Math.min(1.5, intensity), 0.05, 0.6, c.currentTime + bufferSize / c.sampleRate);
  src.connect(filt);
  filt.connect(g);
  g.connect(masterGain);
  src.start();
}

/** TD siren: classic sawtooth arpeggio rising in pitch. */
export function playTdSiren(): void {
  const c = ensureRunning();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  // Three ascending tones
  const notes = [440, 554, 659, 880];
  for (let i = 0; i < notes.length; i++) {
    const t = now + i * 0.12;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = notes[i];
    env(g, t, 0.3, 0.01, 0.18, t + 0.2);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t);
    osc.stop(t + 0.25);
  }
}

/** FG good: bright bell-like ding. */
export function playFgBell(): void {
  playTone(880, 280, 'sine', 0.35, 1, 250);
  playTone(1320, 220, 'sine', 0.25, 1, 200);
}

/** FG miss: low buzzer. */
export function playFgMiss(): void {
  playTone(180, 220, 'sawtooth', 0.3, 5, 200);
  playTone(120, 180, 'sawtooth', 0.2, 5, 160);
}

/** Conversion turnover-on-downs: descending tones. */
export function playTurnover(): void {
  const c = ensureRunning();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  const notes = [440, 370, 294];
  for (let i = 0; i < notes.length; i++) {
    const t = now + i * 0.08;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'square';
    osc.frequency.value = notes[i];
    env(g, t, 0.25, 0.005, 0.1, t + 0.12);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t);
    osc.stop(t + 0.15);
  }
}