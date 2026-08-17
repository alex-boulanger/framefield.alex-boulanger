import { describe, expect, it } from 'vitest'
import {
  createBlankRecipe,
  createDefaultRecipe,
  createEffectLayer,
  createImageLayer,
  createRandomRecipe,
  createTextLayer,
  decodeRecipe,
  decodeRecipeAny,
  IMPORTED_ASSET,
  encodeRecipe,
  paletteFromRecipe,
  encodeRecipeCompressed,
  randomizeFxStack,
  remixRecipe,
  baseLayerName,
  sanitizeRecipe,
  SIZE_PRESETS,
  uniqueLayerName,
  withGeneratedNames,
} from './recipe'
import { EFFECT_ORDER } from './effects'
import { DEFAULT_PALETTE } from './layers/text'
import { renderRecipe } from './renderRecipe'
import type { Recipe } from './types'

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

  /**
   * The type is above the damage with only the bloom over it, which is what
   * makes the words on first paint readable rather than sorted into streaks.
   */
  it('puts the 2D text layer directly under the bloom', () => {
    expect(topOfStack(createDefaultRecipe())).toEqual(['text', 'bloom'])
  })
})

/** The kinds of the top two layers, as `'text'` / an effect type. */
function topOfStack(recipe: Recipe): Array<string> {
  return recipe.layers
    .slice(-2)
    .map((layer) => (layer.kind === 'effect' ? layer.type : layer.kind))
}

describe('createTextLayer', () => {
  it('creates a 2D text source with visible defaults', () => {
    const layer = createTextLayer()
    expect(layer.kind).toBe('text')
    expect(layer.name).toBe('2D Text')
    expect(layer.params.text).toBe('FRAME\nFIELD')
    expect(layer.params.font).toBe('anton')
    // Colour is an index into the layer's own palette, never a raw swatch.
    expect(layer.params.palette).toEqual(DEFAULT_PALETTE)
    expect(typeof layer.params.ink).toBe('number')
  })
})

describe('opening documents', () => {
  /**
   * The default is built at module scope and prerendered into the static HTML,
   * so it must be identical every time it is constructed. A random seed here
   * is a hydration mismatch, and the seed is visible in the inspector.
   */
  it('builds the default document deterministically', () => {
    const a = createDefaultRecipe()
    const b = createDefaultRecipe()
    expect(a.layers.map((layer) => layer.params)).toEqual(
      b.layers.map((layer) => layer.params),
    )
    expect(a.layers[0].params.seed).toBe(b.layers[0].params.seed)
  })

  it('opens a blank document with nothing in it', () => {
    const blank = createBlankRecipe({ width: 1200, height: 630 })
    expect(blank.layers).toEqual([])
    // A new piece is not a reason to forget the format already chosen.
    expect(blank.canvas).toEqual({ width: 1200, height: 630 })
  })

  it('renders a blank document as the bare background', () => {
    const blank = createBlankRecipe({ width: 8, height: 8 })
    expect(() => renderRecipe({ recipe: blank, scale: 1 })).not.toThrow()
  })

  it('survives its own sanitizer, so a blank document is shareable', () => {
    const blank = createBlankRecipe()
    expect(decodeRecipe(encodeRecipe(blank))).toEqual(blank)
  })

  it('gives a different random artwork each time', () => {
    const seeds = new Set(
      Array.from({ length: 20 }, () => {
        const recipe = createRandomRecipe()
        return String(recipe.layers[0].params.seed)
      }),
    )
    expect(seeds.size).toBeGreaterThan(15)
  })

  /**
   * Opening on a random artwork is only an improvement if every one of them is
   * worth looking at — this is the same bar Remix is held to, since it is the
   * same code path.
   */
  it('always opens on a usable stack', () => {
    for (let i = 0; i < 100; i++) {
      const recipe = createRandomRecipe()
      expect(recipe.layers.length).toBeGreaterThan(1)
      expect(recipe.layers[0].kind).toBe('generator')
      expect(decodeRecipe(encodeRecipe(recipe))).toEqual(recipe)
    }
  })

  it('keeps the canvas it is given', () => {
    const size = { width: 1920, height: 1080 }
    expect(createRandomRecipe(size).canvas).toEqual(size)
  })
})

