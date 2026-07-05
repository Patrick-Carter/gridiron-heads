// Procedural chiptune music engine — no samples, no assets.
//
// Five looping tracks (draft / game / tense / victory / defeat) driven by a
// step sequencer that schedules oscillators against the shared AudioContext.
// Tracks crossfade by stepping two patterns simultaneously and ramping each
// track's per-tick gain from 0→1 (incoming) and 1→0 (outgoing) over ~500ms.
//
// Browsers require a user gesture before AudioContext can play. Call
// `initAudio()` first; music.ts will pick up the same context.

import { ensureRunningCtx, musicBus } from './_audioBus.js';

export type DrumHit = 'kick' | 'snare' | 'hat';

export interface Step {
  /** Lead melody note in Hz. Undefined = rest. */
  lead?: number;
  /** Bass note in Hz. Undefined = rest. */
  bass?: number;
  /** Drum hit (or undefined for silence). */
  drum?: DrumHit;
}

export interface Track {
  name: TrackName;
  bpm: number;
  /** Loop length in 8th-note steps. Engine treats each step equally. */
  steps: Step[];
  /** Lead synth params (per-track personality). */
  lead?: { type: OscillatorType; gain: number; release: number };
  bass?: { type: OscillatorType; gain: number; release: number };
}

export type TrackName = 'draft' | 'game' | 'tense' | 'victory' | 'defeat' | null;

// === Note table (4th-octave + 5th-octave notes, A4 = 440Hz) ===================
// Used by the track definitions below.
const N = {
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00, B5: 987.77,
  C6: 1046.50,
};

// === Track library ===========================================================

/** Draft theme — relaxed, bouncy selection vibe. C major, 8 steps, 100bpm. */
const DRAFT_TRACK: Track = {
  name: 'draft',
  bpm: 100,
  lead: { type: 'square', gain: 0.12, release: 0.18 },
  bass: { type: 'triangle', gain: 0.18, release: 0.2 },
  steps: [
    { drum: 'kick', bass: N.C3 },
    { lead: N.E5, drum: 'hat' },
    { bass: N.G3 },
    { lead: N.C5 },
    { drum: 'kick', bass: N.F3 },
    { lead: N.A4, drum: 'hat' },
    { bass: N.G3 },
    { lead: N.E5 },
  ],
};

/** Game theme — energetic driving beat. 16 steps, 128bpm. */
const GAME_TRACK: Track = {
  name: 'game',
  bpm: 128,
  lead: { type: 'square', gain: 0.13, release: 0.14 },
  bass: { type: 'triangle', gain: 0.2, release: 0.18 },
  steps: [
    { drum: 'kick', bass: N.G3 },
    { lead: N.D5, drum: 'hat' },
    { bass: N.G3 },
    { drum: 'hat' },
    { drum: 'snare', bass: N.B3 },
    { lead: N.D5, drum: 'hat' },
    { bass: N.G3 },
    { lead: N.G5, drum: 'hat' },
    { drum: 'kick', bass: N.A3 },
    { lead: N.E5, drum: 'hat' },
    { bass: N.A3 },
    { drum: 'hat' },
    { drum: 'snare', bass: N.G3 },
    { lead: N.C5, drum: 'hat' },
    { bass: N.G3 },
    { lead: N.B4 },
  ],
};

/** Tense theme — sparse, ominous 3rd/4th-down vibe. 16 steps, 92bpm. */
const TENSE_TRACK: Track = {
  name: 'tense',
  bpm: 92,
  lead: { type: 'triangle', gain: 0.14, release: 0.32 },
  bass: { type: 'triangle', gain: 0.22, release: 0.4 },
  steps: [
    { drum: 'kick', bass: N.E3 },
    {},
    { bass: N.E3 },
    { lead: N.B4 },
    {},
    { drum: 'kick', bass: N.E3 },
    {},
    { lead: N.G4, drum: 'hat' },
    { drum: 'snare' },
    { bass: N.D3 },
    {},
    { lead: N.A4 },
    { drum: 'kick', bass: N.E3 },
    {},
    { bass: N.G3 },
    { lead: N.B4 },
  ],
};

/** Victory sting — short ascending C-E-G-C, holds the final note. */
const VICTORY_TRACK: Track = {
  name: 'victory',
  bpm: 140,
  lead: { type: 'square', gain: 0.18, release: 0.25 },
  bass: { type: 'triangle', gain: 0.18, release: 0.3 },
  steps: [
    { drum: 'kick', bass: N.C3, lead: N.C5 },
    { drum: 'snare', lead: N.E5 },
    { drum: 'kick', bass: N.G3, lead: N.G5 },
    { lead: N.C6 },
  ],
};

/** Defeat sting — descending A-F-D sigh. */
const DEFEAT_TRACK: Track = {
  name: 'defeat',
  bpm: 80,
  lead: { type: 'triangle', gain: 0.16, release: 0.4 },
  bass: { type: 'triangle', gain: 0.2, release: 0.5 },
  steps: [
    { drum: 'kick', bass: N.A3, lead: N.A4 },
    { lead: N.F4 },
    { drum: 'kick', bass: N.D3, lead: N.D4 },
    { lead: N.A3 },
  ],
};

const TRACKS: Record<Exclude<TrackName, null>, Track> = {
  draft: DRAFT_TRACK,
  game: GAME_TRACK,
  tense: TENSE_TRACK,
  victory: VICTORY_TRACK,
  defeat: DEFEAT_TRACK,
};

/** Pure helper — exposed for tests. Returns the step that will sound at the
 *  given step index for the named track. */
export function stepAt(trackName: Exclude<TrackName, null>, stepIdx: number): Step {
  const t = TRACKS[trackName];
  return t.steps[stepIdx % t.steps.length];
}

