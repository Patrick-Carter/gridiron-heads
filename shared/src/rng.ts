// Mulberry32 — fast deterministic 32-bit PRNG.
// Same seed → byte-identical sequence.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** d100 roll → integer in [1, 100]. */
export const rollD100 = (rng: () => number): number => Math.floor(rng() * 100) + 1;

/** d21 roll → integer in [0, 20]. Universal kicker bonus (D23). */
export const rollD21 = (rng: () => number): number => Math.floor(rng() * 21);