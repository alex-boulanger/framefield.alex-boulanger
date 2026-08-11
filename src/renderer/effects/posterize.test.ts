import { describe, expect, it } from 'vitest'
import { applyPosterize, POSTERIZE_PARAMS } from './posterize'
import { defaultParams } from '../params'
import { toPerceptual } from '../buffer'
import {
  env,
  gradient,
  meanLuminance,
  pixel,
  uniqueColors,
} from '#/test/helpers'

const base = () => defaultParams(POSTERIZE_PARAMS)

describe('applyPosterize', () => {
  it('reduces each channel to `levels` distinct values in rgb mode', () => {
    for (const levels of [2, 3, 5, 8]) {
      const buffer = gradient(256, 1)
      applyPosterize(buffer, { ...base(), mode: 'rgb', levels }, env(buffer))

      const values = new Set<string>()
      for (let i = 0; i < buffer.data.length; i += 4) {
        values.add(buffer.data[i].toFixed(4))
      }
      expect(values.size).toBeLessThanOrEqual(levels)
    }
  })

  it('spans the full range at two levels', () => {
    const buffer = gradient(256, 1)
    applyPosterize(buffer, { ...base(), mode: 'rgb', levels: 2 }, env(buffer))
    expect(uniqueColors(buffer)).toEqual(
      new Set(['0.0000,0.0000,0.0000', '1.0000,1.0000,1.0000']),
    )
  })

  /**
   * Bands are spaced evenly in *perceived* lightness. Quantizing linear values
   * uniformly would crowd nearly every step into the shadows and leave the
   * highlights as one flat mass.
   */
  it('spaces bands evenly in perceptual space', () => {
    const buffer = gradient(256, 1)
    applyPosterize(buffer, { ...base(), mode: 'rgb', levels: 5 }, env(buffer))

    const bands = [
      ...new Set(Array.from(buffer.data).filter((_, i) => i % 4 === 0)),
    ]
      .map(toPerceptual)
      .sort((a, b) => a - b)

    expect(bands.length).toBe(5)
    for (let i = 0; i < bands.length; i++) {
      expect(bands[i]).toBeCloseTo(i / (bands.length - 1), 2)
    }
  })

  it('maps duotone output onto the palette', () => {
    const buffer = gradient(256, 1)
    applyPosterize(
      buffer,
      {
        ...base(),
        mode: 'duotone',
        levels: 2,
        palette: ['#000000', '#ff0000'],
      },
      env(buffer),
    )
    expect(uniqueColors(buffer)).toEqual(
      new Set(['0.0000,0.0000,0.0000', '1.0000,0.0000,0.0000']),
    )
  })

  it('inverts tone', () => {
    const normal = gradient(64, 1)
    const inverted = gradient(64, 1)
    const params = { ...base(), mode: 'rgb', levels: 4 }

    applyPosterize(normal, params, env(normal))
    applyPosterize(inverted, { ...params, invert: true }, env(inverted))

    expect(pixel(inverted, 0, 0)[0]).toBeCloseTo(pixel(normal, 63, 0)[0], 5)
    expect(pixel(inverted, 63, 0)[0]).toBeCloseTo(pixel(normal, 0, 0)[0], 5)
  })

  it('brightens with gamma above 1 and darkens below', () => {
    const dark = gradient(64, 8)
    const mid = gradient(64, 8)
    const light = gradient(64, 8)
    const params = { ...base(), mode: 'rgb', levels: 16 }

    applyPosterize(dark, { ...params, gamma: 0.5 }, env(dark))
    applyPosterize(mid, { ...params, gamma: 1 }, env(mid))
    applyPosterize(light, { ...params, gamma: 2 }, env(light))

    expect(meanLuminance(dark)).toBeLessThan(meanLuminance(mid))
    expect(meanLuminance(light)).toBeGreaterThan(meanLuminance(mid))
  })

  it('pushes tones apart as contrast rises', () => {
    const flat = gradient(64, 8)
    const punchy = gradient(64, 8)
    const params = { ...base(), mode: 'rgb', levels: 16 }

    applyPosterize(flat, { ...params, contrast: 0 }, env(flat))
    applyPosterize(punchy, { ...params, contrast: 0.8 }, env(punchy))

    expect(pixel(punchy, 2, 0)[0]).toBeLessThanOrEqual(pixel(flat, 2, 0)[0])
    expect(pixel(punchy, 61, 0)[0]).toBeGreaterThanOrEqual(
      pixel(flat, 61, 0)[0],
    )
  })

  it('is resolution-independent', () => {
    // A per-pixel tone operation has no spatial term, so scale must not change
    // the result for the same input tone.
    const full = gradient(64, 1)
    const half = gradient(64, 1)
    const params = { ...base(), mode: 'rgb', levels: 4 }

    applyPosterize(full, params, env(full, 1))
    applyPosterize(half, params, env(half, 0.5))

    expect(Array.from(full.data)).toEqual(Array.from(half.data))
  })

  it('leaves alpha untouched', () => {
    const buffer = gradient(16, 1)
    applyPosterize(buffer, base(), env(buffer))
    for (let i = 3; i < buffer.data.length; i += 4) {
      expect(buffer.data[i]).toBe(1)
    }
  })
})
