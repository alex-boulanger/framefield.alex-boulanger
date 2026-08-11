import { describe, expect, it } from 'vitest'
import {
  createDefaultRecipe,
  createEffectLayer,
  createImageLayer,
  decodeRecipe,
  IMPORTED_ASSET,
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
    expect(recipe.layers.length).toBeGreaterThan(1)
    expect(recipe.layers[0].kind).toBe('generator')
    expect(recipe.canvas.width).toBeGreaterThan(0)
  })

  it('gives every layer a unique id', () => {
    const ids = [
      ...createDefaultRecipe().layers,
      createEffectLayer('dither'),
      createEffectLayer('dither'),
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
    // The migrated source is layer 0; the unknown effect never makes it in.
    expect(result?.layers.map((l) => l.kind)).toEqual([
      'generator',
      'effect',
      'effect',
    ])
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

  it('never lets pixel data into a recipe', () => {
    const result = sanitizeRecipe({
      version: 1,
      source: { type: 'image', name: 'photo.jpg', data: 'should-be-dropped' },
      canvas: { width: 100, height: 100 },
      layers: [],
    })
    expect(JSON.stringify(result)).not.toContain('should-be-dropped')
  })

  it('fills in defaults for missing layer params', () => {
    const result = sanitizeRecipe({
      version: 1,
      source: {},
      canvas: { width: 100, height: 100 },
      layers: [{ type: 'posterize' }],
    })
    expect(result?.layers[1].params.levels).toBe(5)
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
    expect(result?.layers[1].name).toBe('Ink pass')
    expect(result?.layers[2].name).toBeUndefined()
  })
})

describe('remixRecipe', () => {
  it('always yields a usable stack', () => {
    for (let i = 0; i < 200; i++) {
      const recipe = remixRecipe(createDefaultRecipe())
      expect(recipe.layers.length).toBeGreaterThan(1)
      expect(recipe.layers[0].kind).toBe('generator')
      for (const layer of recipe.layers) {
        if (layer.kind === 'effect') expect(EFFECT_ORDER).toContain(layer.type)
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

  it('reseeds every generator layer', () => {
    const before = createDefaultRecipe()
    const after = remixRecipe(before)
    expect(after.layers[0].params.seed).not.toBe(before.layers[0].params.seed)
  })

  it('gives stacked generators different seeds so they do not repeat', () => {
    const base = createDefaultRecipe()
    const twoFields = {
      ...base,
      layers: [...base.layers, createEffectLayer('grain'), base.layers[0]],
    }
    const seeds = remixRecipe(twoFields)
      .layers.filter((layer) => layer.kind === 'generator')
      .map((layer) => layer.params.seed)

    expect(seeds.length).toBe(2)
    expect(new Set(seeds).size).toBe(2)
  })

  it('keeps an imported layer rather than replacing it with a generator', () => {
    const base = createDefaultRecipe()
    const image = createImageLayer('asset_1', 'photo.jpg')
    const withImage = { ...base, layers: [image, ...base.layers.slice(1)] }

    const after = remixRecipe(withImage)
    expect(after.layers.filter((layer) => layer.kind === 'image')).toEqual([
      image,
    ])
  })

  it('leaves canvas size alone', () => {
    const base = createDefaultRecipe()
    expect(remixRecipe(base).canvas).toEqual(base.canvas)
  })
})

describe('randomizeFxStack', () => {
  it('rerolls the effects and leaves the composition alone', () => {
    const before = createDefaultRecipe()
    const after = randomizeFxStack(before)

    // The sources are the artwork; only their treatment is random.
    expect(after.layers.filter((layer) => layer.kind !== 'effect')).toEqual(
      before.layers.filter((layer) => layer.kind !== 'effect'),
    )
    expect(after.canvas).toEqual(before.canvas)
    expect(after.layers).not.toEqual(before.layers)
    expect(after.layers.length).toBeGreaterThan(1)
  })

  it('keeps source layers beneath the effects it adds', () => {
    const base = createDefaultRecipe()
    const image = createImageLayer('asset_1', 'photo.jpg')
    const after = randomizeFxStack({
      ...base,
      layers: [base.layers[0], image, ...base.layers.slice(1)],
    })

    const firstEffect = after.layers.findIndex((l) => l.kind === 'effect')
    const lastSource = after.layers.reduce(
      (last, layer, index) => (layer.kind === 'effect' ? last : index),
      -1,
    )
    expect(lastSource).toBeLessThan(firstEffect)
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

/**
 * Migration.
 *
 * v1 recipes are in share URLs and in every local snapshot already saved, so
 * they have to keep opening — and opening as the *same picture*, not merely
 * as something valid.
 */
describe('v1 migration', () => {
  const v1Generator = {
    version: 1,
    source: {
      type: 'generator',
      generator: 'field',
      seed: 'seed-from-v1',
      params: { field: 'ridged', scale: 3.5 },
    },
    canvas: { width: 512, height: 640 },
    layers: [
      { type: 'posterize', opacity: 0.8, name: 'Ink' },
      { type: 'dither', blendMode: 'multiply' },
    ],
  }

  it('turns a generator source plus FX into one stack', () => {
    const result = sanitizeRecipe(v1Generator)

    expect(result?.version).toBe(2)
    expect(result?.layers.map((layer) => layer.kind)).toEqual([
      'generator',
      'effect',
      'effect',
    ])
    // The source's identity survives the move into params.
    expect(result?.layers[0].params.seed).toBe('seed-from-v1')
    expect(result?.layers[0].params.field).toBe('ridged')
  })

  it('carries every effect layer across untouched', () => {
    const result = sanitizeRecipe(v1Generator)
    expect(result?.layers[1].opacity).toBe(0.8)
    expect(result?.layers[1].name).toBe('Ink')
    expect(result?.layers[2].blendMode).toBe('multiply')
  })

  it('turns an image source into an image layer with cover placement', () => {
    const result = sanitizeRecipe({
      ...v1Generator,
      source: { type: 'image', name: 'photo.jpg' },
    })

    const first = result?.layers[0]
    expect(first?.kind).toBe('image')
    expect(first?.name).toBe('photo.jpg')
    // v1 drew every import cover-fit and centred; these params say exactly
    // that, which is what makes the migration lossless.
    expect(first?.params).toEqual({ fit: 'cover', scale: 1, x: 0, y: 0 })
    if (first?.kind === 'image') expect(first.asset).toBe(IMPORTED_ASSET)
  })

  it('produces a recipe that sanitizes to itself', () => {
    const migrated = sanitizeRecipe(v1Generator)
    expect(sanitizeRecipe(JSON.parse(JSON.stringify(migrated)))).toEqual(
      migrated,
    )
  })

  it('survives malformed v2 layers without crashing', () => {
    const result = sanitizeRecipe({
      version: 2,
      canvas: { width: 100, height: 100 },
      background: 'not-a-colour',
      layers: [
        null,
        'nope',
        { kind: 'effect', type: 'not-real' },
        { kind: 'image' },
        { kind: 'generator', params: { scale: 'not-a-number' } },
        { kind: 'wat' },
      ],
    })

    expect(result?.layers.map((layer) => layer.kind)).toEqual([
      'image',
      'generator',
    ])
    expect(result?.background).toBe('#000000')
    // A junk param falls back to the spec default rather than reaching a pass.
    expect(typeof result?.layers[1].params.scale).toBe('number')
  })
})
