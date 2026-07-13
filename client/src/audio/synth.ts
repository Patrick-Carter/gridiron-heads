// Web Audio synth — no asset deps, no frameworks.
//
// All game sound effects via oscillators + noise + filters. Routes through
// the shared 4-bus mix (Master / Music / Crowd / SFX) defined in
// `_audioBus.ts`.
// See that file for the volume API and persistence.
//
// Crowd swells (the "big play" roars) live in crowd.ts to keep them out of
// this one-shot-focused module.
//
// Browsers require user interaction before AudioContext can play. Call
// `initAudio()` from a click handler to "unlock" the context.

import {
  ensureRunning as _ensureRunning,
  busFor,
  isAudioReady,
  initAudio,
  setVolume,
  setVolumes,
  getVolumes,
  setMuted,
  isMuted,
  type Channel,
  type Volumes,
} from './_audioBus.js';

export type { Channel, Volumes };

/** Create the AudioContext. Idempotent. Must be called from a user gesture. */
export function ensureAudio(): void {
  initAudio();
}

/** True if AudioContext has been initialized. */
export function audioReady(): boolean {
  return isAudioReady();
}

// Back-compat alias used in older call sites.
export { initAudio, setVolume, setVolumes, getVolumes, setMuted, isMuted };

/** Envelope helper: ramp gain over time. */
function env(
  gain: GainNode,
  start: number,
  peak: number,
  attack: number,
  decay: number,
  end: number,
) {
  if (!gain.context) return;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + attack);
  gain.gain.linearRampToValueAtTime(0.0001, start + attack + decay);
  gain.gain.setValueAtTime(0, end);
}

/** Play a single oscillator tone with a simple envelope on a channel. */
function playTone(
  freq: number,
  durationMs: number,
  type: OscillatorType = 'sine',
  peak = 0.4,
  attackMs = 5,
  decayMs?: number,
  channel: Channel = 'sfx',
) {
  const c = _ensureRunning();
  const bus = busFor(channel);
  if (!c || !bus) return;
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
  g.connect(bus);
  osc.start(now);
  osc.stop(now + dur + 0.05);
}

/** Noise burst with bandpass/highpass filter. */
function playNoise(
  durationMs: number,
  peak: number,
  filterFreq: number,
  filterQ = 1,
  filterType: BiquadFilterType = 'bandpass',
  channel: Channel = 'sfx',
) {
  const c = _ensureRunning();
  const bus = busFor(channel);
  if (!c || !bus) return;
  const bufferSize = Math.max(1, Math.floor(c.sampleRate * (durationMs / 1000)));
  const buf = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = filterType;
  filt.frequency.value = filterFreq;
  filt.Q.value = filterQ;
  const g = c.createGain();
  env(g, c.currentTime, peak, 0.005, durationMs / 1000 - 0.01, c.currentTime + durationMs / 1000);
  src.connect(filt);
  filt.connect(g);
  g.connect(bus);
  src.start();
}

// === Public SFX API ===========================================================

// === Existing gameplay sounds (kept stable — Game.tsx already calls these) ===

/** Sharp console snap: a clipped high pulse plus a short noise crack. */
export function playSnap(): void {
  playTone(1760, 45, 'square', 0.25, 1, 40);
  playNoise(55, 0.26, 3200, 3);
}

/** Thud on a tackle/loss. Intensity scales with yards lost. */
export function playThud(intensity = 1): void {
  playTone(70, 105, 'triangle', 0.28 * intensity, 2, 90);
  playTone(42, 145, 'sine', 0.22 * intensity, 2, 125);
  playNoise(90, 0.3 * intensity, 260, 0.7);
}

