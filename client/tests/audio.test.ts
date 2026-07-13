// @vitest-environment jsdom
// Audio system tests — verify big-play detection logic + smoke-test that
// the SFX / crowd-swells don't throw against a minimal AudioContext mock.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';

// Minimal AudioContext mock — records calls without actually playing audio.
function installMockAudioContext() {
  class MockNode {
    context: any;
    frequency = { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
    type: any = 'sine';
    buffer: any = null;
    loop = false;
    Q = { value: 1 };
    gain: any;
    constructor(ctx: any) {
      this.context = ctx;
      this.gain = {
        value: 0,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        setTargetAtTime: vi.fn(),
      };
    }
    connect() { return this; }
    disconnect() {}
    start() {}
    stop() {}
  }
  class MockOscillator extends MockNode { constructor(ctx: any) { super(ctx); this.type = 'sine'; } }
  class MockGain extends MockNode { constructor(ctx: any) { super(ctx); } }
  class MockBufferSource extends MockNode { constructor(ctx: any) { super(ctx); this.buffer = null; this.loop = false; } }
  class MockBiquad extends MockNode { constructor(ctx: any) { super(ctx); } }
  class MockBuffer {
    constructor(_ch: number, _size: number, _rate: number) {}
    getChannelData() { return new Float32Array(8); }
  }
  class MockAudioContext {
    state = 'running';
    currentTime = 0;
    destination = {};
    createOscillator() { return new MockOscillator(this); }
    createGain() { return new MockGain(this); }
    createBufferSource() { return new MockBufferSource(this); }
    createBiquadFilter() { return new MockBiquad(this); }
    createBuffer(ch: number, size: number, rate: number) { return new MockBuffer(ch, size, rate); }
    resume() { return Promise.resolve(); }
  }
  (globalThis as any).AudioContext = MockAudioContext;
  return MockAudioContext;
}

beforeEach(() => {
  try { localStorage.clear(); } catch {}
  vi.resetModules();
});

describe('big-play detection', () => {
  it('scoring plays are always big', async () => {
    const { isBigPlay } = await import('../src/audio/crowd.js');
    expect(isBigPlay({ yards: -5, distance: 10, scoring_event: 'td', turnover: false })).toBe(true);
    expect(isBigPlay({ yards: 0, distance: 30, scoring_event: 'fg', turnover: false })).toBe(true);
    expect(isBigPlay({ yards: -99, distance: 1, scoring_event: 'safety', turnover: false })).toBe(true);
  });

  it('turnovers without scoring are big', async () => {
    const { isBigPlay } = await import('../src/audio/crowd.js');
    expect(isBigPlay({ yards: 5, distance: 10, scoring_event: null, turnover: true })).toBe(true);
  });

  it('1st-down conversions are big', async () => {
    const { isBigPlay } = await import('../src/audio/crowd.js');
    // exactly meets distance
    expect(isBigPlay({ yards: 5, distance: 5, scoring_event: null, turnover: false })).toBe(true);
    // exceeds distance
    expect(isBigPlay({ yards: 12, distance: 8, scoring_event: null, turnover: false })).toBe(true);
  });

  it('plays below threshold and below distance are not big', async () => {
    const { isBigPlay } = await import('../src/audio/crowd.js');
    expect(isBigPlay({ yards: 3, distance: 10, scoring_event: null, turnover: false })).toBe(false);
    expect(isBigPlay({ yards: 0, distance: 10, scoring_event: null, turnover: false })).toBe(false);
    expect(isBigPlay({ yards: -2, distance: 10, scoring_event: null, turnover: false })).toBe(false);
  });

  it('20+ yard plays are big even if no 1st down', async () => {
    const { isBigPlay, BIG_PLAY_YARD_THRESHOLD } = await import('../src/audio/crowd.js');
    // Imagine 1st-and-10, gain 22 yards → big play even though it converts
    expect(isBigPlay({ yards: 22, distance: 10, scoring_event: null, turnover: false })).toBe(true);
    // 1st-and-20, gain exactly 20 → big by yard threshold
    expect(isBigPlay({ yards: 20, distance: 20, scoring_event: null, turnover: false })).toBe(true);
    // 1st-and-25, gain 19 → no first down, below 20 → not big
    expect(isBigPlay({ yards: 19, distance: 25, scoring_event: null, turnover: false })).toBe(false);
    expect(BIG_PLAY_YARD_THRESHOLD).toBe(20);
  });

  it('undefined yardage defaults to 0', async () => {
    const { isBigPlay } = await import('../src/audio/crowd.js');
    expect(isBigPlay({ scoring_event: null, turnover: false })).toBe(false);
  });
});

describe('audio bus — volume + persistence', () => {
  it('default volumes are sane (0..1)', async () => {
    const bus = await import('../src/audio/_audioBus.js');
    expect(bus.volumes.master).toBeGreaterThan(0);
    expect(bus.volumes.master).toBeLessThanOrEqual(1);
    for (const ch of ['music', 'crowd', 'sfx'] as const) {
      expect(bus.volumes[ch]).toBeGreaterThanOrEqual(0);
      expect(bus.volumes[ch]).toBeLessThanOrEqual(1);
    }
  });

  it('setVolume clamps to [0,1] and persists to localStorage', async () => {
    const bus = await import('../src/audio/_audioBus.js');
    bus.setVolume('sfx', 0.5);
    expect(bus.getVolumes().sfx).toBeCloseTo(0.5);
    bus.setVolume('sfx', 5); // clamps
    expect(bus.getVolumes().sfx).toBe(1);
    bus.setVolume('sfx', -1); // clamps
    expect(bus.getVolumes().sfx).toBe(0);
    const raw = localStorage.getItem('gridiron:audio_volumes');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.sfx).toBe(0);
  });

  it('setMuted toggles master gain to 0', async () => {
    const bus = await import('../src/audio/_audioBus.js');
    bus.setMuted(true);
    expect(bus.isMuted()).toBe(true);
    expect(bus.getVolumes().master).toBe(0);
    bus.setMuted(false);
    expect(bus.isMuted()).toBe(false);
    expect(bus.getVolumes().master).toBeGreaterThan(0);
  });

  it('setVolumes updates multiple channels at once', async () => {
    const bus = await import('../src/audio/_audioBus.js');
    bus.setVolumes({ music: 0.1, crowd: 0.2, sfx: 0.3 });
    expect(bus.getVolumes().music).toBeCloseTo(0.1);
    expect(bus.getVolumes().crowd).toBeCloseTo(0.2);
    expect(bus.getVolumes().sfx).toBeCloseTo(0.3);
  });

  it('preserves old 3-channel settings when adding the music channel', async () => {
    localStorage.setItem('gridiron:audio_volumes', JSON.stringify({
      master: 0.4,
      crowd: 0.2,
      sfx: 0.6,
    }));
    installMockAudioContext();
    const bus = await import('../src/audio/_audioBus.js');
    bus.initAudio();
    expect(bus.getVolumes()).toEqual({
      master: 0.4,
      music: bus.DEFAULT_VOLUMES.music,
      crowd: 0.2,
      sfx: 0.6,
    });
  });
});

