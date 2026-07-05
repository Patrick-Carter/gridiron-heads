// Verifies that for every parent/sub combination we have a defensible default
// in the canvas animation strategy. This is a guard test: if anyone adds a
// new PlaySub or PlayParent, it forces them to extend the strategy switch.
//
// NOTE: This doesn't import the actual canvas (which would require JSDOM +
// canvas package); it just locks the PLAYKEY_SET so the canvas author knows
// what cases they're responsible for.

import { describe, it, expect } from 'vitest';
import { SUB_OPTIONS_BY_PARENT, type PlayParent } from '../src/types.js';

const PLAYKEY_SET = new Set([
  'run-inside',
  'run-outside',
  'pass-deep',
  'pass-short',
  'punt', // parent only — no sub
  'fg',   // parent only — no sub
]);

function playKeysFor(parent: PlayParent): string[] {
  const subs = SUB_OPTIONS_BY_PARENT[parent];
  return subs.length === 0
    ? [parent]
    : subs.map((sub) => `${parent}-${sub}`);
}

describe('canvas play-key strategy coverage (D027)', () => {
  it('every legal parent/sub combo maps to a known playKey', () => {
    const parents: PlayParent[] = ['run', 'pass', 'punt', 'fg'];
    for (const p of parents) {
      const keys = playKeysFor(p);
      for (const k of keys) {
        expect(PLAYKEY_SET.has(k)).toBe(true);
      }
    }
  });

  it('strategy table is exhaustive (no orphan keys)', () => {
    // Every key in the strategy table should map back to a legal parent/sub.
    const all = new Set<string>();
    for (const p of ['run', 'pass', 'punt', 'fg'] as PlayParent[]) {
      for (const k of playKeysFor(p)) all.add(k);
    }
    for (const k of PLAYKEY_SET) {
      expect(all.has(k)).toBe(true);
    }
  });
});
