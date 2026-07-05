// Shared audio bus — one AudioContext with a 3-channel mix (Master / Crowd /
// SFX). Both synth.ts (SFX) and crowd.ts (swells) route through this bus so
// the VolumePanel can mix each channel independently.
//
// Treat this module as internal: external consumers should import from
// synth.ts / crowd.ts directly. Tests can poke at `__test` for state.

export type Channel = 'master' | 'crowd' | 'sfx';

export interface Volumes {
  master: number;
  crowd: number;
  sfx: number;
}

export const DEFAULT_VOLUMES: Volumes = {
  master: 0.7,
  crowd: 0.5,
  sfx: 0.7,
};

const LS_VOL = 'gridiron:audio_volumes';

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let crowdGain: GainNode | null = null;
let sfxGain: GainNode | null = null;

export let volumes: Volumes = { ...DEFAULT_VOLUMES };

export function isAudioReady(): boolean {
  return ctx !== null;
}

/** Idempotent. Creates the AudioContext and 3-bus mixer on first call. */
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
    const crowd = newCtx.createGain();
    const sfx = newCtx.createGain();
    try {
      const raw = localStorage.getItem(LS_VOL);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (isVolumes(parsed)) volumes = parsed;
      }
    } catch {}
    master.gain.value = volumes.master;
    crowd.gain.value = volumes.crowd;
    sfx.gain.value = volumes.sfx;
    crowd.connect(master);
    sfx.connect(master);
    master.connect(newCtx.destination);

    ctx = newCtx;
    masterGain = master;
    crowdGain = crowd;
    sfxGain = sfx;
  } catch {
    ctx = null;
    masterGain = null;
    crowdGain = null;
    sfxGain = null;
  }
}

function isVolumes(v: any): v is Volumes {
  return (
    v && typeof v === 'object' &&
    typeof v.master === 'number' && typeof v.crowd === 'number' &&
    typeof v.sfx === 'number'
  );
}

export function setVolume(channel: Channel, value: number): void {
  const v = Math.max(0, Math.min(1, value));
  volumes = { ...volumes, [channel]: v };
  if (ctx && masterGain && crowdGain && sfxGain) {
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

export function ensureRunning(): AudioContext | null {
  if (!ctx) return null;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  return ctx;
}

/** Bus gain for a channel. Returns null only before initAudio() runs. */
export function busFor(channel: Channel): GainNode | null {
  if (!ctx) return null;
  return channelGain(channel) ?? masterGain;
}

/** Bus gain for crowd swells. */
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
  if (channel === 'crowd') return crowdGain;
  return sfxGain;
}

// === Test introspection ======================================================

export const __test = {
  get ctx() { return ctx; },
  get master() { return masterGain; },
  get crowd() { return crowdGain; },
  get sfx() { return sfxGain; },
  reset() {
    ctx = null;
    masterGain = null;
    crowdGain = null;
    sfxGain = null;
    volumes = { ...DEFAULT_VOLUMES };
  },
};