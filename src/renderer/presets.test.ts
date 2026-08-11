import { describe, expect, it } from 'vitest'
import { PRESETS, recipeFromPreset } from './presets'
import { decodeRecipe, encodeRecipe, sanitizeRecipe } from './recipe'
import { EFFECT_ORDER } from './effects'
import { renderRecipe } from './renderRecipe'
import { luma } from './buffer'
import { meanLuminance } from '#/test/helpers'

const CANVAS = { width: 1080, height: 1350 }

describe('PRESETS', () => {
  it('have unique ids and names', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length)
    expect(new Set(PRESETS.map((p) => p.name)).size).toBe(PRESETS.length)
  })

  it('only reference real effects', () => {
    for (const preset of PRESETS) {
      expect(preset.layers.length).toBeGreaterThan(0)
      for (const layer of preset.layers) {
        expect(EFFECT_ORDER).toContain(layer.type)
      }
    }
  })

  it('cover every effect between them', () => {
    // A preset library that never shows an effect is hiding a feature.
    const used = new Set(PRESETS.flatMap((p) => p.layers.map((l) => l.type)))
    for (const type of EFFECT_ORDER) {
      expect(used, `no preset demonstrates ${type}`).toContain(type)
    }
  })
})

describe('recipeFromPreset', () => {
  it.each(PRESETS.map((p) => [p.name, p] as const))(
    '%s builds a valid recipe',
    (_name, preset) => {
      const recipe = recipeFromPreset(preset, CANVAS)
      expect(recipe.version).toBe(1)
      expect(recipe.canvas).toEqual(CANVAS)
      expect(recipe.layers.length).toBe(preset.layers.length)
    },
  )

  it('fills unspecified params from the effect defaults', () => {
    // Presets carry deltas only, so a new param must not arrive undefined.
    for (const preset of PRESETS) {
      const recipe = recipeFromPreset(preset, CANVAS)
      for (const layer of recipe.layers) {
        for (const value of Object.values(layer.params)) {
          expect(value).toBeDefined()
        }
      }
    }
  })

  it('survives sanitization unchanged, so presets are shareable', () => {
    for (const preset of PRESETS) {
      const recipe = recipeFromPreset(preset, CANVAS)
      expect(sanitizeRecipe(JSON.parse(JSON.stringify(recipe)))).toEqual(recipe)
    }
  })

  it('round-trips through a URL', () => {
    for (const preset of PRESETS) {
      const recipe = recipeFromPreset(preset, CANVAS)
      expect(decodeRecipe(encodeRecipe(recipe))).toEqual(recipe)
    }
  })

  it('gives every layer a unique id', () => {
    const ids = PRESETS.flatMap((preset) =>
      recipeFromPreset(preset, CANVAS).layers.map((l) => l.id),
    )
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps the caller canvas rather than imposing one', () => {
    const square = recipeFromPreset(PRESETS[0], { width: 800, height: 800 })
    expect(square.canvas).toEqual({ width: 800, height: 800 })
  })

  it.each(PRESETS.map((p) => [p.name, p] as const))(
    '%s renders to something worth looking at',
    (_name, preset) => {
      // Small but real: the point is that no preset is blank, blown out, or
      // broken. A thumbnail of a black rectangle is worse than no thumbnail.
      //
      // Rendered the way the strip renders — full canvas, scaled down — not by
      // building the recipe at thumbnail size. The latter leaves spatial
      // params at export scale and collapsed Low-res to one flat tone.
      const recipe = recipeFromPreset(preset, CANVAS)
      const buffer = renderRecipe({ recipe, scale: 96 / CANVAS.width })
      const mean = meanLuminance(buffer)

      expect(mean).toBeGreaterThan(0.01)
      expect(mean).toBeLessThan(0.99)

      // And it has actual range, not one flat tone.
      //
      // Measured on luma, not on one channel. Several palettes pin red at 255
      // in two of three stops, so a red-only check reports zero range for an
      // image that is plainly varying in green and blue.
      let min = Infinity
      let max = -Infinity
      for (let i = 0; i < buffer.data.length; i += 4) {
        const value = luma(buffer, i)
        min = Math.min(min, value)
        max = Math.max(max, value)
      }
      expect(max - min).toBeGreaterThan(0.1)
    },
  )
})
