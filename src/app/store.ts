import { create } from 'zustand'
import {
  createBlankRecipe,
  createDefaultRecipe,
  createEffectLayer,
  createGeneratorLayer,
  createImageLayer,
  createTextLayer,
  baseLayerName,
  createLayerId,
  layerDefaults,
  layerTypeLabel,
  uniqueLayerName,
  withGeneratedNames,
  remixRecipe,
  randomizeFxStack,
  SIZE_PRESETS,
} from '#/renderer/recipe'
import { randomizeField } from '#/renderer/generators/field'
import { randomSeed } from '#/renderer/rng'
import { NO_MASK, NO_SHAPE, isSourceLayer } from '#/renderer/types'
import type {
  BlendMode,
  EffectType,
  Layer,
  ParamValue,
  Recipe,
  ShapeMask,
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

/**
 * The param edit the last history entry was opened for.
 *
 * Only `setLayerParam` writes it, and every other action clears it, so a run of
 * edits is only ever collapsed while nothing else has happened in between.
 */
interface EditMark {
  id: string
  key: string
  at: number
}

export interface LabState {
  recipe: Recipe
  past: Array<Recipe>
  future: Array<Recipe>
  selectedLayerId: string | null
  /** Internal history bookkeeping — see `COALESCE_MS`. */
  lastEdit: EditMark | null

  /**
   * Bypass the effect stack and show the sources alone.
   *
   * View state, not document state: it never enters the recipe, the URL, or
   * history, because "what am I looking at right now" is not part of the
   * artwork. Held rather than toggled, so it cannot be left on by accident.
   */
  comparing: boolean
  /**
   * Render one layer's contribution alone. See `soloedRecipe` for what that
   * means for each layer kind. Also view state, for the same reason.
   */
  soloLayerId: string | null
  /**
   * Hold the current colourway across a remix.
   *
   * UI state rather than part of the recipe, unlike a layer lock: it describes
   * how the *next* reroll should behave, not anything about the artwork.
   */
  paletteLocked: boolean
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
  /** Clear the stack and start over, keeping the chosen canvas size. */
  newArtwork: () => void

  addEffectLayer: (type: EffectType) => void
  addGeneratorLayer: () => void
  addImageLayer: (url: string, name: string) => void
  addTextLayer: () => void
  removeLayer: (id: string) => void
  duplicateLayer: (id: string) => void
  toggleLayer: (id: string) => void
  selectLayer: (id: string | null) => void
  moveLayerTo: (id: string, targetIndex: number) => void
  setLayerParam: (id: string, key: string, value: ParamValue) => void
  setLayerOpacity: (id: string, opacity: number) => void
  setLayerBlendMode: (id: string, mode: BlendMode) => void
  setLayerMask: (id: string, mask: Partial<ToneMask>) => void
  setLayerShape: (id: string, shape: Partial<ShapeMask>) => void
  setLayerName: (id: string, name: string) => void
  resetLayer: (id: string) => void
  /** Reroll a generator layer's seed, keeping its parameters. */
  reseedLayer: (id: string) => void
  /** Reroll a generator layer's parameters, keeping the stack's palette. */
  randomizeLayer: (id: string) => void

  setComparing: (comparing: boolean) => void
  toggleSolo: (id: string | null) => void
  toggleLayerLock: (id: string) => void
  togglePaletteLock: () => void
}

const initialRecipe = createDefaultRecipe()
const HISTORY_LIMIT = 80

/**
 * How long a run of edits to one param stays open as a single history entry.
 *
 * A range input fires on every `input` event, so dragging one 0..1 slider at
 * `step: 0.01` emits up to a hundred `setLayerParam` calls. Committing each one
 * made undo step back a hundredth of a slider at a time and — because the
 * history is capped at 80 — let a single drag evict every entry before it. The
 * state the user actually wanted to return to was the first casualty.
 *
 * A time window rather than a pointer-up commit: it lives entirely in the store,
 * so it covers keyboard-driven slider changes and any future control that emits
 * continuously, instead of having to be reimplemented in each one.
 */
const COALESCE_MS = 500

function pushHistory(
  state: LabState,
): Pick<LabState, 'past' | 'future' | 'lastEdit'> {
  return {
    past: [...state.past, state.recipe].slice(-HISTORY_LIMIT),
    future: [],
    // Any action that opens a history entry also ends the open edit run, so a
    // drag followed by anything else is a clean boundary.
    lastEdit: null,
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
 * Two limits, both learned the hard way. A second *generator* never follows: it
 * is a compositional choice with its own colourway, and recolouring one field
 * must not silently repaint the other. And only layers that still match the
 * *old* palette follow, so a layer the user deliberately set stays set.
 * Without any of this, a preset loses its colour scheme the moment the field is
 * recoloured.
 *
 * Text layers follow alongside the effects, which is the whole reason their
 * colours are palette indices rather than swatches: a headline is part of the
 * artwork's colourway, not a label sitting on top of it, so recolouring the
 * picture has to recolour the words.
 */
function syncInheritedLayerPalettes(
  layers: Array<Layer>,
  previousPalette: unknown,
  nextPalette: unknown,
): Array<Layer> {
  if (!Array.isArray(nextPalette)) return layers

  return layers.map((layer) =>
    layer.kind !== 'generator' &&
    samePalette(layer.params.palette, previousPalette)
      ? {
          ...layer,
          params: { ...layer.params, palette: [...nextPalette] },
        }
      : layer,
  )
}

/**
 * Add to the top of the stack and select it, whatever the layer renders.
 *
 * The new layer is named here rather than in `create*Layer`, because a unique
 * name needs to know what is already in the stack — and only the store does.
 */
function appendLayer(state: LabState, layer: Layer) {
  const layers = withGeneratedNames([...state.recipe.layers, layer])
  return {
    ...pushHistory(state),
    recipe: { ...state.recipe, layers },
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
  lastEdit: null,
  comparing: false,
  soloLayerId: null,
  paletteLocked: false,

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
      lastEdit: null,
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
        // Without this, undoing mid-drag and then resuming the same slider
        // would fold the resumed edits into the entry undo just stepped off.
        lastEdit: null,
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
        lastEdit: null,
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
      const recipe = remixRecipe(state.recipe, {
        lockPalette: state.paletteLocked,
      })
      return {
        ...pushHistory(state),
        recipe,
        selectedLayerId: recipe.layers[0]?.id ?? null,
      }
    }),

  /**
   * Goes through history rather than `hydrateRecipe`, so clearing the stack is
   * one undo away. That is the whole reason this is safe to put next to Remix
   * without a confirmation dialog.
   */
  newArtwork: () =>
    set((state) => {
      const recipe = createBlankRecipe(state.recipe.canvas)
      return { ...pushHistory(state), recipe, selectedLayerId: null }
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

  addTextLayer: () => set((state) => appendLayer(state, createTextLayer())),

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
        // Numbered off the *source* name, not the type, so duplicating
        // "Ink pass" gives "Ink pass 2" rather than "Dither 4" — and off its
        // base, so duplicating "Dither 2" gives "Dither 3" rather than
        // "Dither 2 2".
        name: uniqueLayerName(
          baseLayerName(source.name ?? layerTypeLabel(source)),
          state.recipe.layers.flatMap((entry) =>
            entry.name ? [entry.name] : [],
          ),
        ),
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

  selectLayer: (id) => set({ selectedLayerId: id, lastEdit: null }),

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

      /**
       * Continue the open entry rather than opening a new one when this is the
       * same param still being dragged. `past` is left exactly as it was, so
       * the entry pushed by the first tick of the drag is the one undo returns
       * to — the state from before the drag started.
       */
      const now = Date.now()
      const continues =
        state.lastEdit !== null &&
        state.lastEdit.id === id &&
        state.lastEdit.key === key &&
        now - state.lastEdit.at < COALESCE_MS

      const history = continues
        ? { past: state.past, future: state.future }
        : {
            past: [...state.past, state.recipe].slice(-HISTORY_LIMIT),
            future: [],
          }

      return {
        ...history,
        lastEdit: { id, key, at: now },
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

  setLayerShape: (id, shape) =>
    set((state) => ({
      ...pushHistory(state),
      recipe: mapLayer(state.recipe, id, (layer) => {
        const next = { ...layer.shape, ...shape }
        // Same ordering guard the tone mask uses, so the two band handles can
        // cross mid-drag without the layer blinking out.
        return {
          ...layer,
          shape: {
            ...next,
            low: Math.min(next.low, next.high),
            high: Math.max(next.low, next.high),
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
        shape: { ...NO_SHAPE },
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

  setComparing: (comparing) => set({ comparing }),

  toggleSolo: (id) =>
    set((state) => ({ soloLayerId: state.soloLayerId === id ? null : id })),

  toggleLayerLock: (id) =>
    set((state) => ({
      ...pushHistory(state),
      recipe: mapLayer(state.recipe, id, (layer) => ({
        ...layer,
        // Cleared to `undefined` rather than `false` so an unlocked layer
        // serializes identically to one from before locks existed, and share
        // URLs do not grow a `"locked":false` on every single layer.
        locked: layer.locked ? undefined : true,
      })),
    })),

  togglePaletteLock: () =>
    set((state) => ({ paletteLocked: !state.paletteLocked })),
}))

/**
 * The recipe as the viewport should currently draw it.
 *
 * Compare and solo are *views*, so they are applied here rather than by
 * mutating the document — which keeps them out of history and out of the share
 * URL, and means the export always renders the real stack no matter what the
 * screen is showing.
 *
 * Solo means different things by kind, because "this layer alone" is only
 * meaningful for something that makes its own pixels:
 *
 * - a **source** layer soloes to itself, with nothing above or beside it;
 * - an **effect** layer soloes to every source plus that one effect, since an
 *   effect with no input is a black frame and answers no question the user was
 *   asking.
 *
 * Compare wins over solo when both are active: it is held, so it reads as a
 * momentary "show me the untouched picture" over whatever else is set.
 */
export function viewRecipe(
  recipe: Recipe,
  { comparing, soloLayerId }: Pick<LabState, 'comparing' | 'soloLayerId'>,
): Recipe {
  if (comparing) {
    return { ...recipe, layers: recipe.layers.filter(isSourceLayer) }
  }

  if (soloLayerId === null) return recipe
  const soloed = recipe.layers.find((layer) => layer.id === soloLayerId)
  if (!soloed) return recipe

  if (isSourceLayer(soloed)) {
    return { ...recipe, layers: [soloed] }
  }

  return {
    ...recipe,
    layers: recipe.layers.filter(
      (layer) => isSourceLayer(layer) || layer.id === soloLayerId,
    ),
  }
}

export const DEFAULT_SIZE = SIZE_PRESETS[1]
