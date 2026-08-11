import type { PixelBuffer } from '../buffer'
import { whiteNoise, seedToInt } from '../noise'
import { bool, num, str } from '../params'
import type { ParamSpec } from '../params'
import type { Params, RenderEnv } from '../types'

/**
 * Grain — film grain and paper texture, as a stackable layer.
 *
 * The generator has its own grain, and this is deliberately *not* the same
 * thing. Source grain is texture the quantizing effects then chew on: the
 * dither turns it into pattern. This one sits wherever you put it in the stack,
 * so it can land on top of a finished halftone as paper noise, or on an
 * imported photo that never went through the generator at all.
 *
 * Grain size is spatial, so a preview shows the same relative texture as the
 * export rather than a finer one.
 */

export const GRAIN_PARAMS: Array<ParamSpec> = [
  {
    kind: 'slider',
    key: 'amount',
    label: 'Amount',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.15,
  },
  {
    kind: 'slider',
    key: 'size',
    label: 'Size',
    min: 1,
    max: 12,
    step: 1,
    default: 1,
    spatial: true,
    unit: 'px',
  },
  {
    kind: 'select',
    key: 'mode',
    label: 'Mode',
    default: 'mono',
    options: [
      { value: 'mono', label: 'Mono' },
      { value: 'colour', label: 'Colour' },
    ],
  },
  {
    kind: 'select',
    key: 'blend',
    label: 'Blend',
    default: 'add',
    options: [
      { value: 'add', label: 'Add' },
      { value: 'multiply', label: 'Mult' },
    ],
  },
  {
    kind: 'slider',
    key: 'shadows',
    label: 'Shadow bias',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.3,
  },
  { kind: 'seed', key: 'seed', label: 'Seed', default: 'grain' },
  { kind: 'toggle', key: 'monochromeTint', label: 'Tint dark', default: false },
]

export function applyGrain(
  buffer: PixelBuffer,
  params: Params,
  env: RenderEnv,
): PixelBuffer {
  const { width, height, data } = buffer

  const amount = num(params, 'amount', 0.15)
  if (amount <= 0) return buffer

  const size = Math.max(1, num(params, 'size', 1))
  const colour = str(params, 'mode', 'mono') === 'colour'
  const multiply = str(params, 'blend', 'add') === 'multiply'
  const shadows = num(params, 'shadows', 0.3)
  const tintDark = bool(params, 'monochromeTint', false)
  const seed = seedToInt(str(params, 'seed', 'grain'))
  const scale = env.scale > 0 ? env.scale : 1

  for (let y = 0; y < height; y++) {
    const gy = Math.floor(y / scale / size)

    for (let x = 0; x < width; x++) {
      const gx = Math.floor(x / scale / size)
      const i = (y * width + x) * 4

      const luma =
        0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]

      /**
       * Real film grain is strongest in the midtones and falls away in both
       * the blacks and the blown highlights. `shadows` biases which end keeps
       * more of it; uniform noise across the whole range reads as digital
       * dirt rather than emulsion.
       */
      const midtone = 1 - Math.abs(luma - 0.5) * 2
      const weight = amount * (midtone * (1 - shadows) + (1 - luma) * shadows)

      for (let c = 0; c < 3; c++) {
        const noise = colour
          ? whiteNoise(gx, gy, seed + c * 7919)
          : whiteNoise(gx, gy, seed)

        if (multiply) {
          data[i + c] *= 1 + (noise - 0.5) * 2 * weight
        } else {
          data[i + c] += (noise - 0.5) * 2 * weight
        }
      }

      if (tintDark) {
        // Push grain slightly warm in the shadows, the way scanned film does.
        data[i] += weight * 0.15 * (1 - luma)
        data[i + 2] -= weight * 0.1 * (1 - luma)
      }

      data[i] = Math.max(0, Math.min(1, data[i]))
      data[i + 1] = Math.max(0, Math.min(1, data[i + 1]))
      data[i + 2] = Math.max(0, Math.min(1, data[i + 2]))
    }
  }

  return buffer
}
