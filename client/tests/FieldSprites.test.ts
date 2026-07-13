// @vitest-environment jsdom
// Field sprite helpers — pure logic tests (no canvas needed).
// Verifies the FONT_3x5 pixel font, jersey number ranges, and sprite
// config selection. Pixel-perfect render checks would need the `canvas`
// npm package as a devDep; for now we lock the data contract.

import { describe, it, expect } from 'vitest';
import { __test } from '../src/components/Field.jsx';
const {
  FONT_3x5,
  spriteConfigFor,
  jerseyNumFor,
  teamsForPossession,
  computeFrame,
  FIELD_W,
  FIELD_H,
  YARD,
  SPRITE_SIZE,
} = __test;

describe('Field.tsx — pixel font invariants', () => {
  it('every glyph is exactly 3 columns × 5 rows', () => {
    for (const [ch, glyph] of Object.entries(FONT_3x5)) {
      const rows = glyph.split('|');
      expect(rows.length).toBe(5);
      for (const row of rows) {
        expect(row.length).toBe(3);
      }
    }
  });

  it('glyphs only contain "." (empty) and "X" (filled)', () => {
    for (const glyph of Object.values(FONT_3x5)) {
      expect(glyph).toMatch(/^[\.X|]+$/);
    }
  });

  it('every A-Z and 0-9 has a glyph (no missing characters)', () => {
    const need = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
    for (const ch of need) {
      expect(FONT_3x5[ch], `missing glyph for "${ch}"`).toBeTruthy();
    }
  });
});

describe('Field.tsx — canvas dimensions', () => {
  it('canvas is low-res for pixelated upscale (480x270)', () => {
    expect(FIELD_W).toBe(480);
    expect(FIELD_H).toBe(270);
  });

  it('YARD is FIELD_W / 100 = 4.8 px per yard', () => {
    expect(YARD).toBeCloseTo(4.8);
  });

  it('SPRITE_SIZE is 10 (10x10 player sprite)', () => {
    expect(SPRITE_SIZE).toBe(10);
  });
});

describe('Field.tsx — jersey numbers', () => {
  it('QB gets a number in [1, 19]', () => {
    for (let s = 0; s < 25; s++) {
      const n = jerseyNumFor('Q', s);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(19);
    }
  });

  it('RB gets a number in [20, 49]', () => {
    for (let s = 0; s < 25; s++) {
      const n = jerseyNumFor('R', s);
      expect(n).toBeGreaterThanOrEqual(20);
      expect(n).toBeLessThanOrEqual(49);
    }
  });

  it('WR gets a number in [80, 89]', () => {
    for (let s = 0; s < 25; s++) {
      const n = jerseyNumFor('W', s);
      expect(n).toBeGreaterThanOrEqual(80);
      expect(n).toBeLessThanOrEqual(89);
    }
  });

  it('CB gets a number in [20, 29]', () => {
    for (let s = 0; s < 25; s++) {
      const n = jerseyNumFor('C', s);
      expect(n).toBeGreaterThanOrEqual(20);
      expect(n).toBeLessThanOrEqual(29);
    }
  });

  it('O-LINE gets a number in [60, 79]', () => {
    for (let s = 0; s < 25; s++) {
      const n = jerseyNumFor('O', s);
      expect(n).toBeGreaterThanOrEqual(60);
      expect(n).toBeLessThanOrEqual(79);
    }
  });

  it('D-LINE gets a number in [91, 99]', () => {
    for (let s = 0; s < 25; s++) {
      const n = jerseyNumFor('D', s);
      expect(n).toBeGreaterThanOrEqual(91);
      expect(n).toBeLessThanOrEqual(99);
    }
  });

  it('jersey numbers are deterministic per (role, slot)', () => {
    expect(jerseyNumFor('Q', 0)).toBe(jerseyNumFor('Q', 0));
    expect(jerseyNumFor('R', 5)).toBe(jerseyNumFor('R', 5));
  });
});

