import { fromPerceptual, toPerceptual } from '../buffer'
import type { PixelBuffer } from '../buffer'
import { bool, num, str } from '../params'
import type { ParamSpec } from '../params'
import type { Params, RenderEnv } from '../types'

/**
 * Levels — the tone curve everything downstream reads.
 *
 * Every quantizing effect here (dither, halftone, ASCII, posterize) maps from
 * luma, so where the tones sit decides how well those effects read. Without a
 * curve the only recourse is the generator's own contrast slider, which does
 * nothing for an imported photo. This is the one effect whose job is to make
 * the *other* effects work.
 *
 * Operates in perceptual space: black point, white point and gamma are all
 * controls people know from image editors, and those all assume perceived
 * lightness rather than linear light.
 */

export const LEVELS_PARAMS: Array<ParamSpec> = [
  {
    kind: 'slider',
    key: 'black',
    label: 'Black point',
    min: 0,
    max: 0.9,
    step: 0.01,
    default: 0,
  },
  {
    kind: 'slider',
    key: 'white',
    label: 'White point',
    min: 0.1,
    max: 1,
    step: 0.01,
    default: 1,
  },
  {
    kind: 'slider',
    key: 'gamma',
    label: 'Gamma',
    min: 0.2,
    max: 4,
    step: 0.05,
    default: 1,
  },
  {
    kind: 'slider',
    key: 'lift',
    label: 'Lift',
    min: -0.3,
    max: 0.3,
    step: 0.01,
    default: 0,
  },
  {
    kind: 'slider',
    key: 'gain',
    label: 'Gain',
    min: 0.2,
    max: 2.5,
    step: 0.01,
    default: 1,
  },
  {
    kind: 'slider',
    key: 'saturation',
    label: 'Saturation',
    min: 0,
    max: 2.5,
    step: 0.01,
    default: 1,
  },
  {
    kind: 'select',
    key: 'channels',
    label: 'Apply to',
    default: 'rgb',
    options: [
      { value: 'rgb', label: 'RGB' },
      { value: 'luma', label: 'Luma' },
    ],
  },
  { kind: 'toggle', key: 'invert', label: 'Invert', default: false },
]

export function applyLevels(
  buffer: PixelBuffer,
  params: Params,
  _env: RenderEnv,
): PixelBuffer {
  const data = buffer.data

  const black = num(params, 'black', 0)
  const white = num(params, 'white', 1)
  const gamma = Math.max(0.01, num(params, 'gamma', 1))
  const lift = num(params, 'lift', 0)
  const gain = num(params, 'gain', 1)
  const saturation = num(params, 'saturation', 1)
  const invert = bool(params, 'invert', false)
  const perChannel = str(params, 'channels', 'rgb') === 'rgb'

  /**
   * Bail out when the curve is the identity.
   *
   * Not only an optimization: the perceptual round trip goes through a lookup
   * table, so an "unchanged" pixel would still come back off by about 1e-4.
   * A layer sitting at its defaults should be exactly a no-op, both because
   * that is what it looks like and because it is free.
   */
  if (
    black === 0 &&
    white === 1 &&
    gamma === 1 &&
    lift === 0 &&
    gain === 1 &&
    saturation === 1 &&
    !invert
  ) {
    return buffer
  }

  // A collapsed or inverted range would divide by zero or flip the image in a
  // way the invert toggle already covers.
  const span = Math.max(0.01, white - black)

  const curve = (value: number) => {
    let v = (value - black) / span
    v = Math.max(0, Math.min(1, v))
    v = v ** (1 / gamma)
    // Lift raises the floor without touching the ceiling; gain scales around
    // black. Applied after gamma so both read as they do on a grading panel.
    v = lift + v * gain
    if (invert) v = 1 - v
    return Math.max(0, Math.min(1, v))
  }

  for (let i = 0; i < data.length; i += 4) {
    if (perChannel) {
      data[i] = fromPerceptual(curve(toPerceptual(data[i])))
      data[i + 1] = fromPerceptual(curve(toPerceptual(data[i + 1])))
      data[i + 2] = fromPerceptual(curve(toPerceptual(data[i + 2])))
    } else {
      // Luma mode preserves hue: shift brightness and scale the colour with it
      // rather than curving each channel independently.
      const source =
        0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      const target = fromPerceptual(curve(toPerceptual(source)))
      const factor = source > 1e-6 ? target / source : 0
      data[i] *= factor
      data[i + 1] *= factor
      data[i + 2] *= factor
    }

    if (saturation !== 1) {
      const grey =
        0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      data[i] = grey + (data[i] - grey) * saturation
      data[i + 1] = grey + (data[i + 1] - grey) * saturation
      data[i + 2] = grey + (data[i + 2] - grey) * saturation
    }

    data[i] = Math.max(0, Math.min(1, data[i]))
    data[i + 1] = Math.max(0, Math.min(1, data[i + 1]))
    data[i + 2] = Math.max(0, Math.min(1, data[i + 2]))
  }

  return buffer
}
