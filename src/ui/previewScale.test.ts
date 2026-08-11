import { describe, expect, it } from 'vitest'
import { previewRequestScales } from './previewScale'
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
