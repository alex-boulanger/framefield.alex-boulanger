import { describe, expect, it } from 'vitest'
import { applyHalftone, HALFTONE_PARAMS } from './halftone'
import { defaultParams } from '../params'
import {
  env,
  gradient,
  meanLuminance,
  solid,
  solidSrgb,
  uniqueColors,
} from '#/test/helpers'

const base = () => defaultParams(HALFTONE_PARAMS)

describe('applyHalftone', () => {
  it('leaves white paper unmarked', () => {
    const buffer = solid(64, 64, 1, 1, 1)
    applyHalftone(buffer, { ...base(), mode: 'mono' }, env(buffer))
    expect(meanLuminance(buffer)).toBeCloseTo(1, 2)
  })

  it('floods solid black with ink', () => {
    const buffer = solid(64, 64, 0, 0, 0)
    applyHalftone(buffer, { ...base(), mode: 'mono' }, env(buffer))
    expect(meanLuminance(buffer)).toBeLessThan(0.05)
  })

  it('tracks tone monotonically', () => {
    // Dot area is what the eye integrates, so darker input must lay more ink.
    const tones = [220, 170, 120, 70, 20].map((level) => {
      const buffer = solidSrgb(96, 96, level, level, level)
      applyHalftone(buffer, { ...base(), mode: 'mono' }, env(buffer))
      return meanLuminance(buffer)
    })

    for (let i = 1; i < tones.length; i++) {
      expect(tones[i]).toBeLessThanOrEqual(tones[i - 1] + 1e-6)
    }
  })

  it('breaks a flat mid-tone into dots', () => {
    const buffer = solidSrgb(64, 64, 128, 128, 128)
    applyHalftone(buffer, { ...base(), mode: 'mono' }, env(buffer))
    // A screen must produce both inked and clear pixels, not a flat grey.
    expect(uniqueColors(buffer, 2).size).toBeGreaterThan(1)
  })

  it('scales the screen with the render scale', () => {
    const full = solidSrgb(64, 64, 128, 128, 128)
    const half = solidSrgb(64, 64, 128, 128, 128)
    applyHalftone(full, { ...base(), cellSize: 16 }, env(full, 1))
    applyHalftone(half, { ...base(), cellSize: 16 }, env(half, 0.5))
    expect(Array.from(full.data)).not.toEqual(Array.from(half.data))
  })

  it.each(['dot', 'square', 'line', 'cross'])(
    'produces distinct structure for %s',
    (shape) => {
      const buffer = solidSrgb(64, 64, 120, 120, 120)
      applyHalftone(buffer, { ...base(), shape, mode: 'mono' }, env(buffer))
      expect(uniqueColors(buffer, 2).size).toBeGreaterThan(1)
    },
  )

  it('gives every shape a different result', () => {
    const results = ['dot', 'square', 'line', 'cross'].map((shape) => {
      const buffer = solidSrgb(48, 48, 120, 120, 120)
      applyHalftone(buffer, { ...base(), shape, mode: 'mono' }, env(buffer))
      return Array.from(buffer.data).join(',')
    })
    expect(new Set(results).size).toBe(4)
  })

  it('rotates the screen', () => {
    const a = solidSrgb(64, 64, 120, 120, 120)
    const b = solidSrgb(64, 64, 120, 120, 120)
    applyHalftone(a, { ...base(), angle: 0, shape: 'line' }, env(a))
    applyHalftone(b, { ...base(), angle: 45, shape: 'line' }, env(b))
    expect(Array.from(a.data)).not.toEqual(Array.from(b.data))
  })

  it('inks duotone with the palette', () => {
    const buffer = solid(32, 32, 0, 0, 0)
    applyHalftone(
      buffer,
      { ...base(), mode: 'duotone', palette: ['#ff0000', '#ffffff'] },
      env(buffer),
    )

    // Averaged, not sampled at one pixel: dot rims are antialiased and cell
    // corners are legitimately partial, so no single pixel is guaranteed to be
    // at full coverage.
    let r = 0
    let g = 0
    for (let i = 0; i < buffer.data.length; i += 4) {
      r += buffer.data[i]
      g += buffer.data[i + 1]
    }
    expect(r / g).toBeGreaterThan(2)
  })

  it('separates colour in cmyk mode', () => {
    // A *coloured* source. Grey input is correctly neutral out: K extraction
    // pulls all of it onto the black plate and leaves C, M and Y at zero.
    const buffer = solid(64, 64, 0.6, 0.15, 0.05)
    applyHalftone(buffer, { ...base(), mode: 'cmyk' }, env(buffer))

    let coloured = 0
    for (let i = 0; i < buffer.data.length; i += 4) {
      const r = buffer.data[i]
      const g = buffer.data[i + 1]
      const b = buffer.data[i + 2]
      if (Math.abs(r - g) > 0.02 || Math.abs(g - b) > 0.02) coloured++
    }
    expect(coloured).toBeGreaterThan(0)
  })

  it('keeps grey neutral in cmyk mode', () => {
    // The converse, stated on purpose: this is what makes K extraction correct
    // rather than a bug, and it is why the test above needs a coloured source.
    const buffer = solidSrgb(64, 64, 128, 128, 128)
    applyHalftone(buffer, { ...base(), mode: 'cmyk' }, env(buffer))
    for (let i = 0; i < buffer.data.length; i += 4) {
      expect(buffer.data[i]).toBeCloseTo(buffer.data[i + 1], 5)
      expect(buffer.data[i + 1]).toBeCloseTo(buffer.data[i + 2], 5)
    }
  })

  it('keeps cmyk output in range', () => {
    const buffer = gradient(48, 48)
    applyHalftone(buffer, { ...base(), mode: 'cmyk' }, env(buffer))
    for (const value of buffer.data) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  it('lays more ink as gain rises', () => {
    const light = solidSrgb(64, 64, 170, 170, 170)
    const heavy = solidSrgb(64, 64, 170, 170, 170)
    applyHalftone(light, { ...base(), gain: 0.5, mode: 'mono' }, env(light))
    applyHalftone(heavy, { ...base(), gain: 1.8, mode: 'mono' }, env(heavy))
    expect(meanLuminance(heavy)).toBeLessThan(meanLuminance(light))
  })

  it('is deterministic', () => {
    const a = gradient(48, 48)
    const b = gradient(48, 48)
    applyHalftone(a, base(), env(a))
    applyHalftone(b, base(), env(b))
    expect(Array.from(a.data)).toEqual(Array.from(b.data))
  })
})
