import { sampleChannel } from '../buffer'
import type { PixelBuffer } from '../buffer'
import { buildFlowField, fbm, sampleFlowField, seedToInt } from '../noise'
import { bool, num, str } from '../params'
import type { ParamSpec } from '../params'
import type { Params, RenderEnv } from '../types'

/**
 * Displace — push pixels around by a field.
 *
 * Nothing else in the stack moves geometry. Every other effect recolours or
 * requantizes in place, so shapes survive untouched; this melts and smears
 * them, which is a category of damage the rest cannot reach.
 *
 * Sampled bilinearly rather than nearest: a displacement field is smooth and
 * fractional, and point-sampling it turns a melt into a staircase.
 */

export const DISPLACE_PARAMS: Array<ParamSpec> = [
  {
    kind: 'select',
    key: 'field',
    label: 'Field',
    default: 'noise',
    options: [
      { value: 'noise', label: 'Noise' },
      { value: 'flow', label: 'Flow' },
      { value: 'radial', label: 'Radial' },
    ],
  },
  {
    kind: 'slider',
    key: 'amount',
    label: 'Amount',
    min: 0,
    max: 200,
    step: 1,
    default: 40,
    spatial: true,
    unit: 'px',
  },
  {
    kind: 'slider',
    key: 'scale',
    label: 'Scale',
    min: 0.3,
    max: 12,
    step: 0.1,
    default: 2.2,
  },
  {
    kind: 'slider',
    key: 'octaves',
    label: 'Octaves',
    min: 1,
    max: 6,
    step: 1,
    default: 3,
  },
  {
    kind: 'slider',
    key: 'channels',
    label: 'Chroma split',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0,
  },
  { kind: 'seed', key: 'seed', label: 'Seed', default: 'melt' },
  { kind: 'toggle', key: 'wrap', label: 'Wrap edges', default: false },
]

export function applyDisplace(
  buffer: PixelBuffer,
  params: Params,
  env: RenderEnv,
): PixelBuffer {
  const { width, height, data } = buffer

  const amount = num(params, 'amount', 40) * env.scale
  if (amount === 0) return buffer

  const kind = str(params, 'field', 'noise')
  const scale = num(params, 'scale', 2.2)
  const octaves = Math.round(num(params, 'octaves', 3))
  const split = num(params, 'channels', 0)
  const wrap = bool(params, 'wrap', false)
  const seed = seedToInt(str(params, 'seed', 'melt'))

  const source = new Float32Array(data)
  const short = Math.min(width, height)
  const fbmOptions = { octaves }

  // Baked for the flow variant, same reason as the generator: evaluating curl
  // per pixel is four fbm calls, and the field is smooth enough to interpolate.
  const flowField =
    kind === 'flow'
      ? buildFlowField(
          Math.max(32, Math.round(160 * (width / short))),
          160,
          width / short,
          height / short,
          seed,
          scale,
          fbmOptions,
        )
      : null

  for (let y = 0; y < height; y++) {
    const v = y / short

    for (let x = 0; x < width; x++) {
      const u = x / short

      let dx: number
      let dy: number

      switch (kind) {
        case 'flow': {
          const [fx, fy] = sampleFlowField(flowField!, u, v)
          dx = fx
          dy = fy
          break
        }
        case 'radial': {
          // Push outward from the centre, modulated by noise so the ring is
          // not a perfect circle.
          const cx = x - width / 2
          const cy = y - height / 2
          const length = Math.hypot(cx, cy) || 1
          const wobble = fbm(u * scale, v * scale, seed, fbmOptions) * 0.5 + 0.5
          dx = (cx / length) * wobble
          dy = (cy / length) * wobble
          break
        }
        default: {
          // Two decorrelated fbm lookups give an unbiased 2D offset; one field
          // reused for both axes would displace everything diagonally.
          dx = fbm(u * scale, v * scale, seed, fbmOptions)
          dy = fbm(u * scale + 3.7, v * scale + 8.1, seed + 4211, fbmOptions)
          break
        }
      }

      const i = (y * width + x) * 4

      if (split > 0) {
        // Displace each channel by a slightly different distance: the same
        // misregistration a physical process produces, but following the
        // displacement rather than a fixed offset.
        for (let c = 0; c < 3; c++) {
          const factor = 1 + (c - 1) * split * 0.5
          data[i + c] = sampleChannel(
            source,
            width,
            height,
            x + dx * amount * factor,
            y + dy * amount * factor,
            c,
            wrap,
          )
        }
      } else {
        const sx = x + dx * amount
        const sy = y + dy * amount
        data[i] = sampleChannel(source, width, height, sx, sy, 0, wrap)
        data[i + 1] = sampleChannel(source, width, height, sx, sy, 1, wrap)
        data[i + 2] = sampleChannel(source, width, height, sx, sy, 2, wrap)
      }
    }
  }

  return buffer
}
