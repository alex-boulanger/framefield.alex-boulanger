import type { PixelBuffer } from '../buffer'
import { createRng } from '../rng'
import { num, str } from '../params'
import type { ParamSpec } from '../params'
import type { Params, RenderEnv } from '../types'
import { scaled, scaledOffset } from '../types'

/**
 * Channel drift — RGB misregistration with row jitter and scanlines.
 *
 * A pure index remap: it moves samples around without touching their values, so
 * it is colour-space agnostic and correct on linear data unchanged.
 *
 * Offsets are authored in export pixels and scaled, so a 40px red shift stays
 * visually a 40px shift in the preview. Row jitter is seeded, which keeps the
 * glitch reproducible instead of shimmering on every re-render.
 */

export const CHANNEL_DRIFT_PARAMS: Array<ParamSpec> = [
  {
    kind: 'slider',
    key: 'redX',
    label: 'Red X',
    min: -80,
    max: 80,
    step: 1,
    default: 12,
    spatial: true,
    unit: 'px',
  },
  {
    kind: 'slider',
    key: 'redY',
    label: 'Red Y',
    min: -80,
    max: 80,
    step: 1,
    default: 0,
    spatial: true,
    unit: 'px',
  },
  {
    kind: 'slider',
    key: 'blueX',
    label: 'Blue X',
    min: -80,
    max: 80,
    step: 1,
    default: -12,
    spatial: true,
    unit: 'px',
  },
  {
    kind: 'slider',
    key: 'blueY',
    label: 'Blue Y',
    min: -80,
    max: 80,
    step: 1,
    default: 0,
    spatial: true,
    unit: 'px',
  },
  {
    kind: 'slider',
    key: 'jitter',
    label: 'Jitter',
    min: 0,
    max: 60,
    step: 1,
    default: 0,
    spatial: true,
    unit: 'px',
  },
  {
    kind: 'slider',
    key: 'jitterBands',
    label: 'Bands',
    min: 1,
    max: 120,
    step: 1,
    default: 24,
  },
  {
    kind: 'slider',
    key: 'scanlines',
    label: 'Scanlines',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0,
  },
  {
    kind: 'slider',
    key: 'scanlineSize',
    label: 'Scan size',
    min: 1,
    max: 24,
    step: 1,
    default: 3,
    spatial: true,
    unit: 'px',
  },
  { kind: 'seed', key: 'seed', label: 'Seed', default: 'drift' },
]

/** Clamped sample of one channel — edges smear rather than wrap. */
function sample(
  source: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  channel: number,
): number {
  const cx = x < 0 ? 0 : x >= width ? width - 1 : x
  const cy = y < 0 ? 0 : y >= height ? height - 1 : y
  return source[(cy * width + cx) * 4 + channel]
}

export function applyChannelDrift(
  buffer: PixelBuffer,
  params: Params,
  env: RenderEnv,
): PixelBuffer {
  const { width, height, data } = buffer
  const source = new Float32Array(data)

  // Offsets are signed — `scaledOffset`, not `scaled`, or negatives vanish.
  const redX = scaledOffset(num(params, 'redX', 12), env)
  const redY = scaledOffset(num(params, 'redY', 0), env)
  const blueX = scaledOffset(num(params, 'blueX', -12), env)
  const blueY = scaledOffset(num(params, 'blueY', 0), env)
  const jitter = scaled(num(params, 'jitter', 0), env, 0)
  const bands = Math.max(1, Math.round(num(params, 'jitterBands', 24)))
  const scanlines = num(params, 'scanlines', 0)
  const scanSize = scaled(num(params, 'scanlineSize', 3), env)
  const seed = str(params, 'seed', 'drift')

  // One offset per band rather than per row: bands read as deliberate tearing,
  // per-row noise just reads as static.
  const rng = createRng(`${seed}:bands`)
  const bandOffsets = new Int32Array(bands)
  for (let i = 0; i < bands; i++) {
    bandOffsets[i] = Math.round(rng.range(-1, 1) * jitter)
  }

  for (let y = 0; y < height; y++) {
    const band = Math.min(bands - 1, Math.floor((y / height) * bands))
    const rowShift = jitter > 0 ? bandOffsets[band] : 0

    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      data[i] = sample(source, width, height, x + redX + rowShift, y + redY, 0)
      data[i + 1] = sample(source, width, height, x + rowShift, y, 1)
      data[i + 2] = sample(
        source,
        width,
        height,
        x + blueX + rowShift,
        y + blueY,
        2,
      )
    }
  }

  if (scanlines > 0) {
    const factor = 1 - scanlines
    for (let y = 0; y < height; y++) {
      // Darken every other band of `scanSize` rows.
      if (Math.floor(y / scanSize) % 2 !== 0) continue
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        data[i] *= factor
        data[i + 1] *= factor
        data[i + 2] *= factor
      }
    }
  }

  return buffer
}
