import { describe, expect, it } from 'vitest'
import {
  blur,
  cloneBuffer,
  createBuffer,
  fromImageData,
  fromPerceptual,
  linearToSrgb,
  luma,
  srgbToLinear,
  toImageData,
  toPerceptual,
} from './buffer'
import { gradient, meanLuminance, pixel, solid } from '#/test/helpers'

describe('sRGB transfer', () => {
  it('anchors at the endpoints', () => {
    expect(srgbToLinear(0)).toBe(0)
    expect(srgbToLinear(1)).toBeCloseTo(1, 6)
    expect(linearToSrgb(0)).toBe(0)
    expect(linearToSrgb(1)).toBeCloseTo(1, 6)
  })

  it('round-trips', () => {
    for (let i = 0; i <= 100; i++) {
      const value = i / 100
      expect(linearToSrgb(srgbToLinear(value))).toBeCloseTo(value, 6)
    }
  })

  it('puts perceptual mid-grey well below linear mid-grey', () => {
    // The entire reason the pipeline is linear: sRGB 0.5 is ~0.21 of the light.
    // Treating it as 0.5 is what blew out the first dither implementation.
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214, 3)
  })
})

describe('perceptual lookups', () => {
  it('agree with the exact functions within LUT resolution', () => {
    for (let i = 0; i <= 200; i++) {
      const value = i / 200
      expect(toPerceptual(value)).toBeCloseTo(linearToSrgb(value), 2)
      expect(fromPerceptual(value)).toBeCloseTo(srgbToLinear(value), 3)
    }
  })

  it('clamps outside 0..1', () => {
    expect(toPerceptual(-1)).toBe(0)
    expect(toPerceptual(5)).toBe(1)
    expect(fromPerceptual(-1)).toBe(0)
    expect(fromPerceptual(5)).toBe(1)
  })
})

describe('ImageData conversion', () => {
  it('round-trips every 8-bit value exactly', () => {
    const data = new Uint8ClampedArray(256 * 4)
    for (let i = 0; i < 256; i++) {
      data[i * 4] = i
      data[i * 4 + 1] = i
      data[i * 4 + 2] = i
      data[i * 4 + 3] = 255
    }

    const out = toImageData(fromImageData(new ImageData(data, 256, 1)))
    expect(Array.from(out.data)).toEqual(Array.from(data))
  })

  it('preserves alpha', () => {
    const data = new Uint8ClampedArray([10, 20, 30, 128])
    const out = toImageData(fromImageData(new ImageData(data, 1, 1)))
    expect(out.data[3]).toBe(128)
  })

  it('clamps out-of-range float values on the way out', () => {
    const buffer = solid(1, 1, -0.5, 2, 0.5)
    const out = toImageData(buffer)
    expect(out.data[0]).toBe(0)
    expect(out.data[1]).toBe(255)
  })
})

describe('luma', () => {
  it('is zero for black and one for white', () => {
    expect(luma(solid(1, 1, 0, 0, 0), 0)).toBe(0)
    expect(luma(solid(1, 1, 1, 1, 1), 0)).toBeCloseTo(1, 6)
  })

  it('weights green above red above blue', () => {
    const g = luma(solid(1, 1, 0, 1, 0), 0)
    const r = luma(solid(1, 1, 1, 0, 0), 0)
    const b = luma(solid(1, 1, 0, 0, 1), 0)
    expect(g).toBeGreaterThan(r)
    expect(r).toBeGreaterThan(b)
  })
})

describe('cloneBuffer', () => {
  it('copies rather than aliases', () => {
    const original = solid(4, 4, 0.5, 0.5, 0.5)
    const copy = cloneBuffer(original)
    copy.data[0] = 1
    expect(original.data[0]).toBe(0.5)
  })
})

describe('blur', () => {
  it('is a no-op at sigma 0', () => {
    const buffer = gradient(32, 4)
    const before = Array.from(buffer.data)
    blur(buffer, 0)
    expect(Array.from(buffer.data)).toEqual(before)
  })

  it('conserves mean brightness', () => {
    // Box passes with clamped edges preserve total energy; a blur that darkens
    // or brightens the image means the normalization is wrong.
    const buffer = gradient(64, 64)
    const before = meanLuminance(buffer)
    blur(buffer, 6)
    expect(meanLuminance(buffer)).toBeCloseTo(before, 2)
  })

  it('flattens a hard edge into a gradient', () => {
    const buffer = createBuffer(64, 1)
    for (let x = 0; x < 64; x++) {
      const v = x < 32 ? 0 : 1
      buffer.data[x * 4] = v
      buffer.data[x * 4 + 1] = v
      buffer.data[x * 4 + 2] = v
      buffer.data[x * 4 + 3] = 1
    }

    blur(buffer, 5)

    // Values immediately either side of the seam are no longer 0 and 1.
    expect(pixel(buffer, 30, 0)[0]).toBeGreaterThan(0)
    expect(pixel(buffer, 33, 0)[0]).toBeLessThan(1)
    // And the transition is monotonic across the seam.
    for (let x = 24; x < 40; x++) {
      expect(pixel(buffer, x + 1, 0)[0]).toBeGreaterThanOrEqual(
        pixel(buffer, x, 0)[0] - 1e-6,
      )
    }
  })

  it('leaves a uniform field uniform', () => {
    const buffer = solid(32, 32, 0.4, 0.4, 0.4)
    blur(buffer, 8)
    for (let i = 0; i < buffer.data.length; i += 4) {
      expect(buffer.data[i]).toBeCloseTo(0.4, 5)
    }
  })

  it('costs the same regardless of radius', () => {
    // The box approximation is why blur can be a freely draggable slider: it is
    // O(1) per pixel per pass, not O(radius).
    const time = (sigma: number) => {
      const buffer = gradient(256, 256)
      const start = performance.now()
      blur(buffer, sigma)
      return performance.now() - start
    }

    time(2) // warm up
    const small = time(2)
    const large = time(50)
    expect(large).toBeLessThan(Math.max(small * 4, 50))
  })
})
