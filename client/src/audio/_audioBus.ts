// Shared audio bus — one AudioContext with a 4-channel mix (Master / Music /
// Crowd / SFX). Both synth.ts (SFX), music.ts (BG music), and crowd.ts
// (ambient + chants) route through this bus so the VolumePanel can mix each
// channel independently.
//
// Treat this module as internal: external consumers should import from
// synth.ts / music.ts / crowd.ts directly. Tests can poke at `__test` for
// state inspection.

export type Channel = 'master' | 'music' | 'crowd' | 'sfx';

export interface Volumes {
  master: number;
  music: number;
  crowd: number;
  sfx: number;
}

export const DEFAULT_VOLUMES: Volumes = {
  master: 0.7,
  music: 0.35,
  crowd: 0.4,
  sfx: 0.7,
};

const LS_VOL = 'gridiron:audio_volumes';

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let musicGain: GainNode | null = null;
let crowdGain: GainNode | null = null;
let sfxGain: GainNode | null = null;

export let volumes: Volumes = { ...DEFAULT_VOLUMES };

export function isAudioReady(): boolean {
  return ctx !== null;
}

/** Idempotent. Creates the AudioContext and 4-bus mixer on first call. */
export function initAudio(): void {
  if (ctx) {
    ensureRunning();
    return;
  }
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const newCtx: AudioContext = new AC();
    const master = newCtx.createGain();
    const music = newCtx.createGain();
    const crowd = newCtx.createGain();
    const sfx = newCtx.createGain();
    // Hydrate from localStorage BEFORE initial gain assignment
    try {
      const raw = localStorage.getItem(LS_VOL);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (isVolumes(parsed)) volumes = parsed;
      }
    } catch {}
    master.gain.value = volumes.master;
    music.gain.value = volumes.music;
    crowd.gain.value = volumes.crowd;
    sfx.gain.value = volumes.sfx;
    music.connect(master);
    crowd.connect(master);
    sfx.connect(master);
    master.connect(newCtx.destination);

    ctx = newCtx;
    masterGain = master;
    musicGain = music;
    crowdGain = crowd;
    sfxGain = sfx;
  } catch {
    ctx = null;
    masterGain = null;
    musicGain = null;
    crowdGain = null;
    sfxGain = null;
  }
}

function isVolumes(v: any): v is Volumes {
  return (
    v && typeof v === 'object' &&
    typeof v.master === 'number' && typeof v.music === 'number' &&
    typeof v.crowd === 'number' && typeof v.sfx === 'number'
  );
}

export function setVolume(channel: Channel, value: number): void {
  const v = Math.max(0, Math.min(1, value));
  volumes = { ...volumes, [channel]: v };
  if (ctx && masterGain && musicGain && crowdGain && sfxGain) {
    const gain = channelGain(channel);
    if (gain) {
      gain.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
    }
  }
  try {
    localStorage.setItem(LS_VOL, JSON.stringify(volumes));
  } catch {}
}

export function setVolumes(v: Partial<Volumes>): void {
  if (v.master !== undefined) setVolume('master', v.master);
  if (v.music !== undefined) setVolume('music', v.music);
  if (v.crowd !== undefined) setVolume('crowd', v.crowd);
  if (v.sfx !== undefined) setVolume('sfx', v.sfx);
}

export function getVolumes(): Volumes {
  return { ...volumes };
}

export function setMuted(muted: boolean): void {
  setVolume('master', muted ? 0 : DEFAULT_VOLUMES.master);
}

export function isMuted(): boolean {
  return volumes.master === 0;
}

/** Make sure the AudioContext is running (some browsers auto-suspend). */
export function ensureRunning(): AudioContext | null {
  if (!ctx) return null;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  return ctx;
}

/** Alias used by music.ts to schedule against the running context. */
export function ensureRunningCtx(): AudioContext | null {
  return ensureRunning();
}

/** Return the gain node for a given channel — falls back to master if not yet
 *  initialized. Returns null only if initAudio() has never been called. */
export function busFor(channel: Channel): GainNode | null {
  if (!ctx) return null;
  return channelGain(channel) ?? masterGain;
}

/** Bus gain for music. Returns null only before initAudio() runs. */
export function musicBus(): GainNode | null {
  if (!ctx) return null;
  return musicGain ?? masterGain;
}

/** Bus gain for crowd. */
export function crowdBus(): GainNode | null {
  if (!ctx) return null;
  return crowdGain ?? masterGain;
}

/** Bus gain for SFX. */
export function sfxBus(): GainNode | null {
  if (!ctx) return null;
  return sfxGain ?? masterGain;
}

function channelGain(channel: Channel): GainNode | null {
  if (channel === 'master') return masterGain;
  if (channel === 'music') return musicGain;
  if (channel === 'crowd') return crowdGain;
  return sfxGain;
}

// === Test introspection ======================================================

export const __test = {
  get ctx() { return ctx; },
  get master() { return masterGain; },
  get music() { return musicGain; },
  get crowd() { return crowdGain; },
  get sfx() { return sfxGain; },
  reset() {
    ctx = null;
    masterGain = null;
    musicGain = null;
    crowdGain = null;
    sfxGain = null;
    volumes = { ...DEFAULT_VOLUMES };
  },
};