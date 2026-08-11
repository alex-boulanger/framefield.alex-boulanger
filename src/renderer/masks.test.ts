import { describe, expect, it } from 'vitest'
import { bayerMask, blueNoiseMask, getMask, sampleMask } from './masks'
import { whiteNoise } from './noise'

/**
 * Local density of "on" pixels when the mask is thresholded at 0.5.
 *
 * This is the measurement that separates blue noise from white noise. Both are
 * uniform overall, but white noise clumps — some tiles come out much darker
 * than others — while blue noise spreads its samples evenly, so tile-to-tile
 * variance is much lower. That evenness is exactly what stops a dither from
 * looking blotchy.
 */
function densityVariance(
  values: Float32Array,
  size: number,
  tile: number,
): number {
  const perTile: Array<number> = []

  for (let ty = 0; ty < size; ty += tile) {
    for (let tx = 0; tx < size; tx += tile) {
      let on = 0
      for (let y = ty; y < ty + tile; y++) {
        for (let x = tx; x < tx + tile; x++) {
          if (values[y * size + x] > 0.5) on++
        }
      }
      perTile.push(on / (tile * tile))
    }
  }

  const mean = perTile.reduce((a, b) => a + b, 0) / perTile.length
  return perTile.reduce((sum, v) => sum + (v - mean) ** 2, 0) / perTile.length
}

describe('bayerMask', () => {
  it.each([2, 4, 8, 16])('of size %i is a permutation of 0..n²-1', (size) => {
    const mask = bayerMask(size)
    const total = size * size

    expect(mask).toHaveLength(total)

    const ranks = Array.from(mask, (v) => Math.round(v * total - 0.5)).sort(
      (a, b) => a - b,
    )
    expect(ranks).toEqual(Array.from({ length: total }, (_, i) => i))
  })

  it.each([2, 4, 8])('of size %i is strictly inside 0..1', (size) => {
    // Strictly inside, not merely within: a threshold of exactly 0 or 1 makes
    // one end of the tonal range unreachable.
    for (const value of bayerMask(size)) {
      expect(value).toBeGreaterThan(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('starts with the canonical 2x2 pattern', () => {
    expect(Array.from(bayerMask(2))).toEqual([0.125, 0.625, 0.875, 0.375])
  })
})

describe('blueNoiseMask', () => {
  it('is a permutation of the tonal range', () => {
    const size = 32
    const mask = blueNoiseMask(size, 1)
    const total = size * size

    const ranks = Array.from(mask, (v) => Math.round(v * total - 0.5)).sort(
      (a, b) => a - b,
    )
    expect(ranks).toEqual(Array.from({ length: total }, (_, i) => i))
  })

  it('is deterministic for a seed', () => {
    expect(Array.from(blueNoiseMask(16, 7))).toEqual(
      Array.from(blueNoiseMask(16, 7)),
    )
  })

  it('differs between seeds', () => {
    expect(Array.from(blueNoiseMask(16, 1))).not.toEqual(
      Array.from(blueNoiseMask(16, 2)),
    )
  })

  /**
   * The property that makes it worth having. If this fails, the mask is just
   * white noise with extra steps.
   */
  it('clumps less than white noise', () => {
    const size = 64
    const blue = blueNoiseMask(size, 3)

    const white = new Float32Array(size * size)
    const order = Array.from({ length: size * size }, (_, i) => i)
    // Rank-ordered white noise, so the two masks differ only in arrangement
    // and not in distribution — otherwise the comparison would be unfair.
    order.sort(
      (a, b) =>
        whiteNoise(a % size, (a / size) | 0, 99) -
        whiteNoise(b % size, (b / size) | 0, 99),
    )
    order.forEach((index, rank) => {
      white[index] = (rank + 0.5) / (size * size)
    })

    for (const tile of [4, 8]) {
      expect(densityVariance(blue, size, tile)).toBeLessThan(
        densityVariance(white, size, tile) * 0.7,
      )
    }
  })

  it('has no strong low-frequency component', () => {
    // A blurred blue-noise mask should sit close to flat 0.5 everywhere; a
    // mask with clumps would show large deviations after blurring.
    const size = 64
    const mask = blueNoiseMask(size, 5)
    const radius = 4
    let worst = 0

    for (let y = 0; y < size; y += 4) {
      for (let x = 0; x < size; x += 4) {
        let sum = 0
        let count = 0
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const sx = (((x + dx) % size) + size) % size
            const sy = (((y + dy) % size) + size) % size
            sum += mask[sy * size + sx]
            count++
          }
        }
        worst = Math.max(worst, Math.abs(sum / count - 0.5))
      }
    }

    expect(worst).toBeLessThan(0.12)
  })

  it('tiles without a seam', () => {
    // Built with a wrapping blur, so opposite edges must be as decorrelated as
    // any interior neighbours — a seam would show as a visible line.
    const size = 32
    const mask = blueNoiseMask(size, 11)

    let edgeDelta = 0
    let interiorDelta = 0
    for (let y = 0; y < size; y++) {
      edgeDelta += Math.abs(mask[y * size + size - 1] - mask[y * size])
      interiorDelta += Math.abs(mask[y * size + 10] - mask[y * size + 11])
    }

    expect(edgeDelta).toBeGreaterThan(interiorDelta * 0.5)
    expect(edgeDelta).toBeLessThan(interiorDelta * 2)
  })
})

describe('getMask', () => {
  it('caches by kind and size', () => {
    expect(getMask('bayer', 8)).toBe(getMask('bayer', 8))
    expect(getMask('blue', 64)).toBe(getMask('blue', 64))
    expect(getMask('bayer', 8)).not.toBe(getMask('bayer', 4))
  })

  it('samples with wraparound', () => {
    const mask = getMask('bayer', 4)
    expect(sampleMask(mask, 0, 0)).toBe(sampleMask(mask, 4, 4))
    expect(sampleMask(mask, 1, 2)).toBe(sampleMask(mask, 9, 6))
  })
})
