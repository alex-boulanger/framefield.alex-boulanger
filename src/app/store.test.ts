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

describe('source palette changes', () => {
  it('updates FX palettes that still follow the generator palette', () => {
    const base = createDefaultRecipe()
    useLab.getState().hydrateRecipe(base)
    useLab.getState().randomizeFxStack()

    const before = useLab.getState().recipe
    if (before.source.type !== 'generator')
      throw new Error('expected generator')
    const oldPalette = before.source.params.palette
    if (!Array.isArray(oldPalette)) throw new Error('expected source palette')

    const nextPalette = ['#110000', '#ffeeee', '#ff3300']
    useLab.getState().setSourceParam('palette', nextPalette)

    const after = useLab.getState().recipe
    for (const layer of after.layers) {
      const prior = before.layers.find((entry) => entry.id === layer.id)
      if (samePalette(prior?.params.palette, oldPalette)) {
        expect(layer.params.palette).toEqual(nextPalette)
      }
    }
  })

  it('does not overwrite manually diverged FX palettes', () => {
    const base = createDefaultRecipe()
    useLab.getState().hydrateRecipe(base)
    useLab.getState().randomizeFxStack()

    const paletteLayer = useLab
      .getState()
      .recipe.layers.find((layer) => Array.isArray(layer.params.palette))
    if (!paletteLayer) throw new Error('expected a palette layer')

    const customPalette = ['#000000', '#ffffff']
    useLab.getState().setLayerParam(paletteLayer.id, 'palette', customPalette)
    useLab
      .getState()
      .setSourceParam('palette', ['#110000', '#ffeeee', '#ff3300'])

    const layer = useLab
      .getState()
      .recipe.layers.find((entry) => entry.id === paletteLayer.id)
    expect(layer?.params.palette).toEqual(customPalette)
  })
})
