import { describe, expect, it } from 'vitest'
import { applyPixelSort, PIXEL_SORT_PARAMS } from './pixelSort'
import { defaultParams } from '../params'
import { createBuffer, luma } from '../buffer'
import type { PixelBuffer } from '../buffer'
import { env, gradient, meanLuminance, pixel, solid } from '#/test/helpers'

const base = () => defaultParams(PIXEL_SORT_PARAMS)

/** Row of pseudo-random greys — unsorted by construction. */
function noiseRow(width: number, height = 1): PixelBuffer {
  const buffer = createBuffer(width, height)
  let state = 12345
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      state = (state * 1103515245 + 12345) & 0x7fffffff
      const value = (state % 1000) / 1000
      const i = (y * width + x) * 4
      buffer.data[i] = value
      buffer.data[i + 1] = value
      buffer.data[i + 2] = value
      buffer.data[i + 3] = 1
    }
  }
  return buffer
}

function isAscending(
  buffer: PixelBuffer,
  row: number,
  from: number,
  to: number,
) {
  for (let x = from + 1; x < to; x++) {
    const previous = luma(buffer, (row * buffer.width + x - 1) * 4)
    const current = luma(buffer, (row * buffer.width + x) * 4)
    if (current < previous - 1e-6) return false
  }
  return true
}

