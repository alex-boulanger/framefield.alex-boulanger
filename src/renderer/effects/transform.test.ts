import { describe, expect, it } from 'vitest'
import { TRANSFORM_PARAMS, applyTransform } from './transform'
import { defaultParams } from '../params'
import { createBuffer, luma } from '../buffer'
import type { PixelBuffer } from '../buffer'
import { env, gradient, meanLuminance } from '#/test/helpers'

const base = () => defaultParams(TRANSFORM_PARAMS)

/** A frame with a bright square in one corner, so orientation is legible. */
function cornerMark(size = 32): PixelBuffer {
  const buffer = createBuffer(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const bright = x < size / 4 && y < size / 4
      const i = (y * size + x) * 4
      const value = bright ? 1 : 0.05
      buffer.data[i] = value
      buffer.data[i + 1] = value
      buffer.data[i + 2] = value
      buffer.data[i + 3] = 1
    }
  }
  return buffer
}

const at = (buffer: PixelBuffer, x: number, y: number) =>
  luma(buffer, (y * buffer.width + x) * 4)

describe('applyTransform', () => {
  /**
   * The identity must not resample. A bilinear round-trip through unchanged
   * coordinates still softens the image, and this effect sits in the default
   * add menu where most instances will be freshly created and untouched.
   */
  it('is a true no-op at its defaults', () => {
    const buffer = gradient(24, 24)
    const before = Array.from(buffer.data)
    applyTransform(buffer, base(), env(buffer))
    expect(Array.from(buffer.data)).toEqual(before)
  })

  it('flips horizontally', () => {
    const buffer = cornerMark()
    expect(at(buffer, 2, 2)).toBeGreaterThan(0.5)
    applyTransform(buffer, { ...base(), flipX: true }, env(buffer))
    expect(at(buffer, 2, 2)).toBeLessThan(0.5)
    expect(at(buffer, 29, 2)).toBeGreaterThan(0.5)
  })

  it('flips vertically', () => {
    const buffer = cornerMark()
    applyTransform(buffer, { ...base(), flipY: true }, env(buffer))
    expect(at(buffer, 2, 29)).toBeGreaterThan(0.5)
  })

  /** Quad symmetry folds one quadrant into all four. */
  it('makes the frame symmetric', () => {
    const buffer = cornerMark()
    applyTransform(buffer, { ...base(), symmetry: 'quad' }, env(buffer))

    for (const [x, y] of [
      [4, 4],
      [10, 3],
      [3, 12],
    ]) {
      const mirroredX = buffer.width - 1 - x
      const mirroredY = buffer.height - 1 - y
      expect(at(buffer, mirroredX, y)).toBeCloseTo(at(buffer, x, y), 5)
      expect(at(buffer, x, mirroredY)).toBeCloseTo(at(buffer, x, y), 5)
    }
  })

  it('rotating 360 degrees returns roughly the original', () => {
    const buffer = gradient(32, 32)
    const before = meanLuminance(buffer)
    applyTransform(buffer, { ...base(), rotate: 360 }, env(buffer))
    expect(meanLuminance(buffer)).toBeCloseTo(before, 5)
  })

  it('tiling repeats the frame', () => {
    const buffer = cornerMark(32)
    applyTransform(buffer, { ...base(), tile: 2 }, env(buffer))
    // The mark now appears once per tile, so it shows up in the second half.
    expect(at(buffer, 1, 1)).toBeGreaterThan(0.5)
    expect(at(buffer, 17, 17)).toBeGreaterThan(0.5)
  })

  it('kaleidoscope produces rotational repetition', () => {
    const plain = gradient(48, 48)
    const folded = gradient(48, 48)
    applyTransform(folded, { ...base(), kaleido: 6 }, env(folded))
    expect(Array.from(folded.data)).not.toEqual(Array.from(plain.data))
  })

  /**
   * Spatial params are authored in export pixels, so the same offset must move
   * the image the same *fraction* of the frame at any render scale.
   */
  it('scales the offset with the render scale', () => {
    const full = cornerMark(32)
    const half = cornerMark(32)
    applyTransform(full, { ...base(), offsetX: 8 }, env(full, 1))
    applyTransform(half, { ...base(), offsetX: 8 }, env(half, 0.5))
    expect(Array.from(full.data)).not.toEqual(Array.from(half.data))
  })

  it('leaves alpha alone', () => {
    const buffer = cornerMark(16)
    applyTransform(
      buffer,
      { ...base(), kaleido: 5, rotate: 33, zoom: 1.4 },
      env(buffer),
    )
    for (let i = 3; i < buffer.data.length; i += 4) {
      expect(buffer.data[i]).toBe(1)
    }
  })

  it('never writes NaN, whatever the combination', () => {
    const buffer = gradient(24, 24)
    applyTransform(
      buffer,
      {
        ...base(),
        symmetry: 'quad',
        kaleido: 7,
        rotate: 137,
        zoom: 0.3,
        tile: 3,
        offsetX: -60,
        offsetY: 40,
        flipX: true,
        flipY: true,
        wrap: false,
      },
      env(buffer),
    )
    expect(Array.from(buffer.data).every(Number.isFinite)).toBe(true)
  })
})
