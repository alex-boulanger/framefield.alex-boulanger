import { whiteNoise } from './noise'

/**
 * Threshold masks for ordered dithering.
 *
 * An ordered dither compares each pixel against a position-dependent threshold
 * instead of a fixed one. The *distribution* of those thresholds over space is
 * what gives each mask its character: Bayer's recursive lattice reads as a
 * visible woven grid, while blue noise has no low-frequency structure at all
 * and reads as organic stipple.
 *
 * Every mask here is a permutation of `(rank + 0.5) / n²`. Uniform coverage of
 * the tonal range is what makes the dither reproduce tone correctly, and the
 * half-step centring keeps both pure black and pure white reachable.
 */

/**
 * Recursively generated Bayer matrix.
 *
 * Each cell expands into a 2x2 block: [[4M, 4M+2], [4M+3, 4M+1]]. The four
 * targets are interleaved positions in the doubled grid, not quadrant offsets —
 * writing them as quadrants makes two of them collide and the pattern degrades
 * into vertical banding.
 */
export function bayerMask(size: number): Float32Array {
  let matrix = [0]
  let n = 1

  while (n < size) {
    const width = n * 2
    const next = new Array<number>(width * width)

    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const value = matrix[y * n + x] * 4
        next[2 * y * width + 2 * x] = value
        next[2 * y * width + 2 * x + 1] = value + 2
        next[(2 * y + 1) * width + 2 * x] = value + 3
        next[(2 * y + 1) * width + 2 * x + 1] = value + 1
      }
    }

    matrix = next
    n = width
  }

  const total = size * size
  return Float32Array.from(matrix, (v) => (v + 0.5) / total)
}

/**
 * Gaussian kernel offsets for the cluster/void energy field, precomputed as a
 * flat list so the incremental updates are a tight loop.
 */
function energyKernel(size: number) {
  const sigma = 1.9
  const radius = Math.min(Math.floor(size / 2) - 1, 4)
  const offsets: Array<{ dx: number; dy: number; weight: number }> = []

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      offsets.push({
        dx,
        dy,
        weight: Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma)),
      })
    }
  }

  return offsets
}

/**
 * Tileable blue-noise mask, by void-and-cluster (Ulichney).
 *
 * Blue noise means energy concentrated at high frequencies: no clumps, no
 * voids, no visible lattice. The naive approach — high-pass white noise and
 * rank the residual — sounds right and does essentially nothing: one filtering
 * pass leaves so much low-frequency energy that the result clumps just as badly
 * as the white noise it came from. That was measurable, not theoretical: local
 * density variance came out within 2% of plain white noise.
 *
 * Void-and-cluster instead *places* each sample where the pattern is currently
 * emptiest, so evenness is constructed rather than hoped for. The energy field
 * is maintained incrementally — toggling one pixel touches only its kernel
 * footprint — which keeps the whole thing linear in the number of samples.
 *
 * All wrapping is toroidal, so the mask tiles seamlessly.
 */
export function blueNoiseMask(size: number, seed: number): Float32Array {
  const total = size * size
  const kernel = energyKernel(size)
  const energy = new Float32Array(total)
  const on = new Uint8Array(total)

  const wrap = (v: number) => ((v % size) + size) % size

  const toggle = (index: number, add: boolean) => {
    const x = index % size
    const y = (index / size) | 0
    for (const { dx, dy, weight } of kernel) {
      const target = wrap(y + dy) * size + wrap(x + dx)
      energy[target] += add ? weight : -weight
    }
    on[index] = add ? 1 : 0
  }

  /** Densest occupied cell. */
  const tightestCluster = () => {
    let best = -1
    let bestEnergy = -Infinity
    for (let i = 0; i < total; i++) {
      if (on[i] && energy[i] > bestEnergy) {
        bestEnergy = energy[i]
        best = i
      }
    }
    return best
  }

  /** Emptiest unoccupied cell. */
  const largestVoid = () => {
    let best = -1
    let bestEnergy = Infinity
    for (let i = 0; i < total; i++) {
      if (!on[i] && energy[i] < bestEnergy) {
        bestEnergy = energy[i]
        best = i
      }
    }
    return best
  }

  // Seed with a sparse random pattern, chosen deterministically.
  const initialCount = Math.max(1, Math.round(total * 0.1))
  const shuffled = Array.from({ length: total }, (_, i) => i)
  shuffled.sort(
    (a, b) =>
      whiteNoise(a % size, (a / size) | 0, seed) -
      whiteNoise(b % size, (b / size) | 0, seed),
  )
  for (let i = 0; i < initialCount; i++) toggle(shuffled[i], true)

  // Relax it: pull the tightest cluster apart into the largest void until
  // moving a point would put it straight back where it came from.
  for (let guard = 0; guard < total * 4; guard++) {
    const cluster = tightestCluster()
    toggle(cluster, false)
    const empty = largestVoid()
    if (empty === cluster) {
      toggle(cluster, true)
      break
    }
    toggle(empty, true)
  }

  const mask = new Float32Array(total)
  const prototype = Uint8Array.from(on)

  // Phase 1: unwind the prototype, densest point first, assigning ranks down.
  for (let rank = initialCount - 1; rank >= 0; rank--) {
    const cluster = tightestCluster()
    toggle(cluster, false)
    mask[cluster] = rank
  }

  // Restore, then fill every remaining cell, always into the biggest gap.
  // Past the halfway point this keeps working unchanged: with a toroidal
  // kernel the energy of the zeros is a constant minus the energy of the ones,
  // so the largest void *is* the tightest cluster of zeros.
  energy.fill(0)
  on.fill(0)
  for (let i = 0; i < total; i++) if (prototype[i]) toggle(i, true)

  for (let rank = initialCount; rank < total; rank++) {
    const empty = largestVoid()
    toggle(empty, true)
    mask[empty] = rank
  }

  for (let i = 0; i < total; i++) mask[i] = (mask[i] + 0.5) / total
  return mask
}

export interface Mask {
  size: number
  values: Float32Array
}

const CACHE = new Map<string, Mask>()

/** Masks are pure functions of their inputs, so they are built once and kept. */
export function getMask(kind: 'bayer' | 'blue', size: number): Mask {
  const key = `${kind}:${size}`
  let mask = CACHE.get(key)

  if (!mask) {
    mask = {
      size,
      values:
        kind === 'blue' ? blueNoiseMask(size, 0x5eed_1e55) : bayerMask(size),
    }
    CACHE.set(key, mask)
  }

  return mask
}

export function sampleMask(mask: Mask, x: number, y: number): number {
  return mask.values[(y % mask.size) * mask.size + (x % mask.size)]
}
