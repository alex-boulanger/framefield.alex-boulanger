import { EFFECTS } from '#/renderer/effects'
import { FIELD_PARAMS } from '#/renderer/generators/field'
import { IMAGE_PARAMS } from '#/renderer/layers/image'
import { TEXT_PARAMS } from '#/renderer/layers/text'
import type { ParamSpec } from '#/renderer/params'
import type { Layer } from '#/renderer/types'

/**
 * What the UI needs to know about a layer that the layer itself does not say.
 *
 * Kept in one place so the stack rows, the inspector, and the add menu cannot
 * disagree about what a layer is called — and so adding a layer kind means
 * adding three cases here rather than hunting through components.
 */

/** The controls this layer exposes, in inspector order. */
export function layerSpecs(layer: Layer): Array<ParamSpec> {
  if (layer.kind === 'effect') return EFFECTS[layer.type].params
  if (layer.kind === 'image') return IMAGE_PARAMS
  if (layer.kind === 'text') return TEXT_PARAMS
  return FIELD_PARAMS
}

/**
 * What the layer *is*, ignoring any name the user gave it.
 *
 * Defined in the renderer rather than here because generated layer names are
 * built from it, and two copies of "what is this layer called" would drift.
 */
export { layerTypeLabel } from '#/renderer/recipe'

export function layerHint(layer: Layer): string {
  if (layer.kind === 'effect') return EFFECTS[layer.type].hint
  if (layer.kind === 'image') {
    return 'Imported pixels, placed in the frame. Layers above it treat it like any other source.'
  }
  if (layer.kind === 'text') {
    return 'Editable flat text, placed in the frame. Layers above it treat it like any other source.'
  }
  return 'A procedural field. Blend it with what is beneath, or let the stack above treat it.'
}
