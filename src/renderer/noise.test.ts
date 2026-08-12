import { describe, expect, it } from 'vitest'
import {
  buildFlowField,
  curl,
  fbm,
  lic,
  noise2,
  ridged,
  sampleFlowField,
  seedToInt,
  warped,
  whiteNoise,
  cellular,
  cellularFbm,
  interference,
} from './noise'

const SEED = seedToInt('test')

/** Sample a field over a grid and report its distribution. */
function survey(
  sample: (x: number, y: number) => number,
  span = 8,
  steps = 40,
) {
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let count = 0

  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const value = sample((i / steps) * span, (j / steps) * span)
      min = Math.min(min, value)
      max = Math.max(max, value)
      sum += value
      count++
    }
  }

  return { min, max, mean: sum / count }
}

describe('noise2', () => {
  it('is deterministic', () => {
    expect(noise2(1.5, 2.25, SEED)).toBe(noise2(1.5, 2.25, SEED))
  })

  it('differs between seeds', () => {
    expect(noise2(1.5, 2.25, SEED)).not.toBe(noise2(1.5, 2.25, SEED + 1))
  })

  it('stays roughly within -1..1', () => {
    const { min, max } = survey((x, y) => noise2(x, y, SEED), 16, 60)
    expect(min).toBeGreaterThan(-1.2)
    expect(max).toBeLessThan(1.2)
  })

  it('is zero at lattice points', () => {
    // Gradient noise has no value at the corners, only a gradient — the dot
    // product with a zero offset vanishes. This is the property that
    // distinguishes it from value noise.
    for (let i = 0; i < 5; i++) {
      expect(Math.abs(noise2(i, i, SEED))).toBeLessThan(1e-9)
    }
  })

  it('is continuous across lattice boundaries', () => {
    const epsilon = 1e-4
    const before = noise2(3 - epsilon, 1.37, SEED)
    const after = noise2(3 + epsilon, 1.37, SEED)
    expect(Math.abs(after - before)).toBeLessThan(0.01)
  })

  it('actually varies across space', () => {
    const { min, max } = survey((x, y) => noise2(x, y, SEED), 8, 30)
    expect(max - min).toBeGreaterThan(0.5)
  })
})

describe('fbm', () => {
  it('is deterministic', () => {
    expect(fbm(0.5, 0.5, SEED)).toBe(fbm(0.5, 0.5, SEED))
  })

  it('stays normalized regardless of octave count', () => {
    for (const octaves of [1, 3, 5, 8]) {
      const { min, max } = survey((x, y) => fbm(x, y, SEED, { octaves }), 8, 30)
      expect(min).toBeGreaterThan(-1.2)
      expect(max).toBeLessThan(1.2)
    }
  })

  it('adds detail with more octaves', () => {
    // Counting local extrema along a line, rather than summing slopes.
    // Amplitude normalization means each octave contributes roughly equally to
    // the *magnitude* of the slope, so a slope sum does not separate the cases;
    // the number of direction changes does, and that is what "detail" means.
    const extrema = (octaves: number) => {
      const samples = Array.from({ length: 2000 }, (_, i) =>
        fbm(i * 0.004, 1, SEED, { octaves }),
      )
      let count = 0
      for (let i = 1; i < samples.length - 1; i++) {
        const rising = samples[i] > samples[i - 1]
        const falling = samples[i] > samples[i + 1]
        if (rising && falling) count++
      }
      return count
    }

    expect(extrema(6)).toBeGreaterThan(extrema(1) * 2)
  })

  it('spans a useful range rather than hugging the mean', () => {
    // A field that never approaches its extremes gives the dither no contrast.
    const { min, max } = survey((x, y) => fbm(x, y, SEED), 12, 50)
    expect(max - min).toBeGreaterThan(0.8)
  })
})

describe('ridged', () => {
  it('is deterministic and bounded', () => {
    expect(ridged(1, 1, SEED)).toBe(ridged(1, 1, SEED))
    const { min, max } = survey((x, y) => ridged(x, y, SEED), 8, 30)
    expect(min).toBeGreaterThanOrEqual(-1.01)
    expect(max).toBeLessThanOrEqual(1.01)
  })

  it('differs from plain fbm', () => {
    expect(ridged(2.3, 1.1, SEED)).not.toBeCloseTo(fbm(2.3, 1.1, SEED), 3)
  })
})

