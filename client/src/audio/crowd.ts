// Stadium crowd system: a low continuous game-day bed plus event-driven
// reactions and full roars. The ambience only runs while the game screen is
// mounted and all layers share the independently adjustable Crowd bus.
//
// All sounds route through the 'crowd' bus so the VolumePanel can mix
// independently of SFX.

import { ensureRunning, crowdBus } from './_audioBus.js';

let ambienceSource: AudioBufferSourceNode | null = null;
let ambienceGain: GainNode | null = null;

/** Starts a seamless low crowd murmur. Idempotent. */
export function startCrowdAmbience(): void {
  if (ambienceSource) return;
  const c = ensureRunning();
  const bus = crowdBus();
  if (!c || !bus) return;

  const duration = 2.4;
  const size = Math.max(1, Math.floor(c.sampleRate * duration));
  const buf = c.createBuffer(1, size, c.sampleRate);
  const data = buf.getChannelData(0);
  let low = 0;
  for (let i = 0; i < size; i++) {
    low = low * 0.97 + (Math.random() * 2 - 1) * 0.03;
    const swell = 0.72 + 0.2 * Math.sin((i / size) * Math.PI * 6);
    data[i] = low * 2.2 * swell + (Math.random() * 2 - 1) * 0.08;
  }

  const source = c.createBufferSource();
  const filter = c.createBiquadFilter();
  const gain = c.createGain();
  source.buffer = buf;
  source.loop = true;
  filter.type = 'bandpass';
  filter.frequency.value = 760;
  filter.Q.value = 0.45;
  gain.gain.value = 0.22;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(bus);
  source.start();
  ambienceSource = source;
  ambienceGain = gain;
}

export function stopCrowdAmbience(): void {
  if (ambienceSource) {
    try { ambienceSource.stop(); } catch {}
    ambienceSource.disconnect();
  }
  ambienceGain?.disconnect();
  ambienceSource = null;
  ambienceGain = null;
}

export function isCrowdAmbiencePlaying(): boolean {
  return ambienceSource !== null;
}

/** Short lift above the bed for catches, tackles, and routine positive plays. */
export function playCrowdReaction(intensity = 0.5): void {
  const c = ensureRunning();
  const bus = crowdBus();
  if (!c || !bus) return;
  const safe = Math.max(0.2, Math.min(1.2, intensity));
  const duration = 0.32 + safe * 0.22;
  const size = Math.max(1, Math.floor(c.sampleRate * duration));
  const buf = c.createBuffer(1, size, c.sampleRate);
  const data = buf.getChannelData(0);
  let low = 0;
  for (let i = 0; i < size; i++) {
    low = low * 0.9 + (Math.random() * 2 - 1) * 0.1;
    const envelope = Math.sin((i / size) * Math.PI);
    data[i] = (low * 1.7 + (Math.random() * 2 - 1) * 0.16) * envelope;
  }
  const source = c.createBufferSource();
  const filter = c.createBiquadFilter();
  const gain = c.createGain();
  source.buffer = buf;
  filter.type = 'bandpass';
  filter.frequency.value = 1100 + safe * 500;
  filter.Q.value = 0.7;
  gain.gain.value = 0.16 * safe;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(bus);
  source.start();
}

/** Crowd roar — layered noise + lowpass sweep. Intensity scales the swell.
 *  1.0 = standard 1st down roar, 1.5 = TD-equal level. Used as the unified
 *  "big play" crowd noise. */
export function playCrowdRoar(intensity = 1): void {
  const c = ensureRunning();
  const bus = crowdBus();
  if (!c || !bus) return;
  const safe = Math.max(0.5, Math.min(2, intensity));
  const bufferSize = Math.max(1, Math.floor(c.sampleRate * (0.6 + 0.4 * safe)));
  const buf = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    const env = Math.sin((i / bufferSize) * Math.PI);
    data[i] = (Math.random() * 2 - 1) * env;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(800, c.currentTime);
  filt.frequency.linearRampToValueAtTime(2400, c.currentTime + 0.3 * safe);
  filt.Q.value = 2;
  const g = c.createGain();
  const peak = 0.5 * Math.min(1.5, safe);
  const dur = bufferSize / c.sampleRate;
  g.gain.setValueAtTime(0, c.currentTime);
  g.gain.linearRampToValueAtTime(peak, c.currentTime + 0.05);
  g.gain.linearRampToValueAtTime(0.0001, c.currentTime + dur);
  src.connect(filt);
  filt.connect(g);
  g.connect(bus);
  src.start();
}

// === Big-play detection =====================================================
// Exported so consumers (Game.tsx) can use the same predicate. Pure — easy
// to test without touching the audio system.

/** Yardage threshold above which a play counts as a "big play" even without
 *  a 1st-down conversion. */
export const BIG_PLAY_YARD_THRESHOLD = 20;

/** Returns true when a playResult should trigger a crowd roar.
 *  - Any scoring play
 *  - Any turnover
 *  - Any 1st-down conversion (yards >= distance needed)
 *  - Any gain >= BIG_PLAY_YARD_THRESHOLD yards
 */
export function isBigPlay(play: {
  yards?: number;
  distance?: number;
  scoring_event?: string | null;
  turnover?: boolean;
}): boolean {
  if (play.scoring_event) return true;
  if (play.turnover) return true;
  const yards = play.yards ?? 0;
  if (yards >= BIG_PLAY_YARD_THRESHOLD) return true;
  const distance = play.distance ?? 0;
  if (distance > 0 && yards >= distance) return true;
  return false;
}