describe('generated layer names', () => {
  it('names every layer it is given', () => {
    const named = withGeneratedNames([
      createEffectLayer('dither'),
      createEffectLayer('posterize'),
    ])
    expect(named.map((layer) => layer.name)).toEqual(['Dither', 'Posterize'])
  })

  /** Three dithers in a stack must not be three identical rows. */
  it('numbers repeats of the same type', () => {
    const named = withGeneratedNames([
      createEffectLayer('dither'),
      createEffectLayer('dither'),
      createEffectLayer('dither'),
    ])
    expect(named.map((layer) => layer.name)).toEqual([
      'Dither',
      'Dither 2',
      'Dither 3',
    ])
  })

  /** It runs over recipes that may already carry the user's own labels. */
  it('leaves existing names alone', () => {
    const custom = { ...createEffectLayer('dither'), name: 'Ink pass' }
    const named = withGeneratedNames([custom, createEffectLayer('dither')])
    expect(named.map((layer) => layer.name)).toEqual(['Ink pass', 'Dither'])
    expect(named[0]).toBe(custom)
  })

  it('does not collide with a name the user already used', () => {
    const named = withGeneratedNames([
      { ...createEffectLayer('posterize'), name: 'Dither' },
      createEffectLayer('dither'),
    ])
    expect(named.map((layer) => layer.name)).toEqual(['Dither', 'Dither 2'])
  })

  it('gives every layer in a fresh document a distinct name', () => {
    for (const recipe of [createDefaultRecipe(), createRandomRecipe()]) {
      const names = recipe.layers.map((layer) => layer.name)
      expect(names.every(Boolean)).toBe(true)
      expect(new Set(names).size).toBe(names.length)
    }
  })

  describe('uniqueLayerName', () => {
    it('returns the base when it is free', () => {
      expect(uniqueLayerName('Dither', [])).toBe('Dither')
    })

    it('skips over gaps rather than reusing a taken suffix', () => {
      expect(uniqueLayerName('Dither', ['Dither', 'Dither 2'])).toBe('Dither 3')
    })
  })

  describe('baseLayerName', () => {
    /** Duplicating a duplicate must count up, not nest into "Dither 2 2 2". */
    it('strips a trailing counter', () => {
      expect(baseLayerName('Dither 2')).toBe('Dither')
      expect(baseLayerName('Dither 2 2')).toBe('Dither 2')
    })

    it('leaves a name without one alone', () => {
      expect(baseLayerName('Dither')).toBe('Dither')
      expect(baseLayerName('Ink pass')).toBe('Ink pass')
    })

    it('counts up across repeated duplication', () => {
      const taken = ['Dither']
      for (const expected of ['Dither 2', 'Dither 3', 'Dither 4']) {
        const next = uniqueLayerName(
          baseLayerName(taken[taken.length - 1]),
          taken,
        )
        expect(next).toBe(expected)
        taken.push(next)
      }
    })
  })
})

