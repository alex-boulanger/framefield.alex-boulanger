import { describe, expect, it } from 'vitest'
import {
  interactiveRung,
  previewLadder,
  previewRequestScales,
} from './previewScale'
import type { Recipe } from '#/renderer/types'

function recipe(width: number, height: number): Recipe {
  return {
    version: 2,
    canvas: { width, height },
    background: '#000000',
    layers: [],
  }
}

describe('previewRequestScales', () => {
  it('keeps worker-backed interactive renders cheap and reserves high fidelity for settled renders', () => {
    const scales = previewRequestScales(recipe(2160, 3840), 900, 1200, true)

    expect(scales.interactive).toBeLessThan(0.25)
    expect(scales.settled).toBeGreaterThan(scales.interactive)
  })
})

describe('previewLadder', () => {
  it('ends at the settled scale', () => {
    const ladder = previewLadder(1)
    expect(ladder[ladder.length - 1]).toBe(1)
  })

  it('quarters the cost at each step down', () => {
    // Cost goes as the square of the scale, so halving the scale quarters the
    // work. This is the property that makes the whole ladder affordable.
    const ladder = previewLadder(1)
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i] / ladder[i - 1]).toBeCloseTo(2, 5)
    }
  })

  it('costs about a third more than its top rung alone', () => {
    const ladder = previewLadder(1)
    const relativeCost = ladder.reduce((sum, scale) => sum + scale ** 2, 0)
    // The old two-pass preview already paid ~1.30x for its discarded frame.
    expect(relativeCost).toBeLessThan(1.4)
  })

  it('collapses rungs that fall onto the floor rather than repeating them', () => {
    const ladder = previewLadder(0.1)
    expect(new Set(ladder).size).toBe(ladder.length)
    expect(Math.min(...ladder)).toBeGreaterThan(0)
  })
})

describe('interactiveRung', () => {
  it('is the highest rung the persistent worker can afford', () => {
    expect(interactiveRung([0.125, 0.25, 0.5, 1], 0.54)).toBe(2)
    expect(interactiveRung([0.125, 0.25, 0.5, 1], 1)).toBe(3)
  })

  it('never goes below the first rung, so there is always something to render', () => {
    expect(interactiveRung([0.125, 0.25, 0.5, 1], 0.01)).toBe(0)
  })
})
