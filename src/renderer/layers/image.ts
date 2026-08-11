import { defaultParams, num, str } from '../params'
import type { ParamSpec } from '../params'
import type { Params, RenderEnv } from '../types'

/**
 * Placement for an imported bitmap.
 *
 * Expressed as a *fit baseline* plus an offset and a multiplier rather than as
 * absolute pixel coordinates. Two reasons, both about the pixels not being
 * there:
 *
 * 1. Migration. A v1 recipe's implicit cover-fit can only be written as
 *    absolute coordinates if the bitmap's intrinsic size is known, and the
 *    recipe being migrated may never have had an image attached.
 * 2. Sharing. A recipe whose image is missing still has to describe a
 *    composition, and `cover + no offset` survives being reunited with a
 *    differently-sized file.
 *
 * `x` and `y` are export-space pixels, so the placement is identical at every
 * preview scale (`scaledOffset` applies the scale at render time).
 */
export const IMAGE_PARAMS: Array<ParamSpec> = [
  {
    kind: 'select',
    key: 'fit',
    label: 'Fit',
    default: 'cover',
    options: [
      { value: 'cover', label: 'Cover' },
      { value: 'contain', label: 'Contain' },
      { value: 'actual', label: 'Actual size' },
    ],
  },
  {
    kind: 'slider',
    key: 'scale',
    label: 'Scale',
    min: 0.05,
    max: 4,
    step: 0.01,
    default: 1,
  },
  {
    kind: 'slider',
    key: 'x',
    label: 'Offset X',
    min: -4096,
    max: 4096,
    step: 1,
    default: 0,
    spatial: true,
    unit: 'px',
  },
  {
    kind: 'slider',
    key: 'y',
    label: 'Offset Y',
    min: -4096,
    max: 4096,
    step: 1,
    default: 0,
    spatial: true,
    unit: 'px',
  },
]

export const IMAGE_DEFAULTS = () => defaultParams(IMAGE_PARAMS)

export interface Placement {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Where the bitmap lands in the current render space.
 *
 * Everything is derived from `env`, never from the canvas element, so a
 * half-scale preview places the image at exactly half the coordinates — the
 * same fidelity contract the effects follow via `scaled()`.
 */
export function placeImage(
  params: Params,
  bitmapWidth: number,
  bitmapHeight: number,
  env: RenderEnv,
): Placement {
  const fit = str(params, 'fit', 'cover')
  const zoom = Math.max(0.01, num(params, 'scale', 1))

  const cover = Math.max(env.width / bitmapWidth, env.height / bitmapHeight)
  const contain = Math.min(env.width / bitmapWidth, env.height / bitmapHeight)
  const base =
    fit === 'contain' ? contain : fit === 'actual' ? env.scale : cover

  const width = bitmapWidth * base * zoom
  const height = bitmapHeight * base * zoom

  return {
    // Centred, then nudged by the authored offset.
    x: (env.width - width) / 2 + num(params, 'x', 0) * env.scale,
    y: (env.height - height) / 2 + num(params, 'y', 0) * env.scale,
    width,
    height,
  }
}
