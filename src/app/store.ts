import { create } from 'zustand'
import {
  createDefaultRecipe,
  createLayer,
  remixRecipe,
  randomizeFxStack,
  SIZE_PRESETS,
} from '#/renderer/recipe'
import { effectDefaults } from '#/renderer/effects'
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
  /** Object URL of the imported image, or null for generator sources. */
  imageUrl: string | null

  setRecipe: (recipe: Recipe) => void
  hydrateRecipe: (recipe: Recipe) => void
  setCanvasSize: (width: number, height: number) => void
  undo: () => void
  redo: () => void

  setSeed: (seed: string) => void
  randomizeSeed: () => void
  setSourceParam: (key: string, value: ParamValue) => void
  randomizeSource: () => void
  randomizeFxStack: () => void
  remix: () => void

  setImage: (url: string, name: string) => void
  clearImage: () => void

  addLayer: (type: EffectType) => void
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

function syncInheritedLayerPalettes(
  layers: Array<Layer>,
  previousPalette: unknown,
  nextPalette: unknown,
): Array<Layer> {
  if (!Array.isArray(nextPalette)) return layers

  return layers.map((layer) =>
    samePalette(layer.params.palette, previousPalette)
      ? {
          ...layer,
          params: { ...layer.params, palette: [...nextPalette] },
        }
      : layer,
  )
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

export const useLab = create<LabState>((set, get) => ({
  recipe: initialRecipe,
  past: [],
  future: [],
  selectedLayerId: initialRecipe.layers[0]?.id ?? null,
  imageUrl: null,

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

  setSeed: (seed) =>
    set((state) => ({
      ...pushHistory(state),
      recipe:
        state.recipe.source.type === 'generator'
          ? {
              ...state.recipe,
              source: { ...state.recipe.source, seed },
            }
          : state.recipe,
    })),

  randomizeSeed: () => get().setSeed(randomSeed()),

  setSourceParam: (key, value) =>
    set((state) => ({
      ...pushHistory(state),
      recipe:
        state.recipe.source.type === 'generator'
          ? {
              ...state.recipe,
              source: {
                ...state.recipe.source,
                params: { ...state.recipe.source.params, [key]: value },
              },
              layers:
                key === 'palette'
                  ? syncInheritedLayerPalettes(
                      state.recipe.layers,
                      state.recipe.source.params.palette,
                      value,
                    )
                  : state.recipe.layers,
            }
          : state.recipe,
    })),

  randomizeSource: () =>
    set((state) => {
      if (state.recipe.source.type !== 'generator') return state
      const seed = randomSeed()
      const palette = state.recipe.source.params.palette
      return {
        ...pushHistory(state),
        recipe: {
          ...state.recipe,
          source: {
            ...state.recipe.source,
            seed,
            params: randomizeField(
              seed,
              Array.isArray(palette)
                ? palette
                : ['#050505', '#f5f5f5', '#0057ff'],
            ),
          },
        },
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

  setImage: (url, name) =>
    set((state) => {
      // Release the previous object URL; leaking these across imports is a
      // real memory cost with large photos.
      if (state.imageUrl) URL.revokeObjectURL(state.imageUrl)
      return {
        ...pushHistory(state),
        imageUrl: url,
        recipe: { ...state.recipe, source: { type: 'image', name } },
      }
    }),

  clearImage: () =>
    set((state) => {
      if (state.imageUrl) URL.revokeObjectURL(state.imageUrl)
      const seed = randomSeed()
      return {
        ...pushHistory(state),
        imageUrl: null,
        recipe: {
          ...state.recipe,
          source: {
            type: 'generator',
            generator: 'field',
            seed,
            params: randomizeField(seed, ['#050505', '#f5f5f5', '#0057ff']),
          },
        },
      }
    }),

  addLayer: (type) =>
    set((state) => {
      const layer = createLayer(type)
      return {
        ...pushHistory(state),
        recipe: { ...state.recipe, layers: [...state.recipe.layers, layer] },
        selectedLayerId: layer.id,
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
        id: createLayer(source.type).id,
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
    set((state) => ({
      ...pushHistory(state),
      recipe: mapLayer(state.recipe, id, (layer) => ({
        ...layer,
        params: { ...layer.params, [key]: value },
      })),
    })),

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
        params: effectDefaults(layer.type),
      })),
    })),
}))

export const DEFAULT_SIZE = SIZE_PRESETS[1]
