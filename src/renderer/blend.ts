import { fromPerceptual, luma, toPerceptual } from './buffer'
import type { PixelBuffer } from './buffer'
import { isFullRange, isShapeless } from './types'
import type { BlendMode, ShapeMask, ToneMask } from './types'

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
  shape?: ShapeMask,
): void {
  const alpha = Math.max(0, Math.min(1, opacity))
  if (alpha === 0) return

  const b = base.data
  const t = top.data
  const banded = mask !== undefined && !isFullRange(mask)
  const shaped = shape !== undefined && !isShapeless(shape)

  // Fast path: a full-strength unmasked normal pass is just the effect output.
  // Only sound for `full` coverage — a source layer's holes must not be copied.
  if (
    alpha === 1 &&
    mode === 'normal' &&
    !banded &&
    !shaped &&
    coverage === 'full'
  ) {
    b.set(t)
    return
  }

  const op = CHANNEL_OPS[mode]
  const plain = mode === 'normal'
  const byAlpha = coverage === 'alpha'
  const width = base.width
  // One closure that answers "how much does this layer apply *here*", with the
  // field sampler and the band folded together so the pixel loop makes a single
  // call and TypeScript keeps the narrowing.
  const shapeWeightAt = shaped
    ? (
        (sample) => (x: number, y: number) =>
          maskWeight(shape, sample(x, y))
      )(shapeFieldSampler(shape, width, base.height))
    : null

  for (let i = 0; i < b.length; i += 4) {
    // The band is measured on the *base* — what the layer was applied over —
    // so the mask selects by the tone the user can see beneath it.
    let weight = banded ? maskWeight(mask, luma(base, i)) : 1
    if (weight > 0 && shapeWeightAt) {
      const pixel = i >> 2
      weight *= shapeWeightAt(pixel % width, (pixel / width) | 0)
    }
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
 * The 0..1 field a shape mask bands over, as a closure with the per-frame
 * constants hoisted out of the pixel loop.
 *
 * Both fields are normalized so that 0 and 1 are the extremes *of this frame*:
 * a linear field spans exactly the frame at any angle, and a radial one reaches
 * 1 at the farthest corner. Without that, `high: 1` would quietly exclude the
 * corners on a 4:5 canvas and a 45° gradient would clip.
 */
export function shapeFieldSampler(
  mask: ShapeMask,
  width: number,
  height: number,
): (x: number, y: number) => number {
  const aspect = width / height
  // Sampled at pixel *centres*, so the field is symmetric about the frame: with
  // `x / width` the first pixel sits exactly on 0 while the last falls short of
  // 1, and a band at 0.5 splits the frame one pixel off-centre.
  const u = (x: number) => (x + 0.5) / width
  const v = (y: number) => (y + 0.5) / height

  if (mask.shape === 'radial') {
    const cx = 0.5 + mask.centerX
    const cy = 0.5 + mask.centerY
    // Farthest corner from the centre, so the field always reaches 1.
    const maxRadius =
      Math.max(
        Math.hypot((0 - cx) * aspect, 0 - cy),
        Math.hypot((1 - cx) * aspect, 0 - cy),
        Math.hypot((0 - cx) * aspect, 1 - cy),
        Math.hypot((1 - cx) * aspect, 1 - cy),
      ) || 1

    return (x, y) => Math.hypot((u(x) - cx) * aspect, v(y) - cy) / maxRadius
  }

  const radians = (mask.angle * Math.PI) / 180
  const dx = Math.cos(radians)
  const dy = Math.sin(radians)
  // Half-extent of the projection across the frame, so the span is exactly 0..1
  // whatever the angle.
  const half = (Math.abs(dx) + Math.abs(dy)) / 2 || 1

  return (x, y) => 0.5 + ((u(x) - 0.5) * dx + (v(y) - 0.5) * dy) / (2 * half)
}

/**
 * How much of the layer applies at this tone: 1 inside the band, 0 outside,
 * smoothstepped across `softness` at each edge.
 *
 * Shared by both masks — the shape mask bands over a spatial field with exactly
 * this logic, which is why it takes a bare value rather than a tone.
 */
export function maskWeight(
  mask: Pick<ToneMask, 'low' | 'high' | 'softness'>,
  tone: number,
): number {
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