describe('warped', () => {
  it('is deterministic', () => {
    expect(warped(1, 1, SEED, 1.5)).toBe(warped(1, 1, SEED, 1.5))
  })

  it('collapses to fbm at zero strength', () => {
    // With no displacement the warp chain degenerates to a plain lookup, which
    // is a useful sanity anchor on the implementation.
    expect(warped(1.3, 0.7, SEED, 0)).toBeCloseTo(
      fbm(fbm(1.3, 0.7, SEED) * 0 + 1.3, 0.7, SEED + 991),
      6,
    )
  })

  it('diverges from fbm as strength rises', () => {
    const base = fbm(1.3, 0.7, SEED)
    const strong = warped(1.3, 0.7, SEED, 3)
    expect(Math.abs(strong - base)).toBeGreaterThan(0.001)
  })

  it('stays bounded', () => {
    const { min, max } = survey((x, y) => warped(x, y, SEED, 2), 8, 30)
    expect(min).toBeGreaterThan(-1.2)
    expect(max).toBeLessThan(1.2)
  })
})

describe('curl', () => {
  it('returns unit vectors', () => {
    for (let i = 0; i < 50; i++) {
      const [vx, vy] = curl(i * 0.3, i * 0.17, SEED)
      expect(Math.hypot(vx, vy)).toBeCloseTo(1, 6)
    }
  })

  it('is perpendicular to the field gradient', () => {
    // Curl of a scalar potential is divergence-free, which is what keeps
    // streamlines swirling instead of collapsing into sinks.
    const epsilon = 0.0015
    const x = 1.7
    const y = 2.3
    const dx = fbm(x + epsilon, y, SEED) - fbm(x - epsilon, y, SEED)
    const dy = fbm(x, y + epsilon, SEED) - fbm(x, y - epsilon, SEED)
    const [vx, vy] = curl(x, y, SEED)
    expect(vx * dx + vy * dy).toBeCloseTo(0, 6)
  })
})

