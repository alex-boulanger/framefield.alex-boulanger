import { describe, expect, it } from 'vitest'
import {
  FIELD_DEFAULTS,
  FIELD_PARAMS,
  randomizeField,
  renderField,
} from './field'
import { sanitizeParams } from '../params'
import { luma } from '../buffer'
import type { PixelBuffer } from '../buffer'
import { meanLuminance } from '#/test/helpers'
import type { Params, RenderEnv } from '../types'

const env = (size: number, scale = 1): RenderEnv => ({
  scale,
  width: size,
  height: size,
})

const params = (overrides: Params = {}): Params => ({
  ...FIELD_DEFAULTS(),
  seed: 'test',
  ...overrides,
})

const FIELDS = ['fbm', 'warp', 'ridged', 'flow', 'gradient'] as const

/**
 * Bucket luma into `bins` and report the distribution. Tone *spread* is the
 * property that determines whether the downstream effects have anything to
 * work with, so it is worth measuring directly.
 */
function histogram(buffer: PixelBuffer, bins = 32): Array<number> {
  const counts = new Array<number>(bins).fill(0)
  const total = buffer.data.length / 4

  for (let i = 0; i < buffer.data.length; i += 4) {
    const value = Math.max(0, Math.min(0.9999, luma(buffer, i)))
    counts[(value * bins) | 0]++
  }

  return counts.map((c) => c / total)
}

describe('renderField', () => {
  it('fills the buffer with opaque, finite, in-range values', () => {
    for (const field of FIELDS) {
      const buffer = renderField(params({ field }), env(48))
      for (let i = 0; i < buffer.data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          expect(Number.isFinite(buffer.data[i + c])).toBe(true)
          expect(buffer.data[i + c]).toBeGreaterThanOrEqual(0)
          expect(buffer.data[i + c]).toBeLessThanOrEqual(1)
        }
        expect(buffer.data[i + 3]).toBe(1)
      }
    }
  })

  it('is deterministic for a seed', () => {
    const a = renderField(params(), env(32))
    const b = renderField(params(), env(32))
    expect(Array.from(a.data)).toEqual(Array.from(b.data))
  })

  it('differs between seeds', () => {
    const a = renderField(params({ seed: 'one' }), env(32))
    const b = renderField(params({ seed: 'two' }), env(32))
    expect(Array.from(a.data)).not.toEqual(Array.from(b.data))
  })

  /**
   * The reason this generator was rewritten.
   *
   * The previous version drew hard-edged vector shapes on a flat ground, which
   * produced a bimodal histogram — a spike at the background, a spike at the
   * fill, and almost nothing in between. Dither and posterize are tone
   * *redistributors*: given only two tones they emit flat regions rather than
   * pattern, which is exactly how the first build looked. Continuous-tone
   * fields are the fix, and this is the assertion that holds them to it.
   */
  describe('tonal density', () => {
    it.each(['fbm', 'warp', 'ridged', 'flow'] as const)(
      '%s spreads tone across the range',
      (field) => {
        const buffer = renderField(
          params({ field, shapes: 0, grain: 0 }),
          env(96),
        )
        const bins = histogram(buffer)
        const occupied = bins.filter((share) => share > 0.002).length

        expect(occupied).toBeGreaterThan(8)
      },
    )

    it.each(['fbm', 'warp', 'ridged', 'flow'] as const)(
      '%s is not dominated by a single tone',
      (field) => {
        // No single bucket may hold most of the image. A bimodal source would
        // fail this immediately.
        const buffer = renderField(
          params({ field, shapes: 0, grain: 0 }),
          env(96),
        )
        expect(Math.max(...histogram(buffer))).toBeLessThan(0.5)
      },
    )

    it('still carries mid-tones once shapes are added', () => {
      // Shapes compose *into* the field rather than replacing it, so adding
      // them must not flatten the histogram back out.
      const buffer = renderField(params({ shapes: 8 }), env(96))
      const bins = histogram(buffer)
      const occupied = bins.filter((share) => share > 0.002).length
      expect(occupied).toBeGreaterThan(8)
    })
  })

  it('keeps feature size proportional across resolutions', () => {
    // Coordinates are normalized by the short edge, so a preview is the export
    // in miniature rather than a differently-zoomed image.
    const small = renderField(params({ grain: 0 }), env(64))
    const large = renderField(params({ grain: 0 }), env(192))
    expect(meanLuminance(small)).toBeCloseTo(meanLuminance(large), 1)
  })

  it('blurs without shifting overall brightness', () => {
    const sharp = renderField(params({ blur: 0, grain: 0 }), env(64))
    const soft = renderField(params({ blur: 12, grain: 0 }), env(64))
    expect(meanLuminance(soft)).toBeCloseTo(meanLuminance(sharp), 1)
  })

  it('reduces local variation when blurred', () => {
    const variance = (buffer: PixelBuffer) => {
      let total = 0
      for (let i = 0; i < buffer.data.length - 4; i += 4) {
        total += Math.abs(luma(buffer, i + 4) - luma(buffer, i))
      }
      return total
    }

    expect(
      variance(renderField(params({ blur: 16, grain: 0 }), env(64))),
    ).toBeLessThan(
      variance(renderField(params({ blur: 0, grain: 0 }), env(64))),
    )
  })

  it('adds variation with grain', () => {
    const clean = renderField(params({ grain: 0, field: 'gradient' }), env(48))
    const grainy = renderField(
      params({ grain: 0.5, field: 'gradient' }),
      env(48),
    )
    expect(Array.from(clean.data)).not.toEqual(Array.from(grainy.data))
  })

  it('respects the palette', () => {
    const buffer = renderField(
      params({ palette: ['#ff0000', '#ff0000'], grain: 0, shapes: 0 }),
      env(24),
    )
    // A single-colour palette collapses the ramp: no green or blue anywhere.
    for (let i = 0; i < buffer.data.length; i += 4) {
      expect(buffer.data[i + 1]).toBeCloseTo(0, 5)
      expect(buffer.data[i + 2]).toBeCloseTo(0, 5)
    }
  })

  it('produces shapes only when asked', () => {
    const without = renderField(params({ shapes: 0, grain: 0 }), env(48))
    const with8 = renderField(params({ shapes: 8, grain: 0 }), env(48))
    expect(Array.from(without.data)).not.toEqual(Array.from(with8.data))
  })
})

describe('randomizeField', () => {
  it('always produces params that survive sanitization', () => {
    for (let i = 0; i < 300; i++) {
      const generated = randomizeField(`seed-${i}`, ['#000000', '#ffffff'])
      expect(sanitizeParams(FIELD_PARAMS, generated)).toEqual(generated)
    }
  })

  it('is deterministic for a seed', () => {
    expect(randomizeField('abc', ['#000000'])).toEqual(
      randomizeField('abc', ['#000000']),
    )
  })

  it('renders to a usable image every time', () => {
    for (let i = 0; i < 12; i++) {
      const generated = randomizeField(`seed-${i}`, ['#050505', '#f5f5f5'])
      const buffer = renderField({ ...generated, seed: `seed-${i}` }, env(48))
      const mean = meanLuminance(buffer)
      // Not pure black, not pure white — remix must not hand back a blank.
      expect(mean).toBeGreaterThan(0.001)
      expect(mean).toBeLessThan(0.999)
    }
  })
})
