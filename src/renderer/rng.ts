/**
 * Deterministic PRNG. Same seed must always produce the same image, otherwise
 * recipes are not reproducible and remix/share stop meaning anything.
 */

export interface Rng {
  next: () => number
  range: (min: number, max: number) => number
  int: (min: number, max: number) => number
  pick: <T>(items: ReadonlyArray<T>) => T
  bool: (probability?: number) => boolean
}

/** xmur3 string hash — turns an arbitrary seed string into a 32-bit state. */
function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return h >>> 0
}

/** mulberry32 — small, fast, good enough distribution for visual work. */
export function createRng(seed: string): Rng {
  let state = hashSeed(seed)

  const next = () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const range = (min: number, max: number) => min + next() * (max - min)

  return {
    next,
    range,
    int: (min, max) => Math.floor(range(min, max + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    bool: (probability = 0.5) => next() < probability,
  }
}

/** Short human-readable seed, matching the `8f31c2` style in the recipe spec. */
export function randomSeed(): string {
  return Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0')
}
