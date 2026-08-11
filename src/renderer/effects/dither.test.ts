import { describe, expect, it } from 'vitest'
import { applyDither, DITHER_PARAMS } from './dither'
import { defaultParams } from '../params'
import { srgbToLinear } from '../buffer'
import {
  env,
  gradient,
  meanLuminance,
  pixel,
  solid,
  solidSrgb,
  uniqueColors,
} from '#/test/helpers'

const base = () => defaultParams(DITHER_PARAMS)

const ORDERED = ['bayer', 'blue'] as const
const DIFFUSION = ['floyd-steinberg', 'atkinson', 'jarvis', 'stucki'] as const
const ALL = [...ORDERED, ...DIFFUSION]

describe('applyDither', () => {
  it.each(ALL)(
    '%s reduces mono output to pure black and white',
    (algorithm) => {
      const buffer = gradient(48, 16)
      applyDither(buffer, { ...base(), algorithm, mode: 'mono' }, env(buffer))

      for (const color of uniqueColors(buffer)) {
        expect(['0.0000,0.0000,0.0000', '1.0000,1.0000,1.0000']).toContain(
          color,
        )
      }
    },
  )

  /**
   * The gamma-correctness test, and the reason the pipeline is linear.
   *
   * A dither reproduces a tone by lighting a fraction of pixels, and the eye
   * averages them in linear light — so the lit fraction must equal the *linear*
   * value. Thresholding sRGB instead lights ~50% of pixels for a mid-grey whose
   * true linear value is 0.21, and the result reads blown out.
   */
  // Atkinson is excluded deliberately — see the test below it.
  it.each(ALL.filter((a) => a !== 'atkinson'))(
    '%s preserves mean linear tone',
    (algorithm) => {
      for (const level of [32, 64, 128, 192]) {
        const buffer = solidSrgb(96, 96, level, level, level)
        const target = srgbToLinear(level / 255)

        applyDither(buffer, { ...base(), algorithm, mode: 'mono' }, env(buffer))

        expect(meanLuminance(buffer)).toBeCloseTo(target, 1)
      }
    },
  )

  /**
   * Atkinson is the exception, and on purpose: it passes on only 6/8 of the
   * error and drops the rest, so it crushes shadows and blows highlights. That
   * lost contrast *is* the look. Asserting tone preservation here would be
   * asserting that Atkinson is broken.
   */
  it('atkinson trades tone accuracy for contrast', () => {
    const shadow = solidSrgb(96, 96, 40, 40, 40)
    const highlight = solidSrgb(96, 96, 215, 215, 215)
    const params = { ...base(), algorithm: 'atkinson', mode: 'mono' }

    applyDither(shadow, params, env(shadow))
    applyDither(highlight, params, env(highlight))

    expect(meanLuminance(shadow)).toBeLessThan(srgbToLinear(40 / 255))
    expect(meanLuminance(highlight)).toBeGreaterThan(srgbToLinear(215 / 255))
  })

  it.each(ALL)('%s leaves pure black and pure white alone', (algorithm) => {
    const black = solid(24, 24, 0, 0, 0)
    const white = solid(24, 24, 1, 1, 1)
    const params = { ...base(), algorithm, mode: 'mono' }

    applyDither(black, params, env(black))
    applyDither(white, params, env(white))

    expect(meanLuminance(black)).toBeCloseTo(0, 5)
    expect(meanLuminance(white)).toBeCloseTo(1, 5)
  })

  it.each(ALL)('%s is deterministic', (algorithm) => {
    const a = gradient(32, 32)
    const b = gradient(32, 32)
    applyDither(a, { ...base(), algorithm }, env(a))
    applyDither(b, { ...base(), algorithm }, env(b))
    expect(Array.from(a.data)).toEqual(Array.from(b.data))
  })

  it.each(ALL)(
    '%s is resolution-independent in its parameters',
    (algorithm) => {
      // Dither is now purely per-pixel — cell size moved to `pixelate` — so the
      // render scale must not change the result for identical input.
      const full = gradient(32, 32)
      const half = gradient(32, 32)
      applyDither(full, { ...base(), algorithm }, env(full, 1))
      applyDither(half, { ...base(), algorithm }, env(half, 0.5))
      expect(Array.from(full.data)).toEqual(Array.from(half.data))
    },
  )

  it('breaks a flat mid-tone into a pattern rather than a flat fill', () => {
    for (const algorithm of ALL) {
      const buffer = solidSrgb(32, 32, 128, 128, 128)
      applyDither(buffer, { ...base(), algorithm, mode: 'mono' }, env(buffer))
      expect(uniqueColors(buffer).size).toBe(2)
    }
  })

  it('maps duotone output onto the palette endpoints', () => {
    const buffer = gradient(32, 8)
    applyDither(
      buffer,
      { ...base(), mode: 'duotone', palette: ['#000000', '#ff0000'] },
      env(buffer),
    )
    for (const color of uniqueColors(buffer)) {
      expect(['0.0000,0.0000,0.0000', '1.0000,0.0000,0.0000']).toContain(color)
    }
  })

  it('quantizes to more than two tones when levels rises', () => {
    const buffer = gradient(64, 64)
    applyDither(
      buffer,
      { ...base(), algorithm: 'bayer', mode: 'mono', levels: 4 },
      env(buffer),
    )
    expect(uniqueColors(buffer).size).toBe(4)
  })

  it('restricts palette mode to the palette', () => {
    const palette = ['#000000', '#ff0000', '#00ff00', '#ffffff']
    const buffer = gradient(48, 48)
    applyDither(
      buffer,
      { ...base(), algorithm: 'floyd-steinberg', mode: 'palette', palette },
      env(buffer),
    )
    // Every output pixel must be one of the four, exactly.
    expect(uniqueColors(buffer).size).toBeLessThanOrEqual(palette.length)
  })

  it('inverts the pattern', () => {
    const params = { ...base(), algorithm: 'bayer', mode: 'mono' }
    const normal = gradient(24, 4)
    const inverted = gradient(24, 4)

    applyDither(normal, params, env(normal))
    applyDither(inverted, { ...params, invert: true }, env(inverted))

    for (let x = 0; x < 24; x++) {
      expect(pixel(inverted, x, 0)[0]).toBeCloseTo(
        1 - pixel(normal, x, 0)[0],
        5,
      )
    }
  })

  it('shifts coverage with bias', () => {
    const darker = gradient(48, 48)
    const lighter = gradient(48, 48)
    const params = { ...base(), algorithm: 'bayer', mode: 'mono' }

    applyDither(darker, { ...params, bias: -0.25 }, env(darker))
    applyDither(lighter, { ...params, bias: 0.25 }, env(lighter))

    expect(meanLuminance(darker)).toBeLessThan(meanLuminance(lighter))
  })

  it('produces different structure for every algorithm', () => {
    const results = ALL.map((algorithm) => {
      const buffer = gradient(32, 32)
      applyDither(buffer, { ...base(), algorithm, mode: 'mono' }, env(buffer))
      return Array.from(buffer.data).join(',')
    })
    expect(new Set(results).size).toBe(ALL.length)
  })

  /**
   * Scanning every row in the same direction pushes error consistently one way,
   * which shows up as diagonal worming. Serpentine cancels it, so the two
   * orders must differ — if they match, the flag is not wired up.
   */
  it.each(DIFFUSION)('%s honours the serpentine flag', (algorithm) => {
    const straight = gradient(32, 32)
    const snake = gradient(32, 32)
    applyDither(
      straight,
      { ...base(), algorithm, mode: 'mono', serpentine: false },
      env(straight),
    )
    applyDither(
      snake,
      { ...base(), algorithm, mode: 'mono', serpentine: true },
      env(snake),
    )
    expect(Array.from(straight.data)).not.toEqual(Array.from(snake.data))
  })

  /**
   * Blue noise exists to avoid the visible lattice that Bayer produces. On a
   * flat tone, Bayer repeats exactly every `matrixSize` pixels; blue noise must
   * not.
   */
  it('blue noise does not repeat on the Bayer lattice', () => {
    const size = 8
    const periodicity = (algorithm: string) => {
      const buffer = solidSrgb(64, 64, 110, 110, 110)
      applyDither(
        buffer,
        { ...base(), algorithm, mode: 'mono', matrixSize: String(size) },
        env(buffer),
      )
      let matches = 0
      for (let y = 0; y < 64 - size; y++) {
        for (let x = 0; x < 64 - size; x++) {
          const a = pixel(buffer, x, y)[0]
          const b = pixel(buffer, x + size, y)[0]
          if (a === b) matches++
        }
      }
      return matches / ((64 - size) * (64 - size))
    }

    expect(periodicity('bayer')).toBeCloseTo(1, 5)
    expect(periodicity('blue')).toBeLessThan(0.9)
  })

  it('leaves alpha untouched', () => {
    const buffer = gradient(16, 16)
    applyDither(buffer, base(), env(buffer))
    for (let i = 3; i < buffer.data.length; i += 4) {
      expect(buffer.data[i]).toBe(1)
    }
  })
})