describe('applyPixelSort', () => {
  it('sorts a run that falls inside the band', () => {
    const buffer = noiseRow(64)
    applyPixelSort(
      buffer,
      { ...base(), low: 0, high: 1, maxRun: 600 },
      env(buffer),
    )
    expect(isAscending(buffer, 0, 0, 64)).toBe(true)
  })

  it('is a permutation — it moves pixels, never invents them', () => {
    const before = noiseRow(64)
    const original = Array.from(before.data).sort()
    applyPixelSort(before, { ...base(), low: 0, high: 1 }, env(before))
    expect(Array.from(before.data).sort()).toEqual(original)
  })

  it('leaves pixels outside the band untouched', () => {
    // Everything here is far brighter than the band, so nothing may move.
    const buffer = solid(32, 4, 0.95, 0.95, 0.95)
    const untouched = Array.from(buffer.data)
    applyPixelSort(buffer, { ...base(), low: 0, high: 0.2 }, env(buffer))
    expect(Array.from(buffer.data)).toEqual(untouched)
  })

  it('preserves mean brightness', () => {
    const buffer = noiseRow(64, 8)
    const before = meanLuminance(buffer)
    applyPixelSort(buffer, { ...base(), low: 0, high: 1 }, env(buffer))
    expect(meanLuminance(buffer)).toBeCloseTo(before, 6)
  })

  it('reverses when asked', () => {
    const ascending = noiseRow(64)
    const descending = noiseRow(64)
    applyPixelSort(ascending, { ...base(), low: 0, high: 1 }, env(ascending))
    applyPixelSort(
      descending,
      { ...base(), low: 0, high: 1, reverse: true },
      env(descending),
    )

    for (let x = 0; x < 64; x++) {
      expect(pixel(descending, x, 0)[0]).toBeCloseTo(
        pixel(ascending, 63 - x, 0)[0],
        6,
      )
    }
  })

  it('caps run length', () => {
    // With a max run of 16 the row becomes four independently sorted blocks,
    // so it must not be globally ascending.
    const buffer = noiseRow(64)
    applyPixelSort(
      buffer,
      { ...base(), low: 0, high: 1, maxRun: 16 },
      env(buffer),
    )
    expect(isAscending(buffer, 0, 0, 16)).toBe(true)
    expect(isAscending(buffer, 0, 0, 64)).toBe(false)
  })

  it('scales the run cap with the render scale', () => {
    const full = noiseRow(64)
    const half = noiseRow(64)
    applyPixelSort(
      full,
      { ...base(), low: 0, high: 1, maxRun: 32 },
      env(full, 1),
    )
    applyPixelSort(
      half,
      { ...base(), low: 0, high: 1, maxRun: 32 },
      env(half, 0.5),
    )
    expect(Array.from(full.data)).not.toEqual(Array.from(half.data))
  })

  it('sorts columns when rotated', () => {
    const rows = noiseRow(32, 32)
    const cols = noiseRow(32, 32)
    applyPixelSort(rows, { ...base(), low: 0, high: 1 }, env(rows))
    applyPixelSort(
      cols,
      { ...base(), low: 0, high: 1, rotation: '90' },
      env(cols),
    )
    expect(Array.from(rows.data)).not.toEqual(Array.from(cols.data))
  })

  it('gives all four rotations a different result', () => {
    const results = ['0', '90', '180', '270'].map((rotation) => {
      const buffer = noiseRow(24, 24)
      applyPixelSort(
        buffer,
        { ...base(), low: 0, high: 1, rotation },
        env(buffer),
      )
      return Array.from(buffer.data).join(',')
    })
    expect(new Set(results).size).toBe(4)
  })

  /**
   * The point of the rotation control: which *end* the sorted pixels pile up
   * at. 90 drips downward, 270 climbs. Sorting ascending along the traversal
   * means the darkest end lands where the walk starts.
   */
  it('drips down at 90 and climbs at 270', () => {
    const down = noiseRow(8, 32)
    const up = noiseRow(8, 32)
    applyPixelSort(
      down,
      { ...base(), low: 0, high: 1, rotation: '90', maxRun: 600 },
      env(down),
    )
    applyPixelSort(
      up,
      { ...base(), low: 0, high: 1, rotation: '270', maxRun: 600 },
      env(up),
    )

    const topOf = (buffer: PixelBuffer) => luma(buffer, 0)
    const bottomOf = (buffer: PixelBuffer) =>
      luma(buffer, (31 * buffer.width + 0) * 4)

    expect(topOf(down)).toBeLessThan(bottomOf(down))
    expect(topOf(up)).toBeGreaterThan(bottomOf(up))
  })

  it('reverses independently of rotation', () => {
    // Rotation picks the direction of travel; reverse flips light for dark.
    // They must be separate controls, not two spellings of one.
    const plain = noiseRow(8, 32)
    const flipped = noiseRow(8, 32)
    applyPixelSort(
      plain,
      { ...base(), low: 0, high: 1, rotation: '90', maxRun: 600 },
      env(plain),
    )
    applyPixelSort(
      flipped,
      {
        ...base(),
        low: 0,
        high: 1,
        rotation: '90',
        maxRun: 600,
        reverse: true,
      },
      env(flipped),
    )
    expect(luma(plain, 0)).toBeGreaterThan(0)
    expect(luma(flipped, 0)).toBeGreaterThan(luma(plain, 0))
  })

  it('gives each sort key a different arrangement', () => {
    const results = ['luma', 'hue', 'saturation', 'red'].map((sortBy) => {
      const buffer = createBuffer(32, 1)
      for (let x = 0; x < 32; x++) {
        const i = x * 4
        buffer.data[i] = (x % 7) / 7
        buffer.data[i + 1] = (x % 5) / 5
        buffer.data[i + 2] = (x % 3) / 3
        buffer.data[i + 3] = 1
      }
      applyPixelSort(
        buffer,
        { ...base(), low: 0, high: 1, sortBy },
        env(buffer),
      )
      return Array.from(buffer.data).join(',')
    })
    expect(new Set(results).size).toBeGreaterThan(1)
  })

  it('swaps low and high if given backwards', () => {
    const straight = noiseRow(48)
    const swapped = noiseRow(48)
    applyPixelSort(straight, { ...base(), low: 0.2, high: 0.8 }, env(straight))
    applyPixelSort(swapped, { ...base(), low: 0.8, high: 0.2 }, env(swapped))
    expect(Array.from(swapped.data)).toEqual(Array.from(straight.data))
  })

  it('is deterministic', () => {
    const a = gradient(48, 48)
    const b = gradient(48, 48)
    applyPixelSort(a, base(), env(a))
    applyPixelSort(b, base(), env(b))
    expect(Array.from(a.data)).toEqual(Array.from(b.data))
  })
})
