import { create } from 'zustand'
import {
  createDefaultRecipe,
  createLayer,
  remixRecipe,
  SIZE_PRESETS,
} from '#/renderer/recipe'
import { effectDefaults } from '#/renderer/effects'
import { randomizeField } from '#/renderer/generators/field'
import { randomSeed } from '#/renderer/rng'
import type {
  BlendMode,
  EffectType,
  Layer,
  ParamValue,
  Recipe,
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
  selectedLayerId: string | null
  /** Object URL of the imported image, or null for generator sources. */
  imageUrl: string | null
  comparing: boolean

  setRecipe: (recipe: Recipe) => void
  setCanvasSize: (width: number, height: number) => void

  setSeed: (seed: string) => void
  randomizeSeed: () => void
  setSourceParam: (key: string, value: ParamValue) => void
  randomizeSource: () => void
  remix: () => void

  setImage: (url: string, name: string) => void
  clearImage: () => void

  addLayer: (type: EffectType) => void
  removeLayer: (id: string) => void
  duplicateLayer: (id: string) => void
  toggleLayer: (id: string) => void
  selectLayer: (id: string | null) => void
  moveLayer: (id: string, direction: -1 | 1) => void
  setLayerParam: (id: string, key: string, value: ParamValue) => void
  setLayerOpacity: (id: string, opacity: number) => void
  setLayerBlendMode: (id: string, mode: BlendMode) => void
  resetLayer: (id: string) => void

  setComparing: (comparing: boolean) => void
}

const initialRecipe = createDefaultRecipe()

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
  selectedLayerId: initialRecipe.layers[0]?.id ?? null,
  imageUrl: null,
  comparing: false,

  setRecipe: (recipe) =>
    set((state) => ({
      recipe,
      selectedLayerId: recipe.layers.some((l) => l.id === state.selectedLayerId)
        ? state.selectedLayerId
        : (recipe.layers[0]?.id ?? null),
    })),

  setCanvasSize: (width, height) =>
    set((state) => ({
      recipe: { ...state.recipe, canvas: { width, height } },
    })),

  setSeed: (seed) =>
    set((state) => ({
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
      recipe:
        state.recipe.source.type === 'generator'
          ? {
              ...state.recipe,
              source: {
                ...state.recipe.source,
                params: { ...state.recipe.source.params, [key]: value },
              },
            }
          : state.recipe,
    })),

  randomizeSource: () =>
    set((state) => {
      if (state.recipe.source.type !== 'generator') return state
      const seed = randomSeed()
      const palette = state.recipe.source.params.palette
      return {
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

  remix: () =>
    set((state) => {
      const recipe = remixRecipe(state.recipe)
      return { recipe, selectedLayerId: recipe.layers[0]?.id ?? null }
    }),

  setImage: (url, name) =>
    set((state) => {
      // Release the previous object URL; leaking these across imports is a
      // real memory cost with large photos.
      if (state.imageUrl) URL.revokeObjectURL(state.imageUrl)
      return {
        imageUrl: url,
        recipe: { ...state.recipe, source: { type: 'image', name } },
      }
    }),

  clearImage: () =>
    set((state) => {
      if (state.imageUrl) URL.revokeObjectURL(state.imageUrl)
      const seed = randomSeed()
      return {
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
        recipe: { ...state.recipe, layers: [...state.recipe.layers, layer] },
        selectedLayerId: layer.id,
      }
    }),

  removeLayer: (id) =>
    set((state) => {
      const layers = state.recipe.layers.filter((layer) => layer.id !== id)
      return {
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
        recipe: { ...state.recipe, layers },
        selectedLayerId: copy.id,
      }
    }),

  toggleLayer: (id) =>
    set((state) => ({
      recipe: mapLayer(state.recipe, id, (layer) => ({
        ...layer,
        enabled: !layer.enabled,
      })),
    })),

  selectLayer: (id) => set({ selectedLayerId: id }),

  moveLayer: (id, direction) =>
    set((state) => {
      const layers = [...state.recipe.layers]
      const index = layers.findIndex((layer) => layer.id === id)
      const target = index + direction
      if (index === -1 || target < 0 || target >= layers.length) return state
      ;[layers[index], layers[target]] = [layers[target], layers[index]]
      return { recipe: { ...state.recipe, layers } }
    }),

  setLayerParam: (id, key, value) =>
    set((state) => ({
      recipe: mapLayer(state.recipe, id, (layer) => ({
        ...layer,
        params: { ...layer.params, [key]: value },
      })),
    })),

  setLayerOpacity: (id, opacity) =>
    set((state) => ({
      recipe: mapLayer(state.recipe, id, (layer) => ({ ...layer, opacity })),
    })),

  setLayerBlendMode: (id, mode) =>
    set((state) => ({
      recipe: mapLayer(state.recipe, id, (layer) => ({
        ...layer,
        blendMode: mode,
      })),
    })),

  resetLayer: (id) =>
    set((state) => ({
      recipe: mapLayer(state.recipe, id, (layer) => ({
        ...layer,
        opacity: 1,
        blendMode: 'normal',
        params: effectDefaults(layer.type),
      })),
    })),

  setComparing: (comparing) => set({ comparing }),
}))

export const DEFAULT_SIZE = SIZE_PRESETS[1]