describe('Field.tsx — sprite config selection', () => {
  it('QB gets a small helmet with visor', () => {
    const cfg = spriteConfigFor('Q', 0, 0);
    expect(cfg.helmetStyle).toBe('small');
    expect(cfg.visor).toBe(true);
    expect(cfg.showNumber).toBe(true);
  });

  it('RB gets a big helmet without visor', () => {
    const cfg = spriteConfigFor('R', 0, 0);
    expect(cfg.helmetStyle).toBe('big');
    expect(cfg.visor).toBe(false);
    expect(cfg.showNumber).toBe(true);
  });

  it('O-LINE gets a flat helmet without visor/number', () => {
    const cfg = spriteConfigFor('O', 0, 0);
    expect(cfg.helmetStyle).toBe('flat');
    expect(cfg.visor).toBe(false);
    expect(cfg.showNumber).toBe(false);
  });

  it('D-LINE gets a round helmet without visor/number', () => {
    const cfg = spriteConfigFor('D', 1, 0);
    expect(cfg.helmetStyle).toBe('round');
    expect(cfg.visor).toBe(false);
    expect(cfg.showNumber).toBe(false);
  });

  it('team 0 uses cream/yellow palette, team 1 uses maroon/navy', () => {
    const t0 = spriteConfigFor('Q', 0, 0);
    const t1 = spriteConfigFor('Q', 1, 0);
    expect(t0.jersey).not.toBe(t1.jersey);
    expect(t0.helmet).not.toBe(t1.helmet);
  });

  it('WR and CB both get flat helmets but with visor (skill position)', () => {
    const wr = spriteConfigFor('W', 0, 0);
    const cb = spriteConfigFor('C', 1, 0);
    expect(wr.helmetStyle).toBe('flat');
    expect(wr.visor).toBe(true);
    expect(cb.helmetStyle).toBe('flat');
    expect(cb.visor).toBe(true);
  });
});

describe('Field.tsx — play animation selection', () => {
  const ctx = {} as CanvasRenderingContext2D;
  const canvas = { width: FIELD_W, height: FIELD_H } as HTMLCanvasElement;

  function frame(parent: string, sub: string, progress: number) {
    return computeFrame(ctx, canvas, {
      yardline_before: 50,
      yards: 12,
      off_call: { parent, sub },
      scoring_event: null,
    }, progress, 1, 0);
  }

  it('uses the run-inside and run-outside branches for the ball carrier', () => {
    expect(frame('run', 'inside', 0.25).positions.some((p) => p.role === 'R')).toBe(true);
    expect(frame('run', 'outside', 0.25).positions.some((p) => p.role === 'R')).toBe(true);
  });

  it('uses the pass-deep and pass-short QB drop branches', () => {
    const deepQb = frame('pass', 'deep', 0.5).positions.find((p) => p.role === 'Q');
    const shortQb = frame('pass', 'short', 0.5).positions.find((p) => p.role === 'Q');

    expect(deepQb?.x).toBe(182);
    expect(shortQb?.x).toBe(209);
  });

  it('snaps punts backward and lands at the authoritative yardline', () => {
    const result = {
      yardline_before: 50,
      yardline_after: 70,
      yards: 20,
      off_call: { parent: 'punt', sub: 'inside' },
      scoring_event: null,
    };
    const snap = computeFrame(ctx, canvas, result, 0.3, 1, 0);
    const landing = computeFrame(ctx, canvas, result, 1, 1, 0);

    expect(snap.ball.x).toBeLessThan(FIELD_W / 2);
    expect(landing.ball.x).toBeCloseTo(FIELD_W * 0.7);
  });

  it('snaps field goals backward before kicking toward the goal', () => {
    const result = {
      yardline_before: 70,
      yardline_after: 70,
      yards: 0,
      off_call: { parent: 'fg', sub: 'inside' },
      scoring_event: 'fg',
    };
    const snap = computeFrame(ctx, canvas, result, 0.2, 1, 0);
    const kick = computeFrame(ctx, canvas, result, 1, 1, 0);

    expect(snap.ball.x).toBeLessThan(FIELD_W * 0.7);
    expect(kick.ball.x).toBe(FIELD_W);
  });
});

describe('Field.tsx — possession palettes', () => {
  it('maps the possessing team to offense for static lineups', () => {
    expect(teamsForPossession(0)).toEqual([0, 1]);
    expect(teamsForPossession(1)).toEqual([1, 0]);
  });

  it('assigns animated offensive and defensive sprites from possession', () => {
    const frame = computeFrame(
      {} as CanvasRenderingContext2D,
      { width: FIELD_W, height: FIELD_H } as HTMLCanvasElement,
      {
        yardline_before: 50,
        yards: 8,
        off_call: { parent: 'pass', sub: 'short' },
        scoring_event: null,
      },
      0.25,
      -1,
      1,
    );

    const offense = frame.positions.filter((p) => p.role !== 'D' && p.role !== 'C');
    const defense = frame.positions.filter((p) => p.role === 'D' || p.role === 'C');
    expect(offense.every((p) => p.team === 1)).toBe(true);
    expect(defense.every((p) => p.team === 0)).toBe(true);
  });
});
