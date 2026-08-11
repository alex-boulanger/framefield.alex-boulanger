import { blur, createBuffer } from '../buffer'
import type { PixelBuffer } from '../buffer'
import { hexToRgb } from '../palettes'
import { list, num, str } from '../params'
import type { ParamSpec } from '../params'
import type { Params, RenderEnv } from '../types'

/**
 * Bloom — bleed the highlights.
 *
 * Threshold what is bright, blur it, add it back. The whole effect is three
 * lines of maths; what makes it correct here is that it happens in **linear
 * light**, which is where light actually adds. Bloom computed on sRGB values
 * halos grey instead of glowing, and the falloff comes out wrong in a way that
 * reads as a smudge rather than as light.
 *
 * This is also the cheapest way to make a hard-quantized image look printed
 * rather than plotted: a dithered edge with a little bleed around it reads as
 * ink on paper.
 */

export const BLOOM_PARAMS: Array<ParamSpec> = [
  {
    kind: 'slider',
    key: 'threshold',
    label: 'Threshold',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.6,
  },
  {
    kind: 'slider',
    key: 'amount',
    label: 'Amount',
    min: 0,
    max: 3,
    step: 0.05,
    default: 0.8,
  },
  {
    kind: 'slider',
    key: 'radius',
    label: 'Radius',
    min: 1,
    max: 120,
    step: 1,
    default: 24,
    spatial: true,
    unit: 'px',
  },
  {
    kind: 'slider',
    key: 'knee',
    label: 'Knee',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.4,
  },
  {
    kind: 'select',
    key: 'mode',
    label: 'Mode',
    default: 'add',
    options: [
      { value: 'add', label: 'Add' },
      { value: 'screen', label: 'Screen' },
    ],
  },
  {
    kind: 'palette',
    key: 'palette',
    label: 'Tint',
    default: ['#ffffff'],
  },
  {
    kind: 'slider',
    key: 'tint',
    label: 'Tint amount',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0,
  },
]

export function applyBloom(
  buffer: PixelBuffer,
  params: Params,
  env: RenderEnv,
): PixelBuffer {
  const { width, height, data } = buffer

  const threshold = num(params, 'threshold', 0.6)
  const amount = num(params, 'amount', 0.8)
  if (amount <= 0) return buffer

  const radius = num(params, 'radius', 24) * env.scale
  const knee = num(params, 'knee', 0.4)
  const screen = str(params, 'mode', 'add') === 'screen'
  const tintAmount = num(params, 'tint', 0)
  const tintHex = list(params, 'palette', ['#ffffff'])[0]
  const tintRgb = hexToRgb(tintHex)

  // Extract: keep only what is above the threshold, with a soft knee so the
  // bloom fades in rather than switching on at a hard tonal edge.
  const bright = createBuffer(width, height)
  const source = bright.data

  for (let i = 0; i < data.length; i += 4) {
    const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]

    let weight: number
    if (knee <= 0) {
      weight = luma > threshold ? 1 : 0
    } else {
      weight = Math.max(0, Math.min(1, (luma - threshold) / knee))
      weight = weight * weight * (3 - 2 * weight)
    }

    source[i] = data[i] * weight
    source[i + 1] = data[i + 1] * weight
    source[i + 2] = data[i + 2] * weight
    source[i + 3] = 1
  }

  blur(bright, radius)

  const tr = tintRgb.r / 255
  const tg = tintRgb.g / 255
  const tb = tintRgb.b / 255

  for (let i = 0; i < data.length; i += 4) {
    let br = source[i] * amount
    let bg = source[i + 1] * amount
    let bb = source[i + 2] * amount

    if (tintAmount > 0) {
      // Tint by pushing the bloom toward a hue while keeping its brightness,
      // so the glow can be a different colour from what is glowing.
      const level = 0.2126 * br + 0.7152 * bg + 0.0722 * bb
      br += (level * tr - br) * tintAmount
      bg += (level * tg - bg) * tintAmount
      bb += (level * tb - bb) * tintAmount
    }

    if (screen) {
      data[i] = 1 - (1 - data[i]) * (1 - Math.min(1, br))
      data[i + 1] = 1 - (1 - data[i + 1]) * (1 - Math.min(1, bg))
      data[i + 2] = 1 - (1 - data[i + 2]) * (1 - Math.min(1, bb))
    } else {
      data[i] += br
      data[i + 1] += bg
      data[i + 2] += bb
    }

    data[i] = Math.min(1, data[i])
    data[i + 1] = Math.min(1, data[i + 1])
    data[i + 2] = Math.min(1, data[i + 2])
  }

  return buffer
}
