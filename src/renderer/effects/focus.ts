import { blur, cloneBuffer } from '../buffer'
import type { PixelBuffer } from '../buffer'
import { num, str } from '../params'
import type { ParamSpec } from '../params'
import type { Params, RenderEnv } from '../types'

/**
 * Blur and sharpen.
 *
 * `blur()` has been in the buffer module since the first milestone, used by the
 * generator and by bloom, but never exposed as a layer — so softening part of
 * an image was impossible despite the code being right there. Sharpen is the
 * same call with one subtraction: an unsharp mask is the original plus its own
 * difference from a blurred copy.
 *
 * Worth having as a layer rather than a generator param because it carries the
 * tone and shape masks, which is what makes "soften everything except the
 * centre" expressible.
 */

export const FOCUS_PARAMS: Array<ParamSpec> = [
  {
    kind: 'select',
    key: 'mode',
    label: 'Mode',
    default: 'blur',
    options: [
      { value: 'blur', label: 'Blur' },
      { value: 'sharpen', label: 'Sharpen' },
    ],
  },
  {
    kind: 'slider',
    key: 'radius',
    label: 'Radius',
    min: 1,
    max: 80,
    step: 1,
    default: 8,
    spatial: true,
    unit: 'px',
  },
  {
    kind: 'slider',
    key: 'amount',
    label: 'Amount',
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
  },
]

export function applyFocus(
  buffer: PixelBuffer,
  params: Params,
  env: RenderEnv,
): PixelBuffer {
  const amount = num(params, 'amount', 1)
  // Radius is authored in export pixels; below a pixel at the current scale
  // there is nothing to blur with.
  const sigma = num(params, 'radius', 8) * env.scale
  if (amount <= 0 || sigma < 0.5) return buffer

  if (str(params, 'mode', 'blur') === 'sharpen') {
    // Unsharp mask. The blurred copy is the low-frequency content; adding back
    // the difference amplifies everything the blur removed.
    const low = blur(cloneBuffer(buffer), sigma)
    const data = buffer.data
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const detail = data[i + c] - low.data[i + c]
        // Clamped at zero: linear light has no negative radiance, and letting
        // it go negative turns a hard edge into a black fringe.
        data[i + c] = Math.max(0, data[i + c] + detail * amount)
      }
    }
    return buffer
  }

  // A blur at `amount < 1` is a crossfade toward the blurred image, which is
  // how a partial blur behaves physically.
  if (amount >= 1) return blur(buffer, sigma)

  const sharp = cloneBuffer(buffer)
  blur(buffer, sigma)
  const data = buffer.data
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      data[i + c] =
        sharp.data[i + c] + (data[i + c] - sharp.data[i + c]) * amount
    }
  }
  return buffer
}
