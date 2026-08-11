import { fromPerceptual, toPerceptual } from './buffer'
import type { PixelBuffer } from './buffer'
import type { BlendMode } from './types'

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
 * Blend `top` over `base`, in place on `base`.
 *
 * Both buffers must share dimensions; the caller owns that invariant since the
 * pipeline always derives `top` from `base`.
 */
export function compositeInto(
  base: PixelBuffer,
  top: PixelBuffer,
  opacity: number,
  mode: BlendMode,
): void {
  const alpha = Math.max(0, Math.min(1, opacity))
  if (alpha === 0) return

  const b = base.data
  const t = top.data

  // Fast path: a full-strength normal pass is just the effect output.
  if (alpha === 1 && mode === 'normal') {
    b.set(t)
    return
  }

  const op = CHANNEL_OPS[mode]
  const plain = mode === 'normal'

  for (let i = 0; i < b.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      // `normal` needs no round trip — the op is the identity on `top`.
      const blended = plain
        ? t[i + c]
        : fromPerceptual(op(toPerceptual(b[i + c]), toPerceptual(t[i + c])))
      b[i + c] += (blended - b[i + c]) * alpha
    }
    b[i + 3] += (t[i + 3] - b[i + 3]) * alpha
  }
}
