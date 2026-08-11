import { describe, expect, it } from 'vitest'
import { useLab } from './store'
import { createDefaultRecipe } from '#/renderer/recipe'

function samePalette(a: unknown, b: unknown) {
  return (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((color, index) => color === b[index])
  )
}

describe('useLab history', () => {
  it('undoes and redoes recipe edits', () => {
    const base = createDefaultRecipe()
    useLab.getState().hydrateRecipe(base)

    useLab.getState().setCanvasSize(1200, 630)
    expect(useLab.getState().recipe.canvas).toEqual({
      width: 1200,
      height: 630,
    })

    useLab.getState().undo()
    expect(useLab.getState().recipe.canvas).toEqual(base.canvas)

    useLab.getState().redo()
    expect(useLab.getState().recipe.canvas).toEqual({
      width: 1200,
      height: 630,
    })
  })

  it('clears redo history after a fresh edit', () => {
    const base = createDefaultRecipe()
    useLab.getState().hydrateRecipe(base)

    useLab.getState().setCanvasSize(1200, 630)
    useLab.getState().undo()
    expect(useLab.getState().future.length).toBe(1)

    useLab.getState().setCanvasSize(1080, 1920)
    expect(useLab.getState().future.length).toBe(0)
  })

  it('undoes layer renames', () => {
    const base = createDefaultRecipe()
    useLab.getState().hydrateRecipe(base)
    const id = base.layers[0].id

    useLab.getState().setLayerName(id, 'Ink pass')
    expect(useLab.getState().recipe.layers[0].name).toBe('Ink pass')

    useLab.getState().undo()
    expect(useLab.getState().recipe.layers[0].name).toBeUndefined()
  })
})

describe('generator palette changes', () => {
  /** The bottom generator, which is the stack's colourway. */
  function generatorId() {
    const layer = useLab
      .getState()
      .recipe.layers.find((entry) => entry.kind === 'generator')
    if (!layer) throw new Error('expected a generator layer')
    return layer.id
  }

  it('updates FX palettes that still follow the generator palette', () => {
    // An explicit posterize rather than a random stack: the randomizer is free
    // to return a stack with no palette-bearing effect at all.
    useLab.getState().hydrateRecipe(createDefaultRecipe())
    useLab.getState().addEffectLayer('posterize')

    const before = useLab.getState().recipe
    const id = generatorId()
    const oldPalette = before.layers.find((l) => l.id === id)?.params.palette
    if (!Array.isArray(oldPalette)) throw new Error('expected a palette')

    const nextPalette = ['#110000', '#ffeeee', '#ff3300']
    useLab.getState().setLayerParam(id, 'palette', nextPalette)

    const after = useLab.getState().recipe
    for (const layer of after.layers) {
      const prior = before.layers.find((entry) => entry.id === layer.id)
      if (samePalette(prior?.params.palette, oldPalette)) {
        expect(layer.params.palette).toEqual(nextPalette)
      }
    }
  })

  it('does not overwrite manually diverged FX palettes', () => {
    useLab.getState().hydrateRecipe(createDefaultRecipe())
    useLab.getState().addEffectLayer('posterize')

    const paletteLayer = useLab
      .getState()
      .recipe.layers.find(
        (layer) =>
          layer.kind === 'effect' && Array.isArray(layer.params.palette),
      )
    if (!paletteLayer) throw new Error('expected a palette layer')

    const customPalette = ['#000000', '#ffffff']
    useLab.getState().setLayerParam(paletteLayer.id, 'palette', customPalette)
    useLab
      .getState()
      .setLayerParam(generatorId(), 'palette', ['#110000', '#ffeeee', '#ff3300'])

    const layer = useLab
      .getState()
      .recipe.layers.find((entry) => entry.id === paletteLayer.id)
    expect(layer?.params.palette).toEqual(customPalette)
  })

  it('leaves a second generator with its own palette alone', () => {
    // Two fields deliberately coloured differently must stay that way; only
    // layers that never chose a palette follow the one being edited.
    const base = createDefaultRecipe()
    useLab.getState().hydrateRecipe(base)
    useLab.getState().addGeneratorLayer()

    const second = useLab.getState().selectedLayerId!
    const own = ['#123456', '#abcdef']
    useLab.getState().setLayerParam(second, 'palette', own)
    useLab
      .getState()
      .setLayerParam(generatorId(), 'palette', ['#110000', '#ffeeee'])

    const layer = useLab
      .getState()
      .recipe.layers.find((entry) => entry.id === second)
    expect(layer?.params.palette).toEqual(own)
  })
})

