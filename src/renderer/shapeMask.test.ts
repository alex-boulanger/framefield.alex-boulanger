import { describe, expect, it } from 'vitest'
import { compositeInto, shapeFieldSampler } from './blend'
import { sanitizeShapeMask } from './recipe'
import { NO_SHAPE, isShapeless } from './types'
import type { ShapeMask } from './types'
import { luma } from './buffer'
import { solid } from '#/test/helpers'

const shape = (over: Partial<ShapeMask> = {}): ShapeMask => ({
  ...NO_SHAPE,
  ...over,
})

describe('shapeFieldSampler', () => {
  /**
   * The field has to span exactly 0..1 across the frame, or `high: 1` quietly
   * stops covering the corners and the band controls stop meaning anything.
   */
  it('spans 0..1 across a linear field at any angle', () => {
    for (const angle of [0, 45, 90, 137, 270]) {
      const field = shapeFieldSampler(
        shape({ shape: 'linear', angle }),
        80,
        100,
      )

      let min = Infinity
      let max = -Infinity
      for (let y = 0; y < 100; y++) {
        for (let x = 0; x < 80; x++) {
          const value = field(x, y)
          min = Math.min(min, value)
          max = Math.max(max, value)
        }
      }

      expect(min, `angle ${angle}`).toBeGreaterThanOrEqual(-0.001)
      expect(max, `angle ${angle}`).toBeLessThanOrEqual(1.001)
      // And actually uses the range, rather than sitting in the middle of it.
      expect(max - min, `angle ${angle}`).toBeGreaterThan(0.9)
    }
  })

  it('runs left to right at 0 degrees', () => {
    const field = shapeFieldSampler(
      shape({ shape: 'linear', angle: 0 }),
      64,
      64,
    )
    expect(field(0, 32)).toBeLessThan(field(63, 32))
  })

  it('runs top to bottom at 90 degrees', () => {
    const field = shapeFieldSampler(
      shape({ shape: 'linear', angle: 90 }),
      64,
      64,
    )
    expect(field(32, 0)).toBeLessThan(field(32, 63))
  })

  it('reaches 0 at the centre and 1 at the corner of a radial field', () => {
    const field = shapeFieldSampler(shape({ shape: 'radial' }), 80, 100)
    // The corner *pixel* is half a pixel inside the geometric corner the field
    // is normalized against, so it lands just under 1 rather than exactly on it.
    expect(field(40, 50)).toBeLessThan(0.02)
    expect(field(0, 0)).toBeGreaterThan(0.97)
    expect(field(79, 99)).toBeGreaterThan(0.97)
  })

  it('moves the radial centre', () => {
    const field = shapeFieldSampler(
      shape({ shape: 'radial', centerX: -0.5, centerY: -0.5 }),
      64,
      64,
    )
    expect(field(0, 0)).toBeLessThan(0.02)
    expect(field(63, 63)).toBeGreaterThan(0.97)
  })
})

describe('shape mask compositing', () => {
  /** Half the frame gets the top layer, half keeps the base. */
  it('restricts a layer to part of the frame', () => {
    const base = solid(64, 64, 0, 0, 0)
    const top = solid(64, 64, 1, 1, 1)

    compositeInto(base, top, 1, 'normal', undefined, 'full', {
      ...NO_SHAPE,
      shape: 'linear',
      angle: 0,
      low: 0.5,
      high: 1,
    })

    expect(luma(base, (32 * 64 + 4) * 4)).toBeCloseTo(0, 4)
    expect(luma(base, (32 * 64 + 60) * 4)).toBeCloseTo(1, 4)
  })

  /**
   * The point of banding a spatial field rather than using a plain gradient:
   * a band in the middle is a stripe, which a gradient cannot express.
   */
  it('bands the middle into a stripe', () => {
    const base = solid(64, 8, 0, 0, 0)
    const top = solid(64, 8, 1, 1, 1)

    compositeInto(base, top, 1, 'normal', undefined, 'full', {
      ...NO_SHAPE,
      shape: 'linear',
      angle: 0,
      low: 0.4,
      high: 0.6,
    })

    expect(luma(base, 4 * 4)).toBeCloseTo(0, 4)
    expect(luma(base, 32 * 4)).toBeCloseTo(1, 4)
    expect(luma(base, 60 * 4)).toBeCloseTo(0, 4)
  })

  it('multiplies with the tone mask rather than replacing it', () => {
    // Base is mid grey, so the tone mask below admits it everywhere; the shape
    // mask must still confine the result to its half.
    const base = solid(64, 8, 0.5, 0.5, 0.5)
    const top = solid(64, 8, 1, 1, 1)

    compositeInto(
      base,
      top,
      1,
      'normal',
      { low: 0, high: 0.4, softness: 0 },
      'full',
      { ...NO_SHAPE, shape: 'linear', angle: 0, low: 0, high: 0.5 },
    )

    // Left half is inside the shape band but the tone band excludes this tone,
    // so nothing applies anywhere.
    expect(luma(base, 4 * 4)).toBeCloseTo(0.5, 4)
    expect(luma(base, 60 * 4)).toBeCloseTo(0.5, 4)
  })

  it('leaves the frame untouched at the identity', () => {
    const base = solid(16, 16, 0.25, 0.5, 0.75)
    const before = Array.from(base.data)
    compositeInto(base, base, 0, 'normal', undefined, 'full', { ...NO_SHAPE })
    expect(Array.from(base.data)).toEqual(before)
  })
})

describe('sanitizeShapeMask', () => {
  it('decodes a recipe written before the field existed', () => {
    expect(sanitizeShapeMask(undefined)).toEqual(NO_SHAPE)
    expect(isShapeless(sanitizeShapeMask(undefined))).toBe(true)
  })

  it('rejects an unknown shape', () => {
    expect(sanitizeShapeMask({ shape: 'hexagon' }).shape).toBe('none')
  })

  it('wraps the angle rather than clamping it', () => {
    expect(sanitizeShapeMask({ shape: 'linear', angle: 400 }).angle).toBe(40)
    expect(sanitizeShapeMask({ shape: 'linear', angle: -90 }).angle).toBe(270)
  })

  it('orders a reversed band', () => {
    const mask = sanitizeShapeMask({ shape: 'linear', low: 0.8, high: 0.2 })
    expect(mask.low).toBe(0.2)
    expect(mask.high).toBe(0.8)
  })

  it('clamps the centre into the frame', () => {
    const mask = sanitizeShapeMask({ shape: 'radial', centerX: 9, centerY: -9 })
    expect(mask.centerX).toBe(0.5)
    expect(mask.centerY).toBe(-0.5)
  })
})
