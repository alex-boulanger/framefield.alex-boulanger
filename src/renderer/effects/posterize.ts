import { fromPerceptual, luma, srgbToLinear, toPerceptual } from '../buffer'
import type { PixelBuffer } from '../buffer'
import { hexToRgb } from '../palettes'
import { num, bool, list, str } from '../params'
import type { ParamSpec } from '../params'
import type { Params, RenderEnv } from '../types'

/**
 * Posterize / duotone — tone reduction plus palette mapping.
 *
 * Quantization happens in perceptual space. Linear light is right for mixing
 * light, but stepping it uniformly puts almost every band in the shadows and
 * leaves the highlights as one flat mass — the bands need to be evenly spaced
 * in *perceived* lightness to read as deliberate.
 */

export const POSTERIZE_PARAMS: Array<ParamSpec> = [
  {
    kind: 'select',
    key: 'mode',
    label: 'Mode',
    default: 'duotone',
    options: [
      { value: 'duotone', label: 'Palette' },
      { value: 'rgb', label: 'RGB' },
    ],
  },
  {
    kind: 'slider',
    key: 'levels',
    label: 'Levels',
    min: 2,
    max: 16,
    step: 1,
    default: 5,
  },
  {
    kind: 'slider',
    key: 'gamma',
    label: 'Gamma',
    min: 0.2,
    max: 3,
    step: 0.05,
    default: 1,
  },
  {
    kind: 'slider',
    key: 'contrast',
    label: 'Contrast',
    min: -1,
    max: 1,
    step: 0.01,
    default: 0,
  },
  { kind: 'toggle', key: 'invert', label: 'Invert', default: false },
  {
    kind: 'palette',
    key: 'palette',
    label: 'Palette',
    default: ['#050505', '#f5f5f5', '#0057ff'],
  },
]

/** Contrast around mid-grey, linear pivot. */
function applyContrast(value: number, amount: number): number {
  const factor = (1 + amount) ** 2
  return (value - 0.5) * factor + 0.5
}

export interface LinearStop {
  r: number
  g: number
  b: number
}

/** Palette stops interpolated perceptually, stored linear. */
export function rampAt(stops: Array<LinearStop>, t: number): LinearStop {
  if (stops.length === 0) return { r: 0, g: 0, b: 0 }
  if (stops.length === 1) return stops[0]

  const clamped = Math.max(0, Math.min(1, t))
  const scaled = clamped * (stops.length - 1)
  const index = Math.min(stops.length - 2, Math.floor(scaled))
  const frac = scaled - index
  const a = stops[index]
  const b = stops[index + 1]

  return {
    r: fromPerceptual(a.r + (b.r - a.r) * frac),
    g: fromPerceptual(a.g + (b.g - a.g) * frac),
    b: fromPerceptual(a.b + (b.b - a.b) * frac),
  }
}

export function applyPosterize(
  buffer: PixelBuffer,
  params: Params,
  _env: RenderEnv,
): PixelBuffer {
  const data = buffer.data
  const levels = Math.max(2, Math.round(num(params, 'levels', 5)))
  const gamma = Math.max(0.01, num(params, 'gamma', 1))
  const contrast = num(params, 'contrast', 0)
  const invert = bool(params, 'invert', false)
  const duotone = str(params, 'mode', 'duotone') === 'duotone'

  // Stops kept in perceptual units so interpolation matches the swatches.
  const stops = list(params, 'palette', ['#050505', '#f5f5f5', '#0057ff']).map(
    (hex) => {
      const { r, g, b } = hexToRgb(hex)
      return { r: r / 255, g: g / 255, b: b / 255 }
    },
  )

  const step = 1 / (levels - 1)

  for (let i = 0; i < data.length; i += 4) {
    if (duotone) {
      let tone = toPerceptual(luma(buffer, i))
      tone = applyContrast(tone, contrast)
      tone = Math.max(0, Math.min(1, tone)) ** (1 / gamma)
      if (invert) tone = 1 - tone

      // Quantize before the ramp lookup so bands land on flat colour.
      const color = rampAt(stops, Math.round(tone / step) * step)
      data[i] = color.r
      data[i + 1] = color.g
      data[i + 2] = color.b
    } else {
      for (let c = 0; c < 3; c++) {
        let value = toPerceptual(data[i + c])
        value = applyContrast(value, contrast)
        value = Math.max(0, Math.min(1, value)) ** (1 / gamma)
        if (invert) value = 1 - value
        data[i + c] = fromPerceptual(Math.round(value / step) * step)
      }
    }
  }

  return buffer
}

/** Exposed for tests: the exact linear value a palette hex becomes. */
export function hexToLinear(hex: string): LinearStop {
  const { r, g, b } = hexToRgb(hex)
  return {
    r: srgbToLinear(r / 255),
    g: srgbToLinear(g / 255),
    b: srgbToLinear(b / 255),
  }
}