describe('music sequencer', () => {
  it('starts once, exposes its score metadata, and stops cleanly', async () => {
    installMockAudioContext();
    const bus = await import('../src/audio/_audioBus.js');
    const music = await import('../src/audio/music.js');
    bus.initAudio();

    expect(music.__test.bpm).toBeGreaterThan(120);
    expect(music.__test.stepCount).toBe(128);
    expect(music.isMusicPlaying()).toBe(false);
    expect(() => music.startMusic()).not.toThrow();
    expect(music.isMusicPlaying()).toBe(true);
    expect(() => music.startMusic()).not.toThrow();
    music.stopMusic();
    expect(music.isMusicPlaying()).toBe(false);
  });

  it('does not start while the music channel is muted', async () => {
    installMockAudioContext();
    const bus = await import('../src/audio/_audioBus.js');
    const music = await import('../src/audio/music.js');
    bus.initAudio();
    bus.setVolume('music', 0);
    music.startMusic();
    expect(music.isMusicPlaying()).toBe(false);
  });
});

describe('music controls', () => {
  it('offers a persistent music-only mute toggle', async () => {
    installMockAudioContext();
    const { default: VolumePanel } = await import('../src/components/VolumePanel.js');
    const bus = await import('../src/audio/_audioBus.js');
    const music = await import('../src/audio/music.js');
    render(createElement(VolumePanel));

    fireEvent.click(screen.getByTestId('volume-toggle'));
    fireEvent.click(screen.getByTestId('music-toggle'));
    expect(bus.getVolumes().music).toBe(0);
    expect(JSON.parse(localStorage.getItem('gridiron:audio_volumes')!).music).toBe(0);

    fireEvent.click(screen.getByTestId('music-toggle'));
    expect(bus.getVolumes().music).toBeGreaterThan(0);
    expect(music.isMusicPlaying()).toBe(true);
    music.stopMusic();
  });
});

