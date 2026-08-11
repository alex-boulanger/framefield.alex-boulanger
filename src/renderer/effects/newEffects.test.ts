import { describe, expect, it } from 'vitest'
import { applyLevels, LEVELS_PARAMS } from './levels'
import { applyGrain, GRAIN_PARAMS } from './grain'
import { applyBloom, BLOOM_PARAMS } from './bloom'
import { applyDisplace, DISPLACE_PARAMS } from './displace'
import { defaultParams } from '../params'
import { createBuffer, luma } from '../buffer'
import type { PixelBuffer } from '../buffer'
import { env, gradient, meanLuminance, pixel, solid } from '#/test/helpers'

/* ------------------------------------------------------------------ levels */

describe('applyLevels', () => {
  const base = () => defaultParams(LEVELS_PARAMS)

  it('is the identity at defaults', () => {
    const buffer = gradient(64, 8)
    const before = Array.from(buffer.data)
    applyLevels(buffer, base(), env(buffer))
    for (let i = 0; i < buffer.data.length; i++) {
      expect(buffer.data[i]).toBeCloseTo(before[i], 4)
    }
  })

  it('clips below the black point and above the white point', () => {
    const buffer = gradient(256, 1)
    applyLevels(buffer, { ...base(), black: 0.3, white: 0.7 }, env(buffer))
    expect(pixel(buffer, 10, 0)[0]).toBeCloseTo(0, 4)
    expect(pixel(buffer, 245, 0)[0]).toBeCloseTo(1, 4)
  })

  it('brightens with gamma above 1', () => {
    const dark = gradient(64, 8)
    const light = gradient(64, 8)
    applyLevels(dark, { ...base(), gamma: 0.5 }, env(dark))
    applyLevels(light, { ...base(), gamma: 2 }, env(light))
    expect(meanLuminance(light)).toBeGreaterThan(meanLuminance(dark))
  })

  it('raises the floor with lift', () => {
    const buffer = solid(8, 8, 0, 0, 0)
    applyLevels(buffer, { ...base(), lift: 0.2 }, env(buffer))
    expect(meanLuminance(buffer)).toBeGreaterThan(0)
  })

  it('inverts', () => {
    const normal = gradient(64, 1)
    const inverted = gradient(64, 1)
    applyLevels(normal, base(), env(normal))
    applyLevels(inverted, { ...base(), invert: true }, env(inverted))
    expect(pixel(inverted, 0, 0)[0]).toBeCloseTo(pixel(normal, 63, 0)[0], 3)
  })

  it('desaturates to grey at saturation 0', () => {
    const buffer = solid(8, 8, 0.8, 0.2, 0.1)
    applyLevels(buffer, { ...base(), saturation: 0 }, env(buffer))
    const [r, g, b] = pixel(buffer, 0, 0)
    expect(r).toBeCloseTo(g, 5)
    expect(g).toBeCloseTo(b, 5)
  })

  it('preserves hue in luma mode', () => {
    // Curving each channel separately shifts hue; luma mode must not.
    const buffer = solid(8, 8, 0.6, 0.3, 0.15)
    applyLevels(
      buffer,
      { ...base(), channels: 'luma', gamma: 1.8 },
      env(buffer),
    )
    const [r, g, b] = pixel(buffer, 0, 0)
    expect(r / g).toBeCloseTo(2, 1)
    expect(g / b).toBeCloseTo(2, 1)
  })

  it('survives a collapsed range without dividing by zero', () => {
    const buffer = gradient(32, 1)
    expect(() =>
      applyLevels(buffer, { ...base(), black: 0.9, white: 0.1 }, env(buffer)),
    ).not.toThrow()
    for (const value of buffer.data) expect(Number.isFinite(value)).toBe(true)
  })

  it('keeps output in range', () => {
    const buffer = gradient(64, 8)
    applyLevels(
      buffer,
      { ...base(), gain: 2.5, lift: 0.3, saturation: 2.5 },
      env(buffer),
    )
    for (const value of buffer.data) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })
})

/* ------------------------------------------------------------------- grain */

