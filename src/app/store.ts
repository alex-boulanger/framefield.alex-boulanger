import { create } from 'zustand'
import {
  createDefaultRecipe,
  createEffectLayer,
  createGeneratorLayer,
  createImageLayer,
  createLayerId,
  layerDefaults,
  remixRecipe,
  randomizeFxStack,
  SIZE_PRESETS,
} from '#/renderer/recipe'
import { randomizeField } from '#/renderer/generators/field'
import { randomSeed } from '#/renderer/rng'
import { NO_MASK } from '#/renderer/types'
import type {
  BlendMode,
  EffectType,
  Layer,
  ParamValue,
  Recipe,
  ToneMask,
} from '#/renderer/types'

/**
 * React owns UI state, the renderer owns pixels (ADR Decision 4).
 *
 * Note what is NOT here: no ImageData, no canvas refs, no decoded bitmaps. The
 * imported bitmap lives outside the store entirely, because putting a decoded
 * image in serializable document state is exactly the coupling Decision 4 is
 * meant to prevent.
 */

export interface LabState {
  recipe: Recipe
  past: Array<Recipe>
  future: Array<Recipe>
  selectedLayerId: string | null
  /**
   * Object URLs for imported images, by asset handle.
   *
   * Deliberately outside the recipe *and* outside history. An image layer
   * carries only its handle, so undoing the layer that introduced an import
   * has to be able to find those pixels again when it is redone — which means
   * the registry only ever grows, for the life of the session.
   */
  assets: Record<string, string>

  setRecipe: (recipe: Recipe) => void
  hydrateRecipe: (recipe: Recipe) => void
  setCanvasSize: (width: number, height: number) => void
  undo: () => void
  redo: () => void

  randomizeFxStack: () => void
  remix: () => void

  addEffectLayer: (type: EffectType) => void
  addGeneratorLayer: () => void
  addImageLayer: (url: string, name: string) => void
  removeLayer: (id: string) => void
  duplicateLayer: (id: string) => void
  toggleLayer: (id: string) => void
  selectLayer: (id: string | null) => void
  moveLayerTo: (id: string, targetIndex: number) => void
  setLayerParam: (id: string, key: string, value: ParamValue) => void
  setLayerOpacity: (id: string, opacity: number) => void
  setLayerBlendMode: (id: string, mode: BlendMode) => void
  setLayerMask: (id: string, mask: Partial<ToneMask>) => void
  setLayerName: (id: string, name: string) => void
  resetLayer: (id: string) => void
  /** Reroll a generator layer's seed, keeping its parameters. */
  reseedLayer: (id: string) => void
  /** Reroll a generator layer's parameters, keeping the stack's palette. */
  randomizeLayer: (id: string) => void
}

const initialRecipe = createDefaultRecipe()
const HISTORY_LIMIT = 80

function pushHistory(state: LabState): Pick<LabState, 'past' | 'future'> {
  return {
    past: [...state.past, state.recipe].slice(-HISTORY_LIMIT),
    future: [],
  }
}

function selectedLayer(recipe: Recipe, selectedLayerId: string | null) {
  return recipe.layers.some((layer) => layer.id === selectedLayerId)
    ? selectedLayerId
    : (recipe.layers[0]?.id ?? null)
}

function samePalette(a: unknown, b: unknown) {
  return (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((color, index) => color === b[index])
  )
}

/**
 * Recolouring a generator carries its treatments with it.
 *
 * Two limits, both learned the hard way. Only effect layers follow: a second
 * generator is a compositional choice with its own colourway, and recolouring
 * one field must not silently repaint the other. And only effects that still
 * match the *old* palette follow, so a layer the user deliberately set stays
 * set. Without any of this, a preset loses its colour scheme the moment the
 * field is recoloured.
 */
function syncInheritedLayerPalettes(
  layers: Array<Layer>,
  previousPalette: unknown,
  nextPalette: unknown,
): Array<Layer> {
  if (!Array.isArray(nextPalette)) return layers

  return layers.map((layer) =>
    layer.kind === 'effect' &&
    samePalette(layer.params.palette, previousPalette)
      ? {
          ...layer,
          params: { ...layer.params, palette: [...nextPalette] },
        }
      : layer,
  )
}

