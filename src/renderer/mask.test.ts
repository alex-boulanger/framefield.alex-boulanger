import { describe, expect, it } from 'vitest'
import { compositeInto, maskWeight } from './blend'
import { renderRecipe } from './renderRecipe'
import { createEffectLayer, sanitizeMask, sanitizeRecipe } from './recipe'
import { isFullRange, NO_MASK } from './types'
import type { Layer, Params, Recipe } from './types'
import { createBuffer, luma } from './buffer'
import { gradient, pixel, solid } from '#/test/helpers'

describe('maskWeight', () => {
  it('is 1 across a full-range band', () => {
    for (const tone of [0, 0.25, 0.5, 0.75, 1]) {
      expect(maskWeight(NO_MASK, tone)).toBe(1)
    }
  })

  it('is binary with no feather', () => {
    const mask = { low: 0.3, high: 0.7, softness: 0 }
    expect(maskWeight(mask, 0.2)).toBe(0)
    expect(maskWeight(mask, 0.5)).toBe(1)
    expect(maskWeight(mask, 0.8)).toBe(0)
  })

  it('ramps across the feather', () => {
    const mask = { low: 0.4, high: 0.6, softness: 0.2 }
    expect(maskWeight(mask, 0.15)).toBeCloseTo(0, 2)
    expect(maskWeight(mask, 0.5)).toBe(1)
    expect(maskWeight(mask, 0.85)).toBeCloseTo(0, 2)
    // Halfway into the ramp should land near the middle.
    expect(maskWeight(mask, 0.3)).toBeGreaterThan(0.2)
    expect(maskWeight(mask, 0.3)).toBeLessThan(0.8)
  })

  it('rises monotonically into the band', () => {
    const mask = { low: 0.5, high: 0.9, softness: 0.3 }
    let previous = -1
    for (let tone = 0.2; tone <= 0.5; tone += 0.02) {
      const weight = maskWeight(mask, tone)
      expect(weight).toBeGreaterThanOrEqual(previous - 1e-9)
      previous = weight
    }
  })

  it('never leaves 0..1', () => {
    const mask = { low: 0.2, high: 0.4, softness: 0.5 }
    for (let tone = 0; tone <= 1; tone += 0.01) {
      const weight = maskWeight(mask, tone)
      expect(weight).toBeGreaterThanOrEqual(0)
      expect(weight).toBeLessThanOrEqual(1)
    }
  })
})

describe('isFullRange', () => {
  it('recognizes the identity band', () => {
    expect(isFullRange(NO_MASK)).toBe(true)
    expect(isFullRange({ low: 0, high: 1, softness: 0.2 })).toBe(true)
    expect(isFullRange({ low: 0.1, high: 1, softness: 0 })).toBe(false)
    expect(isFullRange({ low: 0, high: 0.9, softness: 0 })).toBe(false)
  })
})

describe('compositeInto with a mask', () => {
  it('applies fully inside the band and not at all outside', () => {
    // Left half dark, right half light; mask only the dark half.
    const base = createBuffer(4, 1)
    for (let x = 0; x < 4; x++) {
      const value = x < 2 ? 0.1 : 0.9
      const i = x * 4
      base.data[i] = value
      base.data[i + 1] = value
      base.data[i + 2] = value
      base.data[i + 3] = 1
    }

    const top = solid(4, 1, 1, 0, 0)
    compositeInto(base, top, 1, 'normal', { low: 0, high: 0.5, softness: 0 })

    expect(pixel(base, 0, 0)[0]).toBeCloseTo(1, 5)
    expect(pixel(base, 3, 0)[0]).toBeCloseTo(0.9, 5)
  })

  it('is unchanged by a full-range mask', () => {
    const masked = gradient(16, 4)
    const plain = gradient(16, 4)
    compositeInto(masked, solid(16, 4, 1, 0, 0), 0.6, 'normal', NO_MASK)
    compositeInto(plain, solid(16, 4, 1, 0, 0), 0.6, 'normal')
    expect(Array.from(masked.data)).toEqual(Array.from(plain.data))
  })

  it('multiplies with layer opacity rather than replacing it', () => {
    const base = solid(2, 1, 0, 0, 0)
    compositeInto(base, solid(2, 1, 1, 1, 1), 0.5, 'normal', {
      low: 0,
      high: 1,
      softness: 0,
    })
    expect(pixel(base, 0, 0)[0]).toBeCloseTo(0.5, 5)
  })

  it('measures the band on the base, not the effect output', () => {
    // The base is bright and outside the band, so a dark effect output must
    // not sneak in by being inside it.
    const base = solid(4, 1, 0.95, 0.95, 0.95)
    compositeInto(base, solid(4, 1, 0, 0, 0), 1, 'normal', {
      low: 0,
      high: 0.3,
      softness: 0,
    })
    expect(pixel(base, 0, 0)[0]).toBeCloseTo(0.95, 5)
  })
})