describe('applyGrain', () => {
  const base = () => defaultParams(GRAIN_PARAMS)

  it('is a no-op at zero amount', () => {
    const buffer = gradient(32, 32)
    const before = Array.from(buffer.data)
    applyGrain(buffer, { ...base(), amount: 0 }, env(buffer))
    expect(Array.from(buffer.data)).toEqual(before)
  })

  it('adds variation', () => {
    const buffer = solid(32, 32, 0.5, 0.5, 0.5)
    applyGrain(buffer, { ...base(), amount: 0.5 }, env(buffer))
    const values = new Set(Array.from(buffer.data).map((v) => v.toFixed(4)))
    expect(values.size).toBeGreaterThan(1)
  })

  it('is deterministic for a seed', () => {
    const a = solid(32, 32, 0.5, 0.5, 0.5)
    const b = solid(32, 32, 0.5, 0.5, 0.5)
    applyGrain(a, base(), env(a))
    applyGrain(b, base(), env(b))
    expect(Array.from(a.data)).toEqual(Array.from(b.data))
  })

  it('differs between seeds', () => {
    const a = solid(32, 32, 0.5, 0.5, 0.5)
    const b = solid(32, 32, 0.5, 0.5, 0.5)
    applyGrain(a, { ...base(), seed: 'one' }, env(a))
    applyGrain(b, { ...base(), seed: 'two' }, env(b))
    expect(Array.from(a.data)).not.toEqual(Array.from(b.data))
  })

  it('paints grain in cells of the requested size', () => {
    const buffer = solid(32, 32, 0.5, 0.5, 0.5)
    applyGrain(buffer, { ...base(), amount: 0.6, size: 4 }, env(buffer))
    // Within a 4px cell the noise value is constant, so neighbours inside a
    // cell must match while cells differ.
    expect(pixel(buffer, 0, 0)[0]).toBeCloseTo(pixel(buffer, 3, 0)[0], 6)
  })

  it('scales grain size with the render scale', () => {
    const full = solid(32, 32, 0.5, 0.5, 0.5)
    const half = solid(32, 32, 0.5, 0.5, 0.5)
    applyGrain(full, { ...base(), amount: 0.6, size: 8 }, env(full, 1))
    applyGrain(half, { ...base(), amount: 0.6, size: 8 }, env(half, 0.5))
    expect(Array.from(full.data)).not.toEqual(Array.from(half.data))
  })

  it('anchors grain cells in export-space coordinates', () => {
    const full = solid(64, 64, 0.5, 0.5, 0.5)
    const half = solid(32, 32, 0.5, 0.5, 0.5)
    const params = { ...base(), amount: 0.6, size: 1, seed: 'fixed' }

    applyGrain(full, params, env(full, 1))
    applyGrain(half, params, env(half, 0.5))

    for (let y = 0; y < half.height; y++) {
      for (let x = 0; x < half.width; x++) {
        expect(pixel(half, x, y)[0]).toBeCloseTo(
          pixel(full, x * 2, y * 2)[0],
          6,
        )
      }
    }
  })

  /**
   * Film grain peaks in the midtones. Uniform noise across the whole range
   * reads as digital dirt, so this is the property worth pinning.
   */
  it('affects midtones more than the extremes', () => {
    const spread = (level: number) => {
      const buffer = solid(64, 64, level, level, level)
      applyGrain(
        buffer,
        { ...base(), amount: 0.8, shadows: 0, seed: 'fixed' },
        env(buffer),
      )
      let min = Infinity
      let max = -Infinity
      for (let i = 0; i < buffer.data.length; i += 4) {
        min = Math.min(min, buffer.data[i])
        max = Math.max(max, buffer.data[i])
      }
      return max - min
    }

    expect(spread(0.5)).toBeGreaterThan(spread(0.98))
  })

  it('keeps output in range', () => {
    const buffer = gradient(32, 32)
    applyGrain(buffer, { ...base(), amount: 1 }, env(buffer))
    for (const value of buffer.data) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })
})

/* ------------------------------------------------------------------- bloom */

