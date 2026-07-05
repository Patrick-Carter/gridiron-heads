// Crowd ambient + chants — no samples, all synthesized.
//
//   startAmbient() / stopAmbient() — continuous filtered-noise "stadium
//     murmur" that loops indefinitely. Swell on big plays is layered via
//     playCheer() (defined in synth.ts) — this module owns the BED only.
//
//   playDefenseChant() / playOffenseChant() — synthesized crowd chants
//     using pitched square waves + bandpass formants + light vibrato.
//     Sounds like an NES-era 8-bit stadium chant.
//
// All sounds route through the 'crowd' bus so the VolumePanel can mix
// independently of music + SFX.

import { ensureRunning, crowdBus } from './_audioBus.js';

interface AmbientState {
  source: AudioBufferSourceNode | null;
  gain: GainNode | null;
  filter: BiquadFilterNode | null;
  lfo: OscillatorNode | null;
  lfoGain: GainNode | null;
  startedAt: number;
}

const ambient: AmbientState = {
  source: null,
  gain: null,
  filter: null,
  lfo: null,
  lfoGain: null,
  startedAt: 0,
};

/** Start the continuous crowd murmur (idempotent). Must be called after
 *  initAudio() — typically on Game screen mount. */
export function startAmbient(): void {
  if (ambient.source) return; // already running
  const c = ensureRunning();
  const bus = crowdBus();
  if (!c || !bus) return;

  // 3-second noise buffer — the loop length gives variation.
  const bufferSize = Math.max(1, Math.floor(c.sampleRate * 3));
  const buf = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buf.getChannelData(0);
  // Pink-ish noise: lowpass-shaped random values + slow envelope ripple
  let prev = 0;
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    // Simple one-pole lowpass to bias toward brown/pink-ish color
    prev = prev * 0.85 + white * 0.15;
    // Slow amplitude modulation gives the "murmur" movement
    const t = i / bufferSize;
    const ripple = 0.85 + 0.15 * Math.sin(t * Math.PI * 8);
    data[i] = prev * ripple * 0.6;
  }

  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;

  // Heavy lowpass = "distant" stadium sound
  const filt = c.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 600;
  filt.Q.value = 0.7;

  // Master gain for the ambient bed — kept quiet so big plays can layer on top
  const g = c.createGain();
  g.gain.value = 0.15;

  // Slow LFO modulates the ambient gain (breathing effect)
  const lfo = c.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.18;
  const lfoGain = c.createGain();
  lfoGain.gain.value = 0.05; // ±5% modulation
  lfo.connect(lfoGain);
  lfoGain.connect(g.gain);

  src.connect(filt);
  filt.connect(g);
  g.connect(bus);
  src.start();
  lfo.start();

  ambient.source = src;
  ambient.gain = g;
  ambient.filter = filt;
  ambient.lfo = lfo;
  ambient.lfoGain = lfoGain;
  ambient.startedAt = c.currentTime;
}

/** Stop the ambient murmur (called on Game unmount). */
export function stopAmbient(): void {
  if (ambient.source) {
    try { ambient.source.stop(); } catch {}
    try { ambient.source.disconnect(); } catch {}
  }
  if (ambient.gain) try { ambient.gain.disconnect(); } catch {}
  if (ambient.filter) try { ambient.filter.disconnect(); } catch {}
  if (ambient.lfo) {
    try { ambient.lfo.stop(); } catch {}
    try { ambient.lfo.disconnect(); } catch {}
  }
  if (ambient.lfoGain) try { ambient.lfoGain.disconnect(); } catch {}
  ambient.source = null;
  ambient.gain = null;
  ambient.filter = null;
  ambient.lfo = null;
  ambient.lfoGain = null;
}

/** True if the ambient bed is currently playing. */
export function isAmbientPlaying(): boolean {
  return ambient.source !== null;
}

// === Crowd chants ============================================================

interface ChantSyllable {
  /** Carrier pitch in Hz. */
  pitch: number;
  /** Syllable duration in ms. */
  durationMs: number;
  /** Vowel formant 1 in Hz (resonator 1 center). */
  f1: number;
  /** Vowel formant 2 in Hz (resonator 2 center). */
  f2: number;
  /** Vowel formant 2 Q (resonance sharpness). */
  f2q?: number;
}

