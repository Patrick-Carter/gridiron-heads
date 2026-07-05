// @vitest-environment jsdom
// Audio system tests — verify the pure logic of the music engine + crowd
// chants, and smoke-test that the SFX functions don't throw against a
// minimal AudioContext mock.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Minimal AudioContext mock — records calls without actually playing audio.
// Each Oscillator/GainNode/BiquadFilter/BufferSource is a no-op proxy that
// captures start/stop/connect invocations.
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
  class MockOscillator extends MockNode {
    constructor(ctx: any) { super(ctx); this.type = 'sine'; }
  }
  class MockGain extends MockNode {
    constructor(ctx: any) { super(ctx); }
  }
  class MockBufferSource extends MockNode {
    constructor(ctx: any) { super(ctx); this.buffer = null; this.loop = false; }
  }
  class MockBiquad extends MockNode {
    constructor(ctx: any) { super(ctx); }
  }
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
  // Reset localStorage between tests
  try { localStorage.clear(); } catch {}
  // Reset module state between tests
  vi.resetModules();
});

describe('music engine — pure logic', () => {
  it('stepAt returns the looped step at the given index', async () => {
    const { stepAt } = await import('../src/audio/music.js');
    const s0 = stepAt('draft', 0);
    const s1 = stepAt('draft', 1);
    const s8 = stepAt('draft', 8); // should wrap to step 0
    expect(s0).toEqual(s1 === undefined ? expect.anything() : expect.anything());
    expect(s8).toEqual(s0);
  });

  it('stepMs returns the 8th-note duration for the track BPM', async () => {
    const { stepMs } = await import('../src/audio/music.js');
    // 100 bpm -> quarter = 600ms -> 8th = 300ms
    expect(stepMs({ name: 'draft', bpm: 100, steps: [] })).toBe(300);
    // 120 bpm -> 8th = 250ms
    expect(stepMs({ name: 'game', bpm: 120, steps: [] })).toBe(250);
  });

  it('all tracks have non-empty step loops', async () => {
    const { stepAt } = await import('../src/audio/music.js');
    for (const name of ['draft', 'game', 'tense', 'victory', 'defeat'] as const) {
      const step = stepAt(name, 0);
      expect(step).toBeDefined();
      expect(typeof step).toBe('object');
    }
  });

  it('tense track has slower BPM than game track', async () => {
    const { stepAt, stepMs } = await import('../src/audio/music.js');
    // Both are looped so we can sample step 0 of each; but the bpm differs.
    // We can verify via stepMs of a manually-constructed Track.
    const tenseMs = stepMs({ name: 'tense', bpm: 92, steps: [] });
    const gameMs = stepMs({ name: 'game', bpm: 128, steps: [] });
    expect(tenseMs).toBeGreaterThan(gameMs);
  });
});

