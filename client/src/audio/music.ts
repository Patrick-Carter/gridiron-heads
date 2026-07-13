// Original 16-bit football march. Square-wave melody, triangle bass, and
// noise percussion evoke an early-'90s console soundtrack without audio
// samples or recreating music from an existing game.

import { ensureRunning, getVolumes, musicBus } from './_audioBus.js';

const BPM = 138;
const STEP_SECONDS = 60 / BPM / 4;
const LOOKAHEAD_SECONDS = 0.2;
const SCHEDULER_MS = 75;

// Four bars of sixteenth notes. MIDI note numbers keep the score readable.
const LEAD: Array<number | null> = [
  72, null, 76, 79, 81, null, 79, 76, 74, null, 76, 77, 79, null, 76, null,
  72, null, 76, 79, 84, null, 83, 79, 81, null, 79, 76, 74, null, 71, null,
  69, null, 72, 76, 77, null, 76, 72, 74, null, 76, 77, 79, 77, 76, null,
  72, 72, 74, 76, 79, null, 76, 74, 72, null, 67, 71, 72, null, null, null,
];

const ROOTS = [48, 48, 53, 55, 48, 45, 53, 55, 48, 48, 53, 55, 45, 53, 55, 48];

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
  const lead = LEAD[phraseStep];

  if (lead !== null) {
    tone(context, bus, lead, at, STEP_SECONDS * 0.72, 'square', 0.105);
    if (barStep === 0 || barStep === 8) {
      tone(context, bus, lead - 12, at, STEP_SECONDS * 0.65, 'triangle', 0.045);
    }
  }

  if (barStep % 4 === 0) {
    const root = ROOTS[Math.floor(phraseStep / 4)];
    tone(context, bus, root, at, STEP_SECONDS * 3.2, 'triangle', 0.15);
  }

  if (barStep === 0 || barStep === 8) {
    tone(context, bus, 36, at, STEP_SECONDS * 1.4, 'sine', 0.16);
  }
  if (barStep === 4 || barStep === 12) {
    noise(context, bus, at, STEP_SECONDS * 0.8, 0.07, 1200);
  } else if (barStep % 2 === 0) {
    noise(context, bus, at, STEP_SECONDS * 0.28, 0.025, 4800);
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