/** Add to the top of the stack and select it, whatever the layer renders. */
function appendLayer(state: LabState, layer: Layer) {
  return {
    ...pushHistory(state),
    recipe: { ...state.recipe, layers: [...state.recipe.layers, layer] },
    selectedLayerId: layer.id,
  }
}

/** Immutable layer edit — keeps recipe identity changing only when it must. */
function mapLayer(
  recipe: Recipe,
  id: string,
  update: (layer: Layer) => Layer,
): Recipe {
  return {
    ...recipe,
    layers: recipe.layers.map((layer) =>
      layer.id === id ? update(layer) : layer,
    ),
  }
}

export const useLab = create<LabState>((set) => ({
  recipe: initialRecipe,
  past: [],
  future: [],
  selectedLayerId: initialRecipe.layers[0]?.id ?? null,
  assets: {},

  setRecipe: (recipe) =>
    set((state) => ({
      ...pushHistory(state),
      recipe,
      selectedLayerId: selectedLayer(recipe, state.selectedLayerId),
    })),

  hydrateRecipe: (recipe) =>
    set((state) => ({
      recipe,
      past: [],
      future: [],
      selectedLayerId: selectedLayer(recipe, state.selectedLayerId),
    })),

  setCanvasSize: (width, height) =>
    set((state) => ({
      ...pushHistory(state),
      recipe: { ...state.recipe, canvas: { width, height } },
    })),

  undo: () =>
    set((state) => {
      if (state.past.length === 0) return state
      const previous = state.past[state.past.length - 1]
      return {
        recipe: previous,
        past: state.past.slice(0, -1),
        future: [state.recipe, ...state.future].slice(0, HISTORY_LIMIT),
        selectedLayerId: selectedLayer(previous, state.selectedLayerId),
      }
    }),

  redo: () =>
    set((state) => {
      if (state.future.length === 0) return state
      const next = state.future[0]
      return {
        recipe: next,
        past: [...state.past, state.recipe].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        selectedLayerId: selectedLayer(next, state.selectedLayerId),
      }
    }),

  randomizeFxStack: () =>
    set((state) => {
      const recipe = randomizeFxStack(state.recipe)
      return {
        ...pushHistory(state),
        recipe,
        selectedLayerId: recipe.layers[0]?.id ?? null,
      }
    }),

  remix: () =>
    set((state) => {
      const recipe = remixRecipe(state.recipe)
      return {
        ...pushHistory(state),
        recipe,
        selectedLayerId: recipe.layers[0]?.id ?? null,
      }
    }),

  addEffectLayer: (type) => set((state) => appendLayer(state, createEffectLayer(type))),

  addGeneratorLayer: () =>
    set((state) => appendLayer(state, createGeneratorLayer())),

  addImageLayer: (url, name) =>
    set((state) => {
      const asset = `asset_${createLayerId()}`
      return {
        ...appendLayer(state, createImageLayer(asset, name)),
        assets: { ...state.assets, [asset]: url },
      }
    }),

  removeLayer: (id) =>
    set((state) => {
      const layers = state.recipe.layers.filter((layer) => layer.id !== id)
      return {
        ...pushHistory(state),
        recipe: { ...state.recipe, layers },
        selectedLayerId:
          state.selectedLayerId === id
            ? (layers[layers.length - 1]?.id ?? null)
            : state.selectedLayerId,
      }
    }),

  duplicateLayer: (id) =>
    set((state) => {
      const index = state.recipe.layers.findIndex((layer) => layer.id === id)
      if (index === -1) return state
      const source = state.recipe.layers[index]
      const copy: Layer = {
        ...source,
        id: createLayerId(),
        params: { ...source.params },
      }
      const layers = [...state.recipe.layers]
      layers.splice(index + 1, 0, copy)
      return {
        ...pushHistory(state),
        recipe: { ...state.recipe, layers },
        selectedLayerId: copy.id,
      }
    }),

  toggleLayer: (id) =>
    set((state) => ({
      ...pushHistory(state),
      recipe: mapLayer(state.recipe, id, (layer) => ({
        ...layer,
        enabled: !layer.enabled,
      })),
    })),

  selectLayer: (id) => set({ selectedLayerId: id }),

  moveLayerTo: (id, targetIndex) =>
    set((state) => {
      const layers = [...state.recipe.layers]
      const index = layers.findIndex((layer) => layer.id === id)
      if (index === -1) return state
      const clamped = Math.max(0, Math.min(layers.length - 1, targetIndex))
      if (index === clamped) return state
      const [layer] = layers.splice(index, 1)
      layers.splice(clamped, 0, layer)
      return { ...pushHistory(state), recipe: { ...state.recipe, layers } }
    }),

  setLayerParam: (id, key, value) =>
    set((state) => {
      const edited = state.recipe.layers.find((layer) => layer.id === id)
      const recipe = mapLayer(state.recipe, id, (layer) => ({
        ...layer,
        params: { ...layer.params, [key]: value },
      }))

      return {
        ...pushHistory(state),
        recipe:
          key === 'palette' && edited?.kind === 'generator'
            ? {
                ...recipe,
                layers: syncInheritedLayerPalettes(
                  recipe.layers,
                  edited.params.palette,
                  value,
                ),
              }
            : recipe,
      }
    }),

  setLayerOpacity: (id, opacity) =>
    set((state) => ({
      ...pushHistory(state),
      recipe: mapLayer(state.recipe, id, (layer) => ({ ...layer, opacity })),
    })),

  setLayerBlendMode: (id, mode) =>
    set((state) => ({
      ...pushHistory(state),
      recipe: mapLayer(state.recipe, id, (layer) => ({
        ...layer,
        blendMode: mode,
      })),
    })),

  setLayerMask: (id, mask) =>
    set((state) => ({
      ...pushHistory(state),
      recipe: mapLayer(state.recipe, id, (layer) => {
        const next = { ...layer.mask, ...mask }
        // Keep the band ordered while dragging so the two handles can cross
        // without the layer blinking out.
        return {
          ...layer,
          mask: {
            low: Math.min(next.low, next.high),
            high: Math.max(next.low, next.high),
            softness: next.softness,
          },
        }
      }),
    })),

  setLayerName: (id, name) =>
    set((state) => ({
      ...pushHistory(state),
      recipe: mapLayer(state.recipe, id, (layer) => {
        const trimmed = name.trim().slice(0, 48)
        return {
          ...layer,
          name: trimmed.length > 0 ? trimmed : undefined,
        }
      }),
    })),

  resetLayer: (id) =>
    set((state) => ({
      ...pushHistory(state),
      recipe: mapLayer(state.recipe, id, (layer) => ({
        ...layer,
        opacity: 1,
        blendMode: 'normal',
        mask: { ...NO_MASK },
        params: layerDefaults(layer),
      })),
    })),

  reseedLayer: (id) =>
    set((state) => ({
      ...pushHistory(state),
      recipe: mapLayer(state.recipe, id, (layer) =>
        layer.kind === 'generator'
          ? { ...layer, params: { ...layer.params, seed: randomSeed() } }
          : layer,
      ),
    })),

  randomizeLayer: (id) =>
    set((state) => ({
      ...pushHistory(state),
      recipe: mapLayer(state.recipe, id, (layer) => {
        if (layer.kind !== 'generator') return layer
        // Keep the layer's own palette: rerolling the shape of a field should
        // not also change the colours the rest of the stack inherited.
        const palette = Array.isArray(layer.params.palette)
          ? layer.params.palette
          : ['#050505', '#f5f5f5', '#0057ff']
        return { ...layer, params: randomizeField(randomSeed(), palette) }
      }),
    })),
}))

export const DEFAULT_SIZE = SIZE_PRESETS[1]