/** Touchdown: bright, brassy 16-bit major fanfare. */
export function playTdSiren(): void {
  const c = _ensureRunning();
  const bus = busFor('sfx');
  if (!c || !bus) return;
  const now = c.currentTime;
  const notes = [523, 659, 784, 1047];
  for (let i = 0; i < notes.length; i++) {
    const t = now + i * 0.105;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = i === notes.length - 1 ? 'square' : 'sawtooth';
    osc.frequency.value = notes[i];
    env(g, t, 0.25, 0.005, i === notes.length - 1 ? 0.42 : 0.15, t + (i === notes.length - 1 ? 0.45 : 0.17));
    osc.connect(g);
    g.connect(bus);
    osc.start(t);
    osc.stop(t + (i === notes.length - 1 ? 0.48 : 0.2));
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

/** Turnover: descending tones. */
export function playTurnover(): void {
  const c = _ensureRunning();
  const bus = busFor('sfx');
  if (!c || !bus) return;
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
    g.connect(bus);
    osc.start(t);
    osc.stop(t + 0.15);
  }
}

// === New arcade-density SFX =================================================

/** Crisp UI click — fired globally on every .btn-* press. */
export function playUiClick(): void {
  playTone(880, 35, 'square', 0.18, 1, 30);
  playNoise(20, 0.06, 4000, 2);
}

/** Soft hover tick — triggered from data-sfx="hover" elements. */
export function playUiHover(): void {
  playTone(1400, 15, 'sine', 0.07, 1, 12);
}

/** Scheme parent/sub selection — short two-note "bing". */
export function playSchemeSelect(): void {
  playTone(660, 50, 'square', 0.22, 1, 45);
  setTimeout(() => playTone(990, 50, 'square', 0.18, 1, 45), 50);
}

/** Audible called — sharp warning klaxon. */
export function playAudible(): void {
  const c = _ensureRunning();
  const bus = busFor('sfx');
  if (!c || !bus) return;
  const now = c.currentTime;
  for (const t of [0, 0.08]) {
    const freq = t === 0 ? 720 : 480;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    env(g, now + t, 0.28, 0.005, 0.08, now + t + 0.1);
    osc.connect(g);
    g.connect(bus);
    osc.start(now + t);
    osc.stop(now + t + 0.12);
  }
}

/** Draft pick registered — bright success chime. */
export function playDraftPick(): void {
  playTone(523, 60, 'triangle', 0.28, 1, 55);
  setTimeout(() => playTone(784, 90, 'triangle', 0.24, 1, 80), 60);
  setTimeout(() => playTone(1047, 140, 'triangle', 0.22, 1, 130), 150);
}

/** Coin flip landed — metallic cha-ching. */
export function playCoinFlip(): void {
  playTone(1320, 40, 'square', 0.25, 1, 35);
  setTimeout(() => playTone(1760, 40, 'square', 0.22, 1, 35), 40);
  setTimeout(() => playTone(2200, 90, 'square', 0.18, 1, 80), 80);
}

/** Possession change — whoosh + small crowd swell. */
export function playPossessionChange(): void {
  const c = _ensureRunning();
  const bus = busFor('sfx');
  if (!c || !bus) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(380, now);
  osc.frequency.exponentialRampToValueAtTime(140, now + 0.35);
  env(g, now, 0.22, 0.01, 0.35, now + 0.4);
  osc.connect(g);
  g.connect(bus);
  osc.start(now);
  osc.stop(now + 0.42);
}

/** Down / distance updated — quick muted tick. */
export function playDownChange(): void {
  playTone(420, 30, 'sine', 0.12, 1, 25);
}

/** Point scored bump (paired with TD/FG/safety specific sounds). */
export function playPointScored(): void {
  playTone(880, 60, 'triangle', 0.22, 1, 55);
  setTimeout(() => playTone(1320, 120, 'triangle', 0.2, 1, 110), 70);
}

/** Victory fanfare — major-key ascending C-E-G-C with held final note. */
export function playVictory(): void {
  const c = _ensureRunning();
  const bus = busFor('sfx');
  if (!c || !bus) return;
  const now = c.currentTime;
  const notes: [number, number][] = [
    [523, 0.18], [659, 0.18], [784, 0.18], [1047, 0.7],
  ];
  let t = now;
  for (const [freq, dur] of notes) {
    for (const detune of [0, 4]) {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq * (1 + detune / 1200);
      env(g, t, 0.28, 0.01, dur - 0.02, t + dur);
      osc.connect(g);
      g.connect(bus);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
    t += dur * 0.7;
  }
}

/** Defeat sting — descending minor sigh. */
export function playDefeat(): void {
  const c = _ensureRunning();
  const bus = busFor('sfx');
  if (!c || !bus) return;
  const now = c.currentTime;
  const notes: [number, number][] = [
    [392, 0.2], [330, 0.25], [262, 0.7],
  ];
  let t = now;
  for (const [freq, dur] of notes) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    env(g, t, 0.25, 0.02, dur - 0.04, t + dur);
    osc.connect(g);
    g.connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    t += dur * 0.85;
  }
}

/** Kickoff / punt thunk — deep drum hit. */
export function playKickoff(): void {
  const c = _ensureRunning();
  const bus = busFor('sfx');
  if (!c || !bus) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(160, now);
  osc.frequency.exponentialRampToValueAtTime(40, now + 0.2);
  env(g, now, 0.4, 0.005, 0.2, now + 0.25);
  osc.connect(g);
  g.connect(bus);
  osc.start(now);
  osc.stop(now + 0.28);
  playNoise(15, 0.15, 1500, 3);
}

/** Incomplete pass whistle — 3 short high peeps. */
export function playIncomplete(): void {
  for (let i = 0; i < 3; i++) {
    setTimeout(() => playTone(1500, 40, 'triangle', 0.22, 1, 35), i * 110);
  }
}

/** Error / wrong-action buzz. */
export function playError(): void {
  playTone(220, 90, 'square', 0.22, 2, 80);
  playTone(180, 90, 'square', 0.18, 2, 80);
}