describe('locks', () => {
  function lockedStack() {
    const base = createDefaultRecipe()
    const layers = base.layers.map((layer, index) =>
      index === 0 ? { ...layer, locked: true } : layer,
    )
    return { ...base, layers }
  }

  it('leaves a locked generator entirely alone across a remix', () => {
    const before = lockedStack()
    for (let i = 0; i < 25; i++) {
      const after = remixRecipe(before)
      expect(after.layers[0]).toEqual(before.layers[0])
    }
  })

  it('still rerolls an unlocked generator', () => {
    const before = createDefaultRecipe()
    const after = remixRecipe(before)
    expect(after.layers[0].params.seed).not.toBe(before.layers[0].params.seed)
  })

  /** The whole point of locking an effect: it survives the reroll. */
  it('keeps a locked effect through randomize', () => {
    const base = createDefaultRecipe()
    const pinned = { ...base.layers[2], locked: true, name: 'Pinned' }
    const after = randomizeFxStack({
      ...base,
      layers: [base.layers[0], base.layers[1], pinned],
    })
    expect(after.layers.find((layer) => layer.name === 'Pinned')).toEqual(
      pinned,
    )
  })

  it('drops unlocked effects as before', () => {
    const base = createDefaultRecipe()
    const after = randomizeFxStack(base)
    expect(after.layers.filter((layer) => layer.kind === 'effect')).not.toEqual(
      base.layers.filter((layer) => layer.kind === 'effect'),
    )
  })

  it('holds the palette when asked', () => {
    const before = createDefaultRecipe()
    const palette = before.layers[0].params.palette
    for (let i = 0; i < 10; i++) {
      const after = remixRecipe(before, { lockPalette: true })
      expect(after.layers[0].params.palette).toEqual(palette)
    }
  })

  it('picks a new palette when not asked', () => {
    const before = createDefaultRecipe()
    const seen = new Set(
      Array.from({ length: 25 }, () =>
        JSON.stringify(remixRecipe(before).layers[0].params.palette),
      ),
    )
    expect(seen.size).toBeGreaterThan(1)
  })

  /** A lock must not add noise to every layer of every share URL. */
  it('serializes nothing for an unlocked layer', () => {
    expect(JSON.stringify(createDefaultRecipe())).not.toContain('locked')
  })

  it('round-trips a lock through the sanitizer', () => {
    const locked = lockedStack()
    expect(decodeRecipe(encodeRecipe(locked))).toEqual(locked)
  })

  it('ignores a non-boolean lock from an untrusted recipe', () => {
    const parsed = sanitizeRecipe({
      version: 2,
      canvas: { width: 100, height: 100 },
      layers: [{ kind: 'effect', type: 'dither', locked: 'yes please' }],
    })
    expect(parsed?.layers[0].locked).toBeUndefined()
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

describe('compressed encoding', () => {
  /**
   * A stack deep enough that compression is worth doing, using *distinct*
   * effects. Twelve copies of one layer would compress ~90% and prove nothing
   * about a real document; a stack of different effects is the honest case.
   */
  function deepRecipe() {
    const base = createDefaultRecipe()
    const layers = [
      base.layers[0],
      ...EFFECT_ORDER.map((type) => createEffectLayer(type)),
    ]
    return { ...base, layers }
  }

  it('round-trips through the compressed form', async () => {
    const recipe = deepRecipe()
    const encoded = await encodeRecipeCompressed(recipe)
    expect(await decodeRecipeAny(encoded)).toEqual(recipe)
  })

  /**
   * The whole point. Past roughly 2KB, links start being truncated by
   * messaging apps and unfurlers, and a 13-layer stack blows through that
   * uncompressed.
   */
  it('is substantially shorter than the plain encoding on a deep stack', () => {
    const recipe = deepRecipe()
    return encodeRecipeCompressed(recipe).then((packed) => {
      expect(packed.length).toBeLessThan(encodeRecipe(recipe).length / 2)
    })
  })

  it('stays URL-safe', async () => {
    const encoded = await encodeRecipeCompressed(deepRecipe())
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  /**
   * Links already exist in the wild and are the only copy of what they encode.
   * The decoder must keep reading them forever.
   */
  it('still decodes uncompressed links', async () => {
    const recipe = createDefaultRecipe()
    const legacy = encodeRecipe(recipe)
    expect(legacy.startsWith('eyJ2')).toBe(true)
    expect(await decodeRecipeAny(legacy)).toEqual(recipe)
  })

  it('returns null for garbage rather than throwing', async () => {
    for (const junk of ['z', 'z###', 'zYWJj', 'not-base64!!']) {
      await expect(decodeRecipeAny(junk)).resolves.toBeNull()
    }
  })

  /**
   * A mangled link must not be able to replace a good document with nothing.
   * Compression makes this sharper: a truncated deflate stream can inflate into
   * something that still parses as JSON but has lost fields.
   */
  it('rejects a v2 payload with no layers array instead of emptying the stack', () => {
    expect(
      sanitizeRecipe({ version: 2, canvas: { width: 100, height: 100 } }),
    ).toBeNull()
    expect(sanitizeRecipe({ version: 2, layers: 'nope' })).toBeNull()
  })

  it('still honours a deliberately empty stack', () => {
    const emptied = sanitizeRecipe({ version: 2, layers: [] })
    expect(emptied).not.toBeNull()
    expect(emptied?.layers).toEqual([])
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

  it('sanitizes 2D text layers', () => {
    const result = sanitizeRecipe({
      version: 2,
      canvas: { width: 100, height: 100 },
      layers: [
        {
          kind: 'text',
          id: 'text_1',
          params: {
            text: 'Hello\nFramefield',
            font: 'bodoni',
            fill: 'stripe',
            width: 5000,
            rotate: 900,
          },
        },
      ],
    })

    const layer = result?.layers[0]
    expect(layer?.kind).toBe('text')
    expect(layer?.params.text).toBe('Hello\nFramefield')
    expect(layer?.params.font).toBe('bodoni')
    expect(layer?.params.fill).toBe('stripe')
    expect(layer?.params.width).toBe(4096)
    expect(layer?.params.rotate).toBe(180)
  })

  /**
   * A face this build does not carry has to fall back to one it does. The
   * alternative is `ctx.font` silently resolving to the browser's default,
   * which is the outcome bundling the faces exists to prevent.
   */
  it('falls back when a recipe names an unknown typeface', () => {
    const result = sanitizeRecipe({
      version: 2,
      canvas: { width: 100, height: 100 },
      layers: [
        { kind: 'text', id: 'text_1', params: { font: 'helvetica-neue' } },
      ],
    })

    expect(result?.layers[0].params.font).toBe('anton')
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

  it('keeps a 2D text layer rather than replacing it with a generator', () => {
    const text = createTextLayer()
    const withText = { ...createBlankRecipe(), layers: [text] }

    const kept = remixRecipe(withText).layers.filter(
      (layer) => layer.kind === 'text',
    )
    expect(kept.length).toBe(1)
    expect(kept[0].id).toBe(text.id)
  })

  /**
   * The opening frame is a remix, so type that remixes to the same setting
   * every time is type the user sees identically on every first load.
   */
  it('rerolls the typography, keeping the words', () => {
    const before = createDefaultRecipe()
    const original = before.layers.find((layer) => layer.kind === 'text')

    const settings = new Set(
      Array.from({ length: 20 }, () => {
        const after = remixRecipe(before)
        const text = after.layers.find((layer) => layer.kind === 'text')
        expect(text?.params.text).toBe(original?.params.text)
        return JSON.stringify(text?.params)
      }),
    )
    expect(settings.size).toBeGreaterThan(15)
  })

  /**
   * A headline is part of the artwork's colourway, not a label on top of it —
   * the same reason its colours are palette indices rather than swatches.
   */
  it('recolours the words with the stack', () => {
    for (let i = 0; i < 20; i++) {
      const after = remixRecipe(createDefaultRecipe())
      const text = after.layers.find((layer) => layer.kind === 'text')
      expect(text?.params.palette).toEqual(paletteFromRecipe(after))
    }
  })

  it('leaves a locked text layer exactly as it was', () => {
    const text = { ...createTextLayer(), locked: true }
    const withText = { ...createBlankRecipe(), layers: [text] }

    expect(
      remixRecipe(withText).layers.filter((layer) => layer.kind === 'text'),
    ).toEqual([text])
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
      // No text layer: type is the one source that deliberately rides above
      // the damage, and it has its own test below.
      layers: [
        base.layers[0],
        image,
        ...base.layers.filter((layer) => layer.kind === 'effect'),
      ],
    })

    const firstEffect = after.layers.findIndex((l) => l.kind === 'effect')
    const lastSource = after.layers.reduce(
      (last, layer, index) => (layer.kind === 'effect' ? last : index),
      -1,
    )
    expect(lastSource).toBeLessThan(firstEffect)
  })

  /**
   * The arrangement the app opens on, pinned.
   *
   * Every remix of a document with type has to land here, not just the first
   * one: the opening document is a remix of the default, so a stack that puts
   * the pixel sort over the words is what the user would see on load.
   */
  it('lifts 2D text above the damage and under the bloom', () => {
    for (let i = 0; i < 50; i++) {
      const after = randomizeFxStack(createDefaultRecipe())
      expect(topOfStack(after)).toEqual(['text', 'bloom'])

      // And there is something underneath for it to composite over.
      expect(
        after.layers
          .slice(0, -2)
          .some((layer) => layer.kind === 'effect' && layer.type !== 'bloom'),
      ).toBe(true)
    }
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
