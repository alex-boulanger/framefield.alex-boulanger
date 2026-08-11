import { fromPerceptual, luma, toPerceptual } from './buffer'
import type { PixelBuffer } from './buffer'
import { isFullRange } from './types'
import type { BlendMode, ToneMask } from './types'

/**
 * Layer compositing.
 *
 * Effects are destructive passes, but each pass result is blended back over the
 * buffer it received at the layer's opacity and blend mode. That is what makes
 * `opacity: 0.9` on a dither layer mean "90% dithered" rather than "90% opaque
 * over nothing".
 *
 * Two different colour spaces, on purpose:
 *
 * - The **mode** is evaluated in perceptual space. Blend modes are a borrowed
 *   vocabulary with borrowed expectations — `multiply` computed on linear
 *   values lands much darker than the same control does anywhere else.
 * - The **opacity mix** is a straight lerp in linear light, because a partial
 *   layer is physically a crossfade between two images, and that is exactly
 *   the operation linear light exists for.
 */

type Channel = (base: number, blend: number) => number

/** Operates on perceptual 0..1. */
const CHANNEL_OPS: Record<BlendMode, Channel> = {
  normal: (_base, blend) => blend,
  multiply: (base, blend) => base * blend,
  screen: (base, blend) => 1 - (1 - base) * (1 - blend),
  overlay: (base, blend) =>
    base < 0.5 ? 2 * base * blend : 1 - 2 * (1 - base) * (1 - blend),
  difference: (base, blend) => Math.abs(base - blend),
}

/**
 * How much of the frame `top` claims.
 *
 * - `full` — an effect's output. It was derived from `base`, so it covers
 *   exactly what `base` covered and its alpha is the layer's own business.
 * - `alpha` — a source layer's pixels. Coverage is per-pixel, so the layer
 *   applies in proportion to it: this is what stops an image that fills half
 *   the canvas from erasing the other half.
 *
 * Getting this wrong is silent and total. The `full` fast path below is a
 * straight `set`, so treating a half-transparent source as `full` replaces the
 * accumulator with holes rather than compositing into it.
 */
export type Coverage = 'full' | 'alpha'

/**
 * Blend `top` over `base`, in place on `base`.
 *
 * Both buffers must share dimensions; the caller owns that invariant since the
 * pipeline always renders `top` at the accumulator's size.
 *
 * The maths is the general source-over form collapsed for an opaque backdrop,
 * which the pipeline guarantees by starting from an opaque background: with
 * `baseAlpha == 1` the composite reduces to a lerp toward the blended colour
 * at `opacity * maskWeight * topAlpha`. Alpha is still tracked as a union so
 * the day a transparent ground is wanted, only the ground has to change.
 */
export function compositeInto(
  base: PixelBuffer,
  top: PixelBuffer,
  opacity: number,
  mode: BlendMode,
  mask?: ToneMask,
  coverage: Coverage = 'full',
): void {
  const alpha = Math.max(0, Math.min(1, opacity))
  if (alpha === 0) return

  const b = base.data
  const t = top.data
  const banded = mask !== undefined && !isFullRange(mask)

  // Fast path: a full-strength unmasked normal pass is just the effect output.
  // Only sound for `full` coverage — a source layer's holes must not be copied.
  if (alpha === 1 && mode === 'normal' && !banded && coverage === 'full') {
    b.set(t)
    return
  }

  const op = CHANNEL_OPS[mode]
  const plain = mode === 'normal'
  const byAlpha = coverage === 'alpha'

  for (let i = 0; i < b.length; i += 4) {
    // The band is measured on the *base* — what the layer was applied over —
    // so the mask selects by the tone the user can see beneath it.
    const weight = banded ? maskWeight(mask, luma(base, i)) : 1
    if (weight <= 0) continue
    const strength = byAlpha ? alpha * weight * t[i + 3] : alpha * weight
    if (strength <= 0) continue

    for (let c = 0; c < 3; c++) {
      // `normal` needs no round trip — the op is the identity on `top`.
      const blended = plain
        ? t[i + c]
        : fromPerceptual(op(toPerceptual(b[i + c]), toPerceptual(t[i + c])))
      // Assign rather than lerp at full strength: `x + (y - x) * 1` is not
      // guaranteed to be exactly `y` in floating point, and a fully opaque
      // source layer must land on its own pixels bit for bit.
      b[i + c] =
        strength >= 1 ? blended : b[i + c] + (blended - b[i + c]) * strength
    }

    // A source layer adds coverage; an effect layer carries its input's.
    b[i + 3] = byAlpha
      ? b[i + 3] + (1 - b[i + 3]) * strength
      : b[i + 3] + (t[i + 3] - b[i + 3]) * strength
  }
}

/**
 * How much of the layer applies at this tone: 1 inside the band, 0 outside,
 * smoothstepped across `softness` at each edge.
 */
export function maskWeight(mask: ToneMask, tone: number): number {
  const { low, high, softness } = mask
  if (softness <= 0) return tone >= low && tone <= high ? 1 : 0

  const ramp = (edge: number, value: number) => {
    const t = Math.max(0, Math.min(1, value / edge))
    return t * t * (3 - 2 * t)
  }

  if (tone < low) return ramp(softness, tone - (low - softness))
  if (tone > high) return ramp(softness, high + softness - tone)
  return 1
}