describe('whiteNoise', () => {
  it('stays in 0..1', () => {
    for (let i = 0; i < 500; i++) {
      const value = whiteNoise(i, i * 7, SEED)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('has a mean near one half', () => {
    let sum = 0
    const n = 5000
    for (let i = 0; i < n; i++) sum += whiteNoise(i % 100, (i / 100) | 0, SEED)
    expect(sum / n).toBeCloseTo(0.5, 1)
  })
})

describe('buildFlowField', () => {
  it('produces unit-length directions', () => {
    const field = buildFlowField(32, 32, 1, 1, SEED, 3)
    for (let i = 0; i < field.vx.length; i++) {
      expect(Math.hypot(field.vx[i], field.vy[i])).toBeCloseTo(1, 5)
    }
  })

  it('matches curl at the sample points it was baked from', () => {
    const field = buildFlowField(17, 17, 1, 1, SEED, 3)
    const [cx, cy] = curl(0.5 * 3, 0.5 * 3, SEED)
    const [sx, sy] = sampleFlowField(field, 0.5, 0.5)
    expect(sx).toBeCloseTo(cx, 5)
    expect(sy).toBeCloseTo(cy, 5)
  })

  it('interpolates without tearing', () => {
    // Bilinear is only C0, so the slope kinks at cell boundaries and small
    // jumps are expected — especially where the curl direction turns quickly
    // through a near-zero gradient. What must not happen is a discontinuity,
    // which at this sampling density would show up as a jump near 2 (a full
    // direction flip on a unit vector).
    const field = buildFlowField(64, 64, 1, 1, SEED, 3)
    let maxJump = 0
    let previous = sampleFlowField(field, 0, 0.5)
    for (let i = 1; i <= 400; i++) {
      const current = sampleFlowField(field, i / 400, 0.5)
      maxJump = Math.max(maxJump, Math.abs(current[0] - previous[0]))
      previous = current
    }
    expect(maxJump).toBeLessThan(0.5)
  })

  it('clamps outside the domain rather than wrapping', () => {
    const field = buildFlowField(16, 16, 1, 1, SEED, 3)
    expect(sampleFlowField(field, -5, 0.5)).toEqual(
      sampleFlowField(field, 0, 0.5),
    )
    expect(sampleFlowField(field, 5, 0.5)).toEqual(
      sampleFlowField(field, 1, 0.5),
    )
  })
})

describe('lic', () => {
  const field = buildFlowField(160, 160, 1, 1, SEED, 3)
  const opts = (steps: number) => ({
    steps,
    stepLength: 1 / 128,
    textureScale: 128,
  })

  it('is deterministic', () => {
    expect(lic(0.3, 0.4, SEED, field, opts(8))).toBe(
      lic(0.3, 0.4, SEED, field, opts(8)),
    )
  })

  it('stays in 0..1', () => {
    const { min, max } = survey(
      (x, y) => lic(x, y, SEED, field, opts(10)),
      1,
      30,
    )
    expect(min).toBeGreaterThanOrEqual(0)
    expect(max).toBeLessThanOrEqual(1)
  })

  /**
   * Regression: the texture used to be sampled in *field* units, where the
   * whole image spans a couple of units — so `hash2(x|0, y|0)` produced a
   * handful of enormous blocks and the convolution had nothing to average.
   * Step count made no difference at all, which is what caught it.
   */
  it('smooths more with more steps', () => {
    const spread = (steps: number) => {
      const { min, max } = survey(
        (x, y) => lic(x, y, SEED, field, opts(steps)),
        1,
        30,
      )
      return max - min
    }

    expect(spread(40)).toBeLessThan(spread(1))
  })

  it('varies at pixel scale rather than in giant blocks', () => {
    // Adjacent samples one texture cell apart must usually differ.
    let changes = 0
    for (let i = 0; i < 200; i++) {
      const a = lic(i / 128, 0.5, SEED, field, opts(4))
      const b = lic((i + 1) / 128, 0.5, SEED, field, opts(4))
      if (Math.abs(a - b) > 1e-6) changes++
    }
    expect(changes).toBeGreaterThan(150)
  })
})

describe('cellular', () => {
  it('stays inside 0..1', () => {
    for (const mode of ['f1', 'edge', 'blocks'] as const) {
      for (let i = 0; i < 400; i++) {
        const value = cellular(i * 0.37, i * 0.71, 99, mode)
        expect(value, mode).toBeGreaterThanOrEqual(0)
        expect(value, mode).toBeLessThanOrEqual(1)
      }
    }
  })

  it('is deterministic', () => {
    expect(cellular(1.5, 2.5, 7, 'edge')).toBe(cellular(1.5, 2.5, 7, 'edge'))
  })

  it('gives each mode a genuinely different field', () => {
    const sample = (mode: 'f1' | 'edge' | 'blocks') =>
      Array.from({ length: 64 }, (_, i) =>
        cellular((i % 8) * 0.6, Math.floor(i / 8) * 0.6, 3, mode).toFixed(4),
      ).join()
    expect(new Set([sample('f1'), sample('edge'), sample('blocks')]).size).toBe(
      3,
    )
  })

  /** Cracks: near zero on a wall, and using most of the range overall. */
  it('uses its range', () => {
    let min = Infinity
    let max = -Infinity
    for (let y = 0; y < 60; y++) {
      for (let x = 0; x < 60; x++) {
        const value = cellular(x * 0.17, y * 0.17, 11, 'edge')
        min = Math.min(min, value)
        max = Math.max(max, value)
      }
    }
    expect(min).toBeLessThan(0.15)
    expect(max).toBeGreaterThan(0.6)
  })

  it('varies with the seed', () => {
    expect(cellular(1.3, 2.7, 1, 'f1')).not.toBe(cellular(1.3, 2.7, 2, 'f1'))
  })

  it('stacks octaves without leaving the range', () => {
    for (let i = 0; i < 200; i++) {
      const value = cellularFbm(i * 0.31, i * 0.19, 5, 'edge', { octaves: 5 })
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })
})

describe('interference', () => {
  it('stays inside 0..1', () => {
    for (let i = 0; i < 500; i++) {
      const value = interference(i * 0.13, i * 0.29, 42, 4, 0.4)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  /** The point of the field: hard periodic structure, not noise. */
  it('is periodic rather than random', () => {
    // One grating repeats along its own axis; sampling a line finds the tone
    // returning rather than wandering.
    const line = Array.from({ length: 200 }, (_, i) =>
      interference(i * 0.02, 0, 1, 1, 0),
    )
    const mean = line.reduce((a, b) => a + b, 0) / line.length
    // A sine sum averages to the midpoint; white noise would too, so also
    // check it actually swings.
    expect(mean).toBeCloseTo(0.5, 1)
    expect(Math.max(...line) - Math.min(...line)).toBeGreaterThan(0.8)
  })

  it('is deterministic and seed-dependent', () => {
    expect(interference(1, 2, 5, 3, 0.5)).toBe(interference(1, 2, 5, 3, 0.5))
    expect(interference(1, 2, 5, 3, 0.5)).not.toBe(
      interference(1, 2, 6, 3, 0.5),
    )
  })

  it('clamps the wave count rather than trusting it', () => {
    expect(Number.isFinite(interference(1, 1, 3, 0, 0.5))).toBe(true)
    expect(Number.isFinite(interference(1, 1, 3, 99, 0.5))).toBe(true)
  })
})