describe('sanitizeMask', () => {
  it('defaults junk to the identity band', () => {
    for (const junk of [null, undefined, 'x', 42, []]) {
      expect(sanitizeMask(junk)).toEqual(NO_MASK)
    }
  })

  it('clamps into 0..1', () => {
    expect(sanitizeMask({ low: -5, high: 9, softness: 4 })).toEqual({
      low: 0,
      high: 1,
      softness: 1,
    })
  })

  it('swaps a reversed band rather than rejecting it', () => {
    expect(sanitizeMask({ low: 0.8, high: 0.2, softness: 0 })).toEqual({
      low: 0.2,
      high: 0.8,
      softness: 0,
    })
  })
})

describe('masks in the pipeline', () => {
  function recipe(layers: Array<Layer>): Recipe {
    return {
      version: 2,
      canvas: { width: 64, height: 64 },
      background: '#000000',
      layers,
    }
  }

  function layer(params: Params, mask: Layer['mask']): Layer {
    const created = createEffectLayer('posterize')
    return {
      ...created,
      mask,
      params: { ...created.params, ...params },
    }
  }

  it('restricts an effect to part of the image', () => {
    const source = gradient(64, 64)
    const params = { levels: 2, mode: 'rgb' }

    const everywhere = renderRecipe({
      recipe: recipe([layer(params, { low: 0, high: 1, softness: 0 })]),
      resume: { index: 0, buffer: source },
    })
    const shadowsOnly = renderRecipe({
      recipe: recipe([layer(params, { low: 0, high: 0.25, softness: 0 })]),
      resume: { index: 0, buffer: source },
    })

    expect(Array.from(everywhere.data)).not.toEqual(
      Array.from(shadowsOnly.data),
    )

    // Bright pixels were outside the band, so they must equal the source.
    const x = 60
    expect(pixel(shadowsOnly, x, 0)[0]).toBeCloseTo(pixel(source, x, 0)[0], 5)
  })

  it('survives a recipe round trip', () => {
    const built = recipe([layer({}, { low: 0.2, high: 0.7, softness: 0.1 })])
    const clean = sanitizeRecipe(JSON.parse(JSON.stringify(built)))
    expect(clean?.layers[0].mask).toEqual({
      low: 0.2,
      high: 0.7,
      softness: 0.1,
    })
  })

  it('defaults to no mask on a recipe that predates the field', () => {
    // Older shared URLs have no mask key at all and must keep working.
    const clean = sanitizeRecipe({
      version: 1,
      source: {},
      canvas: { width: 64, height: 64 },
      layers: [{ type: 'posterize' }],
    })
    expect(clean?.layers[0].mask).toEqual(NO_MASK)
  })

  it('leaves the image untouched when the band excludes everything', () => {
    // Must match the recipe canvas, or the cache is rejected and the render
    // falls back to the black missing-image buffer — whose luma is inside the
    // band, so the layer would apply and the test would read as a real bug.
    const source = solid(64, 64, 0.9, 0.9, 0.9)
    const result = renderRecipe({
      recipe: recipe([
        layer({ levels: 2 }, { low: 0, high: 0.1, softness: 0 }),
      ]),
      resume: { index: 0, buffer: source },
    })
    for (let i = 0; i < result.data.length; i += 4) {
      expect(luma(result, i)).toBeCloseTo(luma(source, i), 5)
    }
  })

  it('composes down the stack, each mask reading what is beneath it', () => {
    const source = gradient(64, 64)
    const stacked = renderRecipe({
      recipe: recipe([
        layer({ levels: 2, mode: 'rgb' }, { low: 0, high: 0.4, softness: 0 }),
        layer({ levels: 3, mode: 'rgb' }, { low: 0.6, high: 1, softness: 0 }),
      ]),
      resume: { index: 0, buffer: source },
    })
    expect(Array.from(stacked.data)).not.toEqual(Array.from(source.data))
  })
})

describe('createEffectLayer', () => {
  it('starts with no mask', () => {
    expect(createEffectLayer('dither').mask).toEqual(NO_MASK)
  })

  it('gives each layer its own mask object', () => {
    const a = createEffectLayer('dither')
    const b = createEffectLayer('dither')
    a.mask.low = 0.5
    expect(b.mask.low).toBe(0)
  })
})