describe('applyBloom', () => {
  const base = () => defaultParams(BLOOM_PARAMS)

  it('is a no-op at zero amount', () => {
    const buffer = gradient(32, 32)
    const before = Array.from(buffer.data)
    applyBloom(buffer, { ...base(), amount: 0 }, env(buffer))
    expect(Array.from(buffer.data)).toEqual(before)
  })

  it('leaves an all-dark image alone', () => {
    // Nothing exceeds the threshold, so there is nothing to bleed.
    const buffer = solid(32, 32, 0.05, 0.05, 0.05)
    const before = meanLuminance(buffer)
    applyBloom(buffer, { ...base(), threshold: 0.7 }, env(buffer))
    expect(meanLuminance(buffer)).toBeCloseTo(before, 3)
  })

  it('brightens overall when highlights are present', () => {
    const buffer = gradient(64, 64)
    const before = meanLuminance(buffer)
    applyBloom(buffer, { ...base(), amount: 1.5 }, env(buffer))
    expect(meanLuminance(buffer)).toBeGreaterThan(before)
  })

  /** The point of a bloom: light spills into neighbouring dark pixels. */
  it('spills light outside the bright region', () => {
    const buffer = createBuffer(64, 64)
    for (let y = 28; y < 36; y++) {
      for (let x = 28; x < 36; x++) {
        const i = (y * 64 + x) * 4
        buffer.data[i] = 1
        buffer.data[i + 1] = 1
        buffer.data[i + 2] = 1
        buffer.data[i + 3] = 1
      }
    }

    applyBloom(
      buffer,
      { ...base(), threshold: 0.5, amount: 2, radius: 12 },
      env(buffer),
    )
    // A pixel well outside the square was black and must now be lit.
    expect(luma(buffer, (32 * 64 + 22) * 4)).toBeGreaterThan(0.01)
  })

  it('never exceeds full white', () => {
    const buffer = solid(32, 32, 0.9, 0.9, 0.9)
    applyBloom(buffer, { ...base(), amount: 3 }, env(buffer))
    for (const value of buffer.data) expect(value).toBeLessThanOrEqual(1)
  })

  it('is deterministic', () => {
    const a = gradient(48, 48)
    const b = gradient(48, 48)
    applyBloom(a, base(), env(a))
    applyBloom(b, base(), env(b))
    expect(Array.from(a.data)).toEqual(Array.from(b.data))
  })

  it('scales the radius with the render scale', () => {
    const full = gradient(64, 64)
    const half = gradient(64, 64)
    applyBloom(full, { ...base(), radius: 40 }, env(full, 1))
    applyBloom(half, { ...base(), radius: 40 }, env(half, 0.5))
    expect(Array.from(full.data)).not.toEqual(Array.from(half.data))
  })
})

/* ---------------------------------------------------------------- displace */

describe('applyDisplace', () => {
  const base = () => defaultParams(DISPLACE_PARAMS)

  it('is a no-op at zero amount', () => {
    const buffer = gradient(32, 32)
    const before = Array.from(buffer.data)
    applyDisplace(buffer, { ...base(), amount: 0 }, env(buffer))
    expect(Array.from(buffer.data)).toEqual(before)
  })

  it('moves pixels', () => {
    const buffer = gradient(64, 64)
    const before = Array.from(buffer.data)
    applyDisplace(buffer, { ...base(), amount: 30 }, env(buffer))
    expect(Array.from(buffer.data)).not.toEqual(before)
  })

  it('leaves a uniform field uniform', () => {
    // Displacement moves samples; with nothing to distinguish them the image
    // cannot change. A failure here means it is inventing values at the edges.
    const buffer = solid(48, 48, 0.4, 0.4, 0.4)
    applyDisplace(buffer, { ...base(), amount: 40 }, env(buffer))
    for (let i = 0; i < buffer.data.length; i += 4) {
      expect(buffer.data[i]).toBeCloseTo(0.4, 5)
    }
  })

  it.each(['noise', 'flow', 'radial'])('%s stays in range', (field) => {
    const buffer = gradient(48, 48)
    applyDisplace(buffer, { ...base(), field, amount: 60 }, env(buffer))
    for (const value of buffer.data) {
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  it('gives each field a different result', () => {
    const results = ['noise', 'flow', 'radial'].map((field) => {
      const buffer = gradient(48, 48)
      applyDisplace(buffer, { ...base(), field, amount: 30 }, env(buffer))
      return Array.from(buffer.data).join(',')
    })
    expect(new Set(results).size).toBe(3)
  })

  it('splits channels when asked', () => {
    const together = gradient(48, 48)
    const split = gradient(48, 48)
    applyDisplace(together, { ...base(), amount: 30 }, env(together))
    applyDisplace(split, { ...base(), amount: 30, channels: 0.8 }, env(split))
    expect(Array.from(together.data)).not.toEqual(Array.from(split.data))
  })

  it('is deterministic for a seed', () => {
    const a = gradient(48, 48)
    const b = gradient(48, 48)
    applyDisplace(a, base(), env(a))
    applyDisplace(b, base(), env(b))
    expect(Array.from(a.data)).toEqual(Array.from(b.data))
  })

  it('scales displacement with the render scale', () => {
    const full = gradient(64, 64)
    const half = gradient(64, 64)
    applyDisplace(full, { ...base(), amount: 40 }, env(full, 1))
    applyDisplace(half, { ...base(), amount: 40 }, env(half, 0.5))
    expect(Array.from(full.data)).not.toEqual(Array.from(half.data))
  })

  it('does not read outside the buffer when clamping', () => {
    const buffer: PixelBuffer = gradient(32, 32)
    applyDisplace(buffer, { ...base(), amount: 200, wrap: false }, env(buffer))
    for (const value of buffer.data) expect(Number.isFinite(value)).toBe(true)
  })
})