describe('editing mixed layer kinds', () => {
  it('adds, selects, and reorders each kind', () => {
    useLab.getState().hydrateRecipe(createDefaultRecipe())

    useLab.getState().addGeneratorLayer()
    const generator = useLab.getState().selectedLayerId!
    useLab.getState().addImageLayer('blob:test', 'photo.jpg')
    const image = useLab.getState().selectedLayerId!
    useLab.getState().addEffectLayer('grain')
    const effect = useLab.getState().selectedLayerId!

    const kinds = useLab.getState().recipe.layers.slice(-3).map((l) => l.kind)
    expect(kinds).toEqual(['generator', 'image', 'effect'])

    // The import's pixels live outside the document, keyed by handle.
    const layer = useLab
      .getState()
      .recipe.layers.find((entry) => entry.id === image)
    if (layer?.kind !== 'image') throw new Error('expected an image layer')
    expect(useLab.getState().assets[layer.asset]).toBe('blob:test')
    expect(JSON.stringify(useLab.getState().recipe)).not.toContain('blob:test')

    useLab.getState().moveLayerTo(effect, 0)
    expect(useLab.getState().recipe.layers[0].id).toBe(effect)

    useLab.getState().undo()
    expect(useLab.getState().recipe.layers[0].id).not.toBe(effect)

    // Duplicating any kind gives a fresh id and an independent params object.
    useLab.getState().duplicateLayer(generator)
    const copy = useLab.getState().selectedLayerId!
    expect(copy).not.toBe(generator)
    useLab.getState().setLayerParam(copy, 'scale', 9)
    const original = useLab
      .getState()
      .recipe.layers.find((entry) => entry.id === generator)
    expect(original?.params.scale).not.toBe(9)
  })

  it('keeps an imported asset available after undoing its layer', () => {
    // Undo removes the layer, not the file — redo has to find the pixels again.
    useLab.getState().hydrateRecipe(createDefaultRecipe())
    useLab.getState().addImageLayer('blob:kept', 'photo.jpg')

    const layer = useLab.getState().recipe.layers.at(-1)
    if (layer?.kind !== 'image') throw new Error('expected an image layer')

    useLab.getState().undo()
    expect(useLab.getState().assets[layer.asset]).toBe('blob:kept')

    useLab.getState().redo()
    expect(useLab.getState().recipe.layers.at(-1)?.id).toBe(layer.id)
  })

  it('reseeds a generator without touching its parameters', () => {
    useLab.getState().hydrateRecipe(createDefaultRecipe())
    const id = useLab.getState().recipe.layers[0].id
    const before = useLab.getState().recipe.layers[0].params

    useLab.getState().reseedLayer(id)
    const after = useLab.getState().recipe.layers[0].params

    expect(after.seed).not.toBe(before.seed)
    expect(after.scale).toBe(before.scale)
  })

  it('randomize-FX leaves every non-effect layer untouched', () => {
    useLab.getState().hydrateRecipe(createDefaultRecipe())
    useLab.getState().addImageLayer('blob:test', 'photo.jpg')

    const before = useLab
      .getState()
      .recipe.layers.filter((layer) => layer.kind !== 'effect')
    useLab.getState().randomizeFxStack()
    const after = useLab
      .getState()
      .recipe.layers.filter((layer) => layer.kind !== 'effect')

    expect(after).toEqual(before)
  })
})
