import { describe, expect, it } from 'vitest'
import { compositeInto } from './blend'
import { toPerceptual } from './buffer'
import { pixel, solid, solidSrgb } from '#/test/helpers'

/** Compare a pixel to expected values, tolerating Float32 rounding. */
function expectPixel(
  buffer: ReturnType<typeof solid>,
  expected: [number, number, number, number],
) {
  pixel(buffer, 0, 0).forEach((value, i) => {
    expect(value).toBeCloseTo(expected[i], 6)
  })
}

/** Read a pixel back in perceptual units, where blend modes are defined. */
function perceptual(buffer: ReturnType<typeof solid>, x = 0, y = 0) {
  return pixel(buffer, x, y).slice(0, 3).map(toPerceptual)
}

describe('compositeInto', () => {
  it('replaces the base at full opacity in normal mode', () => {
    const base = solid(2, 2, 0.1, 0.2, 0.3)
    compositeInto(base, solid(2, 2, 0.7, 0.8, 0.9), 1, 'normal')
    // Float32 storage, so compare with tolerance rather than exactly.
    expectPixel(base, [0.7, 0.8, 0.9, 1])
  })

  it('leaves the base untouched at zero opacity', () => {
    const base = solid(2, 2, 0.1, 0.2, 0.3)
    compositeInto(base, solid(2, 2, 0.7, 0.8, 0.9), 0, 'normal')
    expectPixel(base, [0.1, 0.2, 0.3, 1])
  })

  it('crossfades in linear light at partial opacity', () => {
    // A partial layer is physically a mix of two images, so the lerp belongs in
    // linear light even though the mode maths does not.
    const base = solid(1, 1, 0, 0, 0)
    compositeInto(base, solid(1, 1, 0.8, 0.4, 0.2), 0.5, 'normal')
    const [r, g, b] = pixel(base, 0, 0)
    expect(r).toBeCloseTo(0.4, 6)
    expect(g).toBeCloseTo(0.2, 6)
    expect(b).toBeCloseTo(0.1, 6)
  })

  it('multiplies in perceptual space', () => {
    // Mid-grey times mid-grey is quarter-grey as seen, which is what the
    // control is expected to do. Computed in linear it would land far darker.
    const base = solidSrgb(1, 1, 128, 128, 128)
    compositeInto(base, solidSrgb(1, 1, 128, 128, 128), 1, 'multiply')
    expect(perceptual(base)[0]).toBeCloseTo(0.502 * 0.502, 2)
  })

  it('screens toward white', () => {
    const base = solidSrgb(1, 1, 128, 128, 128)
    compositeInto(base, solidSrgb(1, 1, 128, 128, 128), 1, 'screen')
    expect(perceptual(base)[0]).toBeCloseTo(1 - 0.498 * 0.498, 2)
  })

  it('takes the absolute difference', () => {
    const base = solidSrgb(1, 1, 255, 128, 0)
    compositeInto(base, solidSrgb(1, 1, 255, 0, 0), 1, 'difference')
    const [r, g] = perceptual(base)
    expect(r).toBeCloseTo(0, 2)
    expect(g).toBeCloseTo(0.502, 2)
  })

  it('splits overlay at the midpoint', () => {
    const dark = solidSrgb(1, 1, 64, 64, 64)
    const light = solidSrgb(1, 1, 192, 192, 192)
    const top = solidSrgb(1, 1, 128, 128, 128)

    compositeInto(dark, top, 1, 'overlay')
    compositeInto(light, top, 1, 'overlay')

    expect(perceptual(dark)[0]).toBeLessThan(0.5)
    expect(perceptual(light)[0]).toBeGreaterThan(0.5)
  })

  it('is the identity for normal mode with an identical top', () => {
    const base = solid(3, 3, 0.3, 0.4, 0.5)
    compositeInto(base, solid(3, 3, 0.3, 0.4, 0.5), 0.42, 'normal')
    const [r, g, b] = pixel(base, 1, 1)
    expect(r).toBeCloseTo(0.3, 6)
    expect(g).toBeCloseTo(0.4, 6)
    expect(b).toBeCloseTo(0.5, 6)
  })

  it('carries alpha from the effect output', () => {
    const base = solid(1, 1, 0, 0, 0, 1)
    compositeInto(base, solid(1, 1, 0, 0, 0, 0), 0.5, 'normal')
    expect(pixel(base, 0, 0)[3]).toBeCloseTo(0.5, 6)
  })

  it('never leaves values outside 0..1 for in-range inputs', () => {
    for (const mode of [
      'multiply',
      'screen',
      'overlay',
      'difference',
    ] as const) {
      const base = solidSrgb(4, 4, 30, 140, 250)
      compositeInto(base, solidSrgb(4, 4, 200, 20, 90), 1, mode)
      for (const value of base.data) {
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
      }
    }
  })
})