/** "DEE — FENSE" — three syllables, classic stadium cheer. */
const DEFENSE_SYLLABLES: ChantSyllable[] = [
  { pitch: 280, durationMs: 280, f1: 320, f2: 2200, f2q: 12 }, // DEE
  { pitch: 260, durationMs: 180, f1: 530, f2: 1840, f2q: 14 }, // FEN
  { pitch: 240, durationMs: 320, f1: 660, f2: 1720, f2q: 14 }, // SE
];

/** "OFF — ENSE" — two syllables, similar shape to defense but higher. */
const OFFENSE_SYLLABLES: ChantSyllable[] = [
  { pitch: 320, durationMs: 280, f1: 730, f2: 1090, f2q: 8 }, // OFF (open "AH")
  { pitch: 280, durationMs: 480, f1: 660, f2: 1720, f2q: 14 }, // ENSE
];

/** Pure helper — exposed for tests. Total duration of a chant in ms. */
export function chantDurationMs(syllables: ChantSyllable[]): number {
  return syllables.reduce((s, x) => s + x.durationMs, 0);
}

/** Schedule a single chant syllable against the audio context. */
function scheduleSyllable(
  c: AudioContext,
  bus: GainNode,
  syl: ChantSyllable,
  startAt: number,
  crowdScale = 1,
) {
  const dur = syl.durationMs / 1000;

  // Excitation: square wave at the carrier pitch with slight vibrato
  const osc = c.createOscillator();
  osc.type = 'square';
  osc.frequency.value = syl.pitch;
  // Vibrato: ±2Hz at 6Hz rate for "human" wobble
  const vibrato = c.createOscillator();
  vibrato.type = 'sine';
  vibrato.frequency.value = 6;
  const vibratoGain = c.createGain();
  vibratoGain.gain.value = 2;
  vibrato.connect(vibratoGain);
  vibratoGain.connect(osc.frequency);

  // Two parallel bandpass filters at the formant frequencies
  const f1 = c.createBiquadFilter();
  f1.type = 'bandpass';
  f1.frequency.value = syl.f1;
  f1.Q.value = 6;
  const f2 = c.createBiquadFilter();
  f2.type = 'bandpass';
  f2.frequency.value = syl.f2;
  f2.Q.value = syl.f2q ?? 12;

  const mix = c.createGain();
  // Envelope: quick attack, hold, release
  const peak = 0.22 * crowdScale;
  const releaseStart = startAt + dur - 0.05;
  mix.gain.setValueAtTime(0, startAt);
  mix.gain.linearRampToValueAtTime(peak, startAt + 0.025);
  mix.gain.setValueAtTime(peak, releaseStart);
  mix.gain.linearRampToValueAtTime(0.0001, startAt + dur);

  osc.connect(f1);
  osc.connect(f2);
  f1.connect(mix);
  f2.connect(mix);
  mix.connect(bus);

  osc.start(startAt);
  vibrato.start(startAt);
  osc.stop(startAt + dur + 0.05);
  vibrato.stop(startAt + dur + 0.05);
}

/** "D-FENSE!" crowd chant — three syllables. Routes through crowd bus. */
export function playDefenseChant(): void {
  const c = ensureRunning();
  const bus = crowdBus();
  if (!c || !bus) return;
  let t = c.currentTime;
  for (const syl of DEFENSE_SYLLABLES) {
    scheduleSyllable(c, bus, syl, t);
    t += syl.durationMs / 1000;
  }
}

/** "OFF-ENSE!" crowd chant — two syllables. */
export function playOffenseChant(): void {
  const c = ensureRunning();
  const bus = crowdBus();
  if (!c || !bus) return;
  let t = c.currentTime;
  for (const syl of OFFENSE_SYLLABLES) {
    scheduleSyllable(c, bus, syl, t);
    t += syl.durationMs / 1000;
  }
}

/** Internal state inspection for tests. */
export const __test = {
  get ambient() { return ambient; },
  DEFENSE_SYLLABLES,
  OFFENSE_SYLLABLES,
};