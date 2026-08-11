import { describe, expect, it } from 'vitest'
import {
  createDefaultRecipe,
  createLayer,
  decodeRecipe,
  encodeRecipe,
  randomizeFxStack,
  remixRecipe,
  sanitizeRecipe,
  SIZE_PRESETS,
} from './recipe'
import { EFFECT_ORDER } from './effects'

describe('createDefaultRecipe', () => {
  it('opens with a non-empty stack so first paint is interesting', () => {
    const recipe = createDefaultRecipe()
    expect(recipe.layers.length).toBeGreaterThan(0)
    expect(recipe.source.type).toBe('generator')
    expect(recipe.canvas.width).toBeGreaterThan(0)
  })

  it('gives every layer a unique id', () => {
    const ids = [
      ...createDefaultRecipe().layers,
      createLayer('dither'),
      createLayer('dither'),
    ].map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('encode/decode', () => {
  it('round-trips a recipe exactly', () => {
    const recipe = createDefaultRecipe()
    expect(decodeRecipe(encodeRecipe(recipe))).toEqual(recipe)
  })

  it('produces URL-safe output', () => {
    for (let i = 0; i < 25; i++) {
      expect(encodeRecipe(remixRecipe(createDefaultRecipe()))).toMatch(
        /^[A-Za-z0-9_-]+$/,
      )
    }
  })

  it('returns null for garbage rather than throwing', () => {
    for (const junk of ['', 'not-base64!!', 'YWJj', '###']) {
      expect(() => decodeRecipe(junk)).not.toThrow()
      expect(decodeRecipe(junk)).toBeNull()
    }
  })
})

describe('sanitizeRecipe', () => {
  it('rejects non-objects and wrong versions', () => {
    expect(sanitizeRecipe(null)).toBeNull()
    expect(sanitizeRecipe('nope')).toBeNull()
    expect(sanitizeRecipe({ version: 99 })).toBeNull()
  })

  it('drops layers with unknown effect types', () => {
    const result = sanitizeRecipe({
      version: 1,
      source: { type: 'generator', seed: 'abc' },
      canvas: { width: 100, height: 100 },
      layers: [
        { type: 'dither' },
        { type: 'not-a-real-effect' },
        { type: 'posterize' },
      ],
    })
    expect(result?.layers.map((l) => l.type)).toEqual(['dither', 'posterize'])
  })

  it('clamps canvas size to sane bounds', () => {
    const huge = sanitizeRecipe({
      version: 1,
      source: {},
      canvas: { width: 999_999, height: -5 },
      layers: [],
    })
    expect(huge?.canvas.width).toBe(8192)
    expect(huge?.canvas.height).toBe(16)
  })

  it('clamps layer opacity and falls back on unknown blend modes', () => {
    const result = sanitizeRecipe({
      version: 1,
      source: {},
      canvas: { width: 100, height: 100 },
      layers: [{ type: 'dither', opacity: 5, blendMode: 'hard-light' }],
    })
    expect(result?.layers[0].opacity).toBe(1)
    expect(result?.layers[0].blendMode).toBe('normal')
  })

  it('preserves an image source without carrying pixels', () => {
    const result = sanitizeRecipe({
      version: 1,
      source: { type: 'image', name: 'photo.jpg', data: 'should-be-dropped' },
      canvas: { width: 100, height: 100 },
      layers: [],
    })
    expect(result?.source).toEqual({ type: 'image', name: 'photo.jpg' })
  })

  it('fills in defaults for missing layer params', () => {
    const result = sanitizeRecipe({
      version: 1,
      source: {},
      canvas: { width: 100, height: 100 },
      layers: [{ type: 'posterize' }],
    })
    expect(result?.layers[0].params.levels).toBe(5)
  })

  it('preserves valid layer names and drops empty ones', () => {
    const result = sanitizeRecipe({
      version: 1,
      source: {},
      canvas: { width: 100, height: 100 },
      layers: [
        { type: 'posterize', name: '  Ink pass  ' },
        { type: 'dither', name: '   ' },
      ],
    })
    expect(result?.layers[0].name).toBe('Ink pass')
    expect(result?.layers[1].name).toBeUndefined()
  })
})

describe('remixRecipe', () => {
  it('always yields a usable stack', () => {
    for (let i = 0; i < 200; i++) {
      const recipe = remixRecipe(createDefaultRecipe())
      expect(recipe.layers.length).toBeGreaterThan(0)
      for (const layer of recipe.layers) {
        expect(EFFECT_ORDER).toContain(layer.type)
        expect(layer.opacity).toBeGreaterThan(0)
        expect(layer.opacity).toBeLessThanOrEqual(1)
      }
    }
  })

  it('survives its own sanitizer, so every remix is shareable', () => {
    // High iteration count on purpose: the negative-zero round-trip bug this
    // caught only appeared in roughly one remix in four.
    for (let i = 0; i < 500; i++) {
      const recipe = remixRecipe(createDefaultRecipe())
      expect(decodeRecipe(encodeRecipe(recipe))).toEqual(recipe)
    }
  })

  it('reseeds the generator', () => {
    const before = createDefaultRecipe()
    const after = remixRecipe(before)
    if (
      before.source.type === 'generator' &&
      after.source.type === 'generator'
    ) {
      expect(after.source.seed).not.toBe(before.source.seed)
    }
  })

  it('keeps an imported source rather than replacing it with a generator', () => {
    const base = createDefaultRecipe()
    const withImage = {
      ...base,
      source: { type: 'image' as const, name: 'photo.jpg' },
    }
    expect(remixRecipe(withImage).source).toEqual(withImage.source)
  })

  it('leaves canvas size alone', () => {
    const base = createDefaultRecipe()
    expect(remixRecipe(base).canvas).toEqual(base.canvas)
  })
})

describe('randomizeFxStack', () => {
  it('replaces only the layer stack', () => {
    const before = createDefaultRecipe()
    const after = randomizeFxStack(before)

    expect(after.source).toEqual(before.source)
    expect(after.canvas).toEqual(before.canvas)
    expect(after.layers).not.toEqual(before.layers)
    expect(after.layers.length).toBeGreaterThan(0)
  })

  it('survives its own sanitizer, so every FX stack is shareable', () => {
    for (let i = 0; i < 200; i++) {
      const recipe = randomizeFxStack(createDefaultRecipe())
      expect(decodeRecipe(encodeRecipe(recipe))).toEqual(recipe)
    }
  })
})

describe('SIZE_PRESETS', () => {
  it('cover the artwork aspects the export panel offers', () => {
    expect(
      SIZE_PRESETS.map((p) => `${p.aspect}:${p.width}x${p.height}`),
    ).toEqual([
      '1:1:1080x1080',
      '4:5:1080x1350',
      '9:16:1080x1920',
      '16:9:1920x1080',
      '1.91:1:1200x630',
    ])
  })
})
