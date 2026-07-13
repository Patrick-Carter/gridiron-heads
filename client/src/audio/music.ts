// Original 16-bit football march. Square-wave melody, triangle bass, and
// noise percussion evoke an early-'90s console soundtrack without audio
// samples or recreating music from an existing game.

import { ensureRunning, getVolumes, musicBus } from './_audioBus.js';

const BPM = 144;
const STEP_SECONDS = 60 / BPM / 4;
const LOOKAHEAD_SECONDS = 0.2;
const SCHEDULER_MS = 75;

// Eight-bar major-key stadium fanfare. The second half raises the melody and
// drives into a full C-major cadence before looping.
const LEAD: Array<number | null> = [
  72, null, 67, 72, 76, null, 79, null, 76, 79, 84, null, 79, 76, 74, null,
  71, null, 74, 79, 83, null, 86, null, 83, 79, 74, null, 76, 74, 71, null,
  69, null, 72, 77, 81, null, 84, null, 81, 77, 72, 74, 76, null, 77, null,
  71, null, 74, 79, 83, 81, 79, null, 86, null, 83, 79, 77, 74, 71, null,
  69, null, 72, 76, 81, null, 84, 83, 81, 76, 72, null, 76, 79, 81, null,
  77, null, 81, 84, 89, null, 88, 84, 86, 84, 81, 77, 79, null, 81, null,
  79, null, 83, 86, 91, null, 89, 86, 88, 86, 83, 81, 79, 77, 74, null,
  76, 79, 84, 88, 91, null, 88, 84, 86, 84, 79, 76, 72, null, null, null,
];

const BAR_ROOTS = [48, 55, 53, 55, 45, 53, 55, 48];
const CHORDS = [
  [60, 64, 67],
  [59, 62, 67],
  [60, 65, 69],
  [59, 62, 67],
  [60, 64, 69],
  [60, 65, 69],
  [59, 62, 67],
  [60, 64, 67],
];

let timer: ReturnType<typeof setInterval> | null = null;
let nextStepAt = 0;
let step = 0;
let activeSources = new Set<AudioScheduledSourceNode>();

function hz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function track(source: AudioScheduledSourceNode): void {
  activeSources.add(source);
  source.onended = () => activeSources.delete(source);
}

function tone(
  context: AudioContext,
  bus: GainNode,
  midi: number,
  at: number,
  duration: number,
  type: OscillatorType,
  peak: number,
): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.value = hz(midi);
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(peak, at + 0.004);
  gain.gain.setValueAtTime(peak, at + Math.max(0.005, duration - 0.018));
  gain.gain.linearRampToValueAtTime(0.0001, at + duration);
  oscillator.connect(gain);
  gain.connect(bus);
  track(oscillator);
  oscillator.start(at);
  oscillator.stop(at + duration + 0.02);
}

function noise(
  context: AudioContext,
  bus: GainNode,
  at: number,
  duration: number,
  peak: number,
  frequency: number,
): void {
  const size = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, size, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = 'highpass';
  filter.frequency.value = frequency;
  gain.gain.setValueAtTime(peak, at);
  gain.gain.linearRampToValueAtTime(0.0001, at + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(bus);
  track(source);
  source.start(at);
  source.stop(at + duration + 0.01);
}

function scheduleStep(context: AudioContext, bus: GainNode, index: number, at: number): void {
  const phraseStep = index % LEAD.length;
  const barStep = phraseStep % 16;
  const bar = Math.floor(phraseStep / 16);
  const lead = LEAD[phraseStep];

  if (lead !== null) {
    const accent = barStep === 0 || barStep === 4 || barStep === 8 || barStep === 12;
    tone(context, bus, lead, at, STEP_SECONDS * (accent ? 0.9 : 0.7), 'square', accent ? 0.125 : 0.095);
    if (accent) {
      tone(context, bus, lead - 12, at, STEP_SECONDS * 0.82, 'sawtooth', 0.038);
    }
  }

  if (barStep % 4 === 0) {
    const root = BAR_ROOTS[bar];
    const bassNote = barStep === 12 && bar === 6 ? root + 2 : root;
    tone(context, bus, bassNote, at, STEP_SECONDS * 3.35, 'triangle', 0.17);
  }

  // Broad sustained harmony makes the tune read as a fight-song fanfare
  // instead of a single chiptune melody.
  if (barStep === 0 || barStep === 8) {
    for (const note of CHORDS[bar]) {
      tone(context, bus, note, at, STEP_SECONDS * 7.2, 'triangle', 0.032);
    }
  }

  if (barStep === 0 || barStep === 8) {
    tone(context, bus, 36, at, STEP_SECONDS * 1.55, 'sine', 0.19);
  }
  if (barStep === 4 || barStep === 12) {
    noise(context, bus, at, STEP_SECONDS * 0.85, 0.09, 1200);
  } else if (barStep % 2 === 0) {
    noise(context, bus, at, STEP_SECONDS * 0.3, 0.032, 4800);
  }
}

function schedule(): void {
  const context = ensureRunning();
  const bus = musicBus();
  if (!context || !bus) return;
  while (nextStepAt < context.currentTime + LOOKAHEAD_SECONDS) {
    scheduleStep(context, bus, step, nextStepAt);
    step = (step + 1) % LEAD.length;
    nextStepAt += STEP_SECONDS;
  }
}

/** Starts or resumes the loop. Safe to call after every user gesture. */
export function startMusic(): void {
  if (timer !== null || getVolumes().music === 0) return;
  const context = ensureRunning();
  if (!context || !musicBus()) return;
  step = 0;
  nextStepAt = context.currentTime + 0.04;
  schedule();
  timer = setInterval(schedule, SCHEDULER_MS);
}

/** Stops the sequencer and any notes already queued by its lookahead. */
export function stopMusic(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  for (const source of activeSources) {
    try { source.stop(); } catch {}
  }
  activeSources.clear();
}

export function isMusicPlaying(): boolean {
  return timer !== null;
}

export const __test = {
  get bpm() { return BPM; },
  get stepCount() { return LEAD.length; },
};