/** Pure helper — exposed for tests. Step duration in ms for a given track. */
export function stepMs(track: Track): number {
  // 8th note at the given BPM
  return (60_000 / track.bpm) / 2;
}

// === Engine state ============================================================

interface ActiveTrack {
  name: Exclude<TrackName, null>;
  stepIdx: number;
  gain: number; // 0..1 envelope level during fade
}

let active: ActiveTrack | null = null;
let outgoing: ActiveTrack | null = null;
let fadeStartedAt = 0;
let fadeDurationMs = 500;
let intervalId: number | null = null;
let lookaheadMs = 25;

/** Schedule a single step's notes against the audio context. */
function scheduleStep(
  c: AudioContext,
  bus: AudioNode,
  step: Step,
  t: number,        // ctx.currentTime at scheduling moment
  when: number,     // offset in seconds from `t`
  gainScale: number, // 0..1 fade envelope
  track: Track,
) {
  if (gainScale <= 0.001) return;

  if (step.lead !== undefined && track.lead) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = track.lead.type;
    osc.frequency.value = step.lead;
    const peak = track.lead.gain * gainScale;
    const release = track.lead.release;
    const start = t + when;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(peak, start + 0.005);
    g.gain.linearRampToValueAtTime(0.0001, start + release);
    osc.connect(g);
    g.connect(bus);
    osc.start(start);
    osc.stop(start + release + 0.05);
  }

  if (step.bass !== undefined && track.bass) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = track.bass.type;
    osc.frequency.value = step.bass;
    const peak = track.bass.gain * gainScale;
    const release = track.bass.release;
    const start = t + when;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(peak, start + 0.005);
    g.gain.linearRampToValueAtTime(0.0001, start + release);
    osc.connect(g);
    g.connect(bus);
    osc.start(start);
    osc.stop(start + release + 0.05);
  }

  if (step.drum) {
    scheduleDrum(c, bus, step.drum, t + when, gainScale);
  }
}

function scheduleDrum(c: AudioContext, bus: AudioNode, drum: DrumHit, when: number, gainScale: number) {
  if (drum === 'kick') {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    const peak = 0.35 * gainScale;
    osc.frequency.setValueAtTime(120, when);
    osc.frequency.exponentialRampToValueAtTime(40, when + 0.12);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.005);
    g.gain.linearRampToValueAtTime(0.0001, when + 0.14);
    osc.connect(g);
    g.connect(bus);
    osc.start(when);
    osc.stop(when + 0.18);
  } else if (drum === 'snare') {
    const dur = 0.08;
    const bufferSize = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    const filt = c.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 1800;
    filt.Q.value = 2;
    const g = c.createGain();
    const peak = 0.18 * gainScale;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.003);
    g.gain.linearRampToValueAtTime(0.0001, when + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(bus);
    src.start(when);
  } else {
    // hi-hat: very short highpass noise tick
    const dur = 0.025;
    const bufferSize = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    const filt = c.createBiquadFilter();
    filt.type = 'highpass';
    filt.frequency.value = 7000;
    const g = c.createGain();
    const peak = 0.07 * gainScale;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.002);
    g.gain.linearRampToValueAtTime(0.0001, when + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(bus);
    src.start(when);
  }
}

function tick() {
  const c = ensureRunningCtx();
  if (!c) return;
  const bus = musicBus();
  if (!bus) return;

  const nowMs = performance.now();
  if (outgoing) {
    const progress = Math.min(1, (nowMs - fadeStartedAt) / fadeDurationMs);
    outgoing.gain = 1 - progress;
    active!.gain = progress;
    if (progress >= 1) {
      outgoing = null;
    }
  }

  if (active) {
    const track = TRACKS[active.name];
    const step = track.steps[active.stepIdx % track.steps.length];
    scheduleStep(c, bus, step, c.currentTime, lookaheadMs / 1000, active.gain, track);
    active.stepIdx++;
  }
  if (outgoing) {
    const track = TRACKS[outgoing.name];
    const step = track.steps[outgoing.stepIdx % track.steps.length];
    scheduleStep(c, bus, step, c.currentTime, lookaheadMs / 1000, outgoing.gain, track);
    outgoing.stepIdx++;
  }
}

function ensureInterval() {
  if (intervalId !== null) return;
  // Use a sub-step interval (lookahead cadence) for tighter scheduling
  intervalId = window.setInterval(tick, lookaheadMs);
}

function clearInterval2() {
  if (intervalId !== null) {
    window.clearInterval(intervalId);
    intervalId = null;
  }
}

/** Switch to a track. Crossfades from the previous track (if any). Passing
 *  null stops music. The `fadeMs` controls crossfade duration (default 500). */
export function setTrack(name: TrackName, fadeMs = 500): void {
  const c = ensureRunningCtx();
  if (!c) return;
  fadeDurationMs = fadeMs;

  if (name === null) {
    // Stop everything — current → outgoing so it fades out
    if (active) {
      outgoing = active;
      outgoing.gain = active.gain;
      active = null;
      fadeStartedAt = performance.now();
    }
    return;
  }

  if (active && active.name === name) return;

  if (active) {
    outgoing = active;
    outgoing.gain = active.gain;
  }
  active = { name, stepIdx: 0, gain: outgoing ? 0 : 1 };
  fadeStartedAt = performance.now();
  ensureInterval();
}

/** Stop music entirely (used on app teardown). */
export function stopMusic(): void {
  active = null;
  outgoing = null;
  clearInterval2();
}

/** True if the music engine is currently running a track (incl. fade-out). */
export function isMusicPlaying(): boolean {
  return active !== null || outgoing !== null;
}

/** True if a specific track is currently the active one (post-fade). */
export function getCurrentTrack(): TrackName {
  return active?.name ?? null;
}