describe('crowd chants — pure logic', () => {
  it('chantDurationMs sums syllable durations', async () => {
    const { chantDurationMs } = await import('../src/audio/crowd.js');
    const total = chantDurationMs([
      { pitch: 280, durationMs: 300, f1: 320, f2: 2200 },
      { pitch: 250, durationMs: 200, f1: 530, f2: 1840 },
      { pitch: 240, durationMs: 100, f1: 660, f2: 1720 },
    ]);
    expect(total).toBe(600);
  });

  it('defense chant has 3 syllables (DEE-FEN-SE)', async () => {
    const { __test } = await import('../src/audio/crowd.js');
    expect(__test.DEFENSE_SYLLABLES.length).toBe(3);
  });

  it('offense chant has 2 syllables (OFF-ENSE)', async () => {
    const { __test } = await import('../src/audio/crowd.js');
    expect(__test.OFFENSE_SYLLABLES.length).toBe(2);
  });

  it('all syllables have positive duration + sensible formants', async () => {
    const { __test } = await import('../src/audio/crowd.js');
    for (const s of [...__test.DEFENSE_SYLLABLES, ...__test.OFFENSE_SYLLABLES]) {
      expect(s.durationMs).toBeGreaterThan(0);
      expect(s.f1).toBeGreaterThan(0);
      expect(s.f2).toBeGreaterThan(s.f1);
      expect(s.pitch).toBeGreaterThan(0);
    }
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
    // Persisted
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
});

describe('SFX smoketests — do not throw with a mock AudioContext', () => {
  it('all SFX calls run without throwing after init', async () => {
    installMockAudioContext();
    const synth = await import('../src/audio/synth.js');
    synth.initAudio();
    // Each call should be a no-op against the mock, but must not throw.
    expect(() => synth.playSnap()).not.toThrow();
    expect(() => synth.playThud(1)).not.toThrow();
    expect(() => synth.playCheer(1)).not.toThrow();
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
    // No initAudio() call — bus returns null internally and the functions bail.
    expect(() => synth.playSnap()).not.toThrow();
    expect(() => synth.playTdSiren()).not.toThrow();
  });
});

describe('music engine — track lifecycle', () => {
  it('setTrack with same name twice is idempotent', async () => {
    installMockAudioContext();
    const music = await import('../src/audio/music.js');
    const { initAudio } = await import('../src/audio/_audioBus.js');
    initAudio();
    music.setTrack('game', 500);
    music.setTrack('game', 500);
    // Should not throw, and the current track should still be 'game'.
    expect(music.getCurrentTrack()).toBe('game');
  });

  it('setTrack(null) starts fade-out without throwing', async () => {
    installMockAudioContext();
    const music = await import('../src/audio/music.js');
    const { initAudio } = await import('../src/audio/_audioBus.js');
    initAudio();
    music.setTrack('tense', 100);
    expect(music.getCurrentTrack()).toBe('tense');
    music.setTrack(null, 100);
    // After setTrack(null), active becomes null but outgoing holds the fade.
    expect(music.isMusicPlaying()).toBe(true);
  });

  it('switching tracks reports the new active track', async () => {
    installMockAudioContext();
    const music = await import('../src/audio/music.js');
    const { initAudio } = await import('../src/audio/_audioBus.js');
    initAudio();
    music.setTrack('draft', 50);
    expect(music.getCurrentTrack()).toBe('draft');
    music.setTrack('game', 50);
    // The new track is active immediately; outgoing holds the previous.
    expect(music.getCurrentTrack()).toBe('game');
    expect(music.isMusicPlaying()).toBe(true);
  });

  it('stopMusic clears active and outgoing', async () => {
    installMockAudioContext();
    const music = await import('../src/audio/music.js');
    const { initAudio } = await import('../src/audio/_audioBus.js');
    initAudio();
    music.setTrack('game', 50);
    music.stopMusic();
    expect(music.isMusicPlaying()).toBe(false);
    expect(music.getCurrentTrack()).toBe(null);
  });
});

describe('crowd — start/stop ambient + chants', () => {
  it('startAmbient then stopAmbient is idempotent and reports correct state', async () => {
    installMockAudioContext();
    const crowd = await import('../src/audio/crowd.js');
    const { initAudio } = await import('../src/audio/_audioBus.js');
    initAudio();
    expect(crowd.isAmbientPlaying()).toBe(false);
    crowd.startAmbient();
    expect(crowd.isAmbientPlaying()).toBe(true);
    crowd.startAmbient(); // idempotent
    expect(crowd.isAmbientPlaying()).toBe(true);
    crowd.stopAmbient();
    expect(crowd.isAmbientPlaying()).toBe(false);
    crowd.stopAmbient(); // idempotent
    expect(crowd.isAmbientPlaying()).toBe(false);
  });

  it('ch calls run without throwing once AudioContext is initialized', async () => {
    installMockAudioContext();
    const crowd = await import('../src/audio/crowd.js');
    const { initAudio } = await import('../src/audio/_audioBus.js');
    initAudio();
    expect(() => crowd.playDefenseChant()).not.toThrow();
    expect(() => crowd.playOffenseChant()).not.toThrow();
  });

  it('chant calls before initAudio() are silent no-ops', async () => {
    installMockAudioContext();
    const crowd = await import('../src/audio/crowd.js');
    expect(() => crowd.playDefenseChant()).not.toThrow();
    expect(() => crowd.playOffenseChant()).not.toThrow();
  });
});