describe('SFX smoketests — do not throw with a mock AudioContext', () => {
  it('all SFX calls run without throwing after init', async () => {
    installMockAudioContext();
    const synth = await import('../src/audio/synth.js');
    synth.initAudio();
    expect(() => synth.playSnap()).not.toThrow();
    expect(() => synth.playThud(1)).not.toThrow();
    expect(() => synth.playBlock(0.8, 2)).not.toThrow();
    expect(() => synth.playHandoff()).not.toThrow();
    expect(() => synth.playPassRelease()).not.toThrow();
    expect(() => synth.playCatch()).not.toThrow();
    expect(() => synth.playBallBounce()).not.toThrow();
    expect(() => synth.playLooseBall()).not.toThrow();
    expect(() => synth.playWhistle()).not.toThrow();
    expect(() => synth.playTdSiren()).not.toThrow();
    expect(() => synth.playFgBell()).not.toThrow();
    expect(() => synth.playFgMiss()).not.toThrow();
    expect(() => synth.playTurnover()).not.toThrow();
    expect(() => synth.playUiClick()).not.toThrow();
    expect(() => synth.playUiHover()).not.toThrow();
    expect(() => synth.playSchemeSelect()).not.toThrow();
    expect(() => synth.playAudible()).not.toThrow();
    expect(() => synth.playDraftPick()).not.toThrow();
    expect(() => synth.playCoinFlip()).not.toThrow();
    expect(() => synth.playPossessionChange()).not.toThrow();
    expect(() => synth.playDownChange()).not.toThrow();
    expect(() => synth.playPointScored()).not.toThrow();
    expect(() => synth.playVictory()).not.toThrow();
    expect(() => synth.playDefeat()).not.toThrow();
    expect(() => synth.playKickoff()).not.toThrow();
    expect(() => synth.playIncomplete()).not.toThrow();
    expect(() => synth.playError()).not.toThrow();
  });

  it('SFX before initAudio() are silent no-ops (no throw)', async () => {
    installMockAudioContext();
    const synth = await import('../src/audio/synth.js');
    expect(() => synth.playSnap()).not.toThrow();
    expect(() => synth.playTdSiren()).not.toThrow();
  });
});

describe('crowd roar smoketests', () => {
  it('playCrowdRoar is silent when context not initialized', async () => {
    installMockAudioContext();
    const crowd = await import('../src/audio/crowd.js');
    expect(() => crowd.playCrowdRoar(1)).not.toThrow();
    expect(() => crowd.playCrowdRoar(1.5)).not.toThrow();
    expect(() => crowd.playCrowdRoar(2)).not.toThrow();
  });

  it('playCrowdRoar runs without throwing after init', async () => {
    installMockAudioContext();
    const crowd = await import('../src/audio/crowd.js');
    const { initAudio } = await import('../src/audio/_audioBus.js');
    initAudio();
    expect(() => crowd.playCrowdRoar(1)).not.toThrow();
    expect(() => crowd.playCrowdRoar(0.5)).not.toThrow();
    expect(() => crowd.playCrowdRoar(2)).not.toThrow();
  });

  it('runs and stops the continuous stadium bed', async () => {
    installMockAudioContext();
    const crowd = await import('../src/audio/crowd.js');
    const { initAudio } = await import('../src/audio/_audioBus.js');
    initAudio();
    expect(crowd.isCrowdAmbiencePlaying()).toBe(false);
    expect(() => crowd.startCrowdAmbience()).not.toThrow();
    expect(crowd.isCrowdAmbiencePlaying()).toBe(true);
    expect(() => crowd.playCrowdReaction(0.6)).not.toThrow();
    crowd.stopCrowdAmbience();
    expect(crowd.isCrowdAmbiencePlaying()).toBe(false);
  });
});
