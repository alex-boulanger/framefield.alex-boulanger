import { luma, toPerceptual } from '../buffer'
import type { PixelBuffer } from '../buffer'
import { hexToRgb } from '../palettes'
import { bool, list, num } from '../params'
import type { ParamSpec } from '../params'
import type { Params, RenderEnv } from '../types'
import { rampAt } from './posterize'

/**
 * Gradient map — recolour by tone, without quantizing.
 *
 * Posterize can already map onto a palette, but only through a quantizer, and
 * its `levels` stops at 16. There was no way to say "recolour this smoothly",
 * which is the single most common thing a palette is for. Same ramp code as
 * posterize, minus the step.
 */

export const GRADIENT_MAP_PARAMS: Array<ParamSpec> = [
  {
    kind: 'slider',
    key: 'amount',
    label: 'Amount',
    min: 0,
    max: 1,
    step: 0.01,
    default: 1,
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

export function applyGradientMap(
  buffer: PixelBuffer,
  params: Params,
  _env: RenderEnv,
): PixelBuffer {
  const data = buffer.data
  const amount = Math.max(0, Math.min(1, num(params, 'amount', 1)))
  if (amount === 0) return buffer

  const gamma = Math.max(0.01, num(params, 'gamma', 1))
  const contrast = num(params, 'contrast', 0)
  const invert = bool(params, 'invert', false)
  const factor = (1 + contrast) ** 2

  const stops = list(params, 'palette', ['#050505', '#f5f5f5', '#0057ff']).map(
    (hex) => {
      const { r, g, b } = hexToRgb(hex)
      return { r: r / 255, g: g / 255, b: b / 255 }
    },
  )

  for (let i = 0; i < data.length; i += 4) {
    // Tone read perceptually, because the ramp's stops are authored that way
    // and a linear read would push every mid-tone toward the dark stop.
    let tone = toPerceptual(luma(buffer, i))
    tone = (tone - 0.5) * factor + 0.5
    tone = Math.max(0, Math.min(1, tone)) ** (1 / gamma)
    if (invert) tone = 1 - tone

    const color = rampAt(stops, tone)
    if (amount >= 1) {
      data[i] = color.r
      data[i + 1] = color.g
      data[i + 2] = color.b
    } else {
      // Crossfade in linear light — a partial recolour is a mix of two images.
      data[i] += (color.r - data[i]) * amount
      data[i + 1] += (color.g - data[i + 1]) * amount
      data[i + 2] += (color.b - data[i + 2]) * amount
    }
  }

  return buffer
}
