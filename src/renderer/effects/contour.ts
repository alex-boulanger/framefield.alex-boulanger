import { luma, srgbToLinear, toPerceptual } from '../buffer'
import type { PixelBuffer } from '../buffer'
import { hexToRgb, paletteExtremes } from '../palettes'
import { bool, list, num, str } from '../params'
import type { ParamSpec } from '../params'
import type { Params, RenderEnv } from '../types'
import { scaled } from '../types'

/**
 * Contour — iso-lines and edges.
 *
 * The most on-brand effect the registry was missing. Everything else re-encodes
 * tone; this extracts *structure* from it, so a continuous field comes out
 * looking drawn rather than filtered — a topographic map of the noise. Nothing
 * else here reads as line work.
 *
 * Two modes from the same gradient:
 *
 * - `contour` — where the tone crosses evenly spaced levels. Divided by the
 *   local gradient so the lines keep a constant width instead of ballooning
 *   across flat regions and vanishing on steep ones.
 * - `edges` — raw Sobel magnitude, which finds boundaries rather than levels.
 */

export const CONTOUR_PARAMS: Array<ParamSpec> = [
  {
    kind: 'select',
    key: 'mode',
    label: 'Mode',
    default: 'contour',
    options: [
      { value: 'contour', label: 'Contour' },
      { value: 'edges', label: 'Edges' },
    ],
  },
  {
    kind: 'slider',
    key: 'levels',
    label: 'Levels',
    min: 2,
    max: 40,
    step: 1,
    default: 12,
  },
  {
    kind: 'slider',
    key: 'thickness',
    label: 'Thickness',
    min: 0.5,
    max: 6,
    step: 0.1,
    default: 1.4,
    spatial: true,
    unit: 'px',
  },
  {
    kind: 'slider',
    key: 'gain',
    label: 'Gain',
    min: 0.2,
    max: 6,
    step: 0.1,
    default: 1.6,
  },
  { kind: 'toggle', key: 'invert', label: 'Invert', default: false },
  {
    kind: 'palette',
    key: 'palette',
    label: 'Palette',
    default: ['#050505', '#f5f5f5', '#0057ff'],
  },
]

export function applyContour(
  buffer: PixelBuffer,
  params: Params,
  env: RenderEnv,
): PixelBuffer {
  const { width, height, data } = buffer
  const mode = str(params, 'mode', 'contour')
  const levels = Math.max(2, Math.round(num(params, 'levels', 12)))
  const thickness = scaled(num(params, 'thickness', 1.4), env, 1)
  const gain = Math.max(0.01, num(params, 'gain', 1.6))
  const invert = bool(params, 'invert', false)

  const { dark, light } = paletteExtremes(
    list(params, 'palette', ['#050505', '#f5f5f5', '#0057ff']),
  )
  const inkRgb = hexToRgb(invert ? light : dark)
  const paperRgb = hexToRgb(invert ? dark : light)
  const ink = [
    srgbToLinear(inkRgb.r / 255),
    srgbToLinear(inkRgb.g / 255),
    srgbToLinear(inkRgb.b / 255),
  ]
  const paper = [
    srgbToLinear(paperRgb.r / 255),
    srgbToLinear(paperRgb.g / 255),
    srgbToLinear(paperRgb.b / 255),
  ]

  // Tone read once into its own plane. Sobel needs eight neighbours per pixel,
  // and recomputing luma for each would be nine reads instead of one.
  const tone = new Float32Array(width * height)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    tone[p] = toPerceptual(luma(buffer, i))
  }

  const at = (x: number, y: number) =>
    tone[
      Math.min(height - 1, Math.max(0, y)) * width +
        Math.min(width - 1, Math.max(0, x))
    ]

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx =
        at(x - 1, y - 1) +
        2 * at(x - 1, y) +
        at(x - 1, y + 1) -
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1))
      const gy =
        at(x - 1, y - 1) +
        2 * at(x, y - 1) +
        at(x + 1, y - 1) -
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1))
      const gradient = Math.hypot(gx, gy) / 8

      let coverage: number
      if (mode === 'edges') {
        coverage = Math.min(1, gradient * levels * gain)
      } else {
        const value = at(x, y) * levels
        // Distance to the nearest level crossing, in level units.
        const toLevel = Math.abs(value - Math.round(value))
        // Converted to pixels by dividing by the per-pixel rate of change,
        // which is what keeps the line width even across the frame. The floor
        // stops flat regions dividing by ~0 and flooding with ink.
        const perPixel = Math.max(gradient * levels, 1e-4)
        coverage = Math.max(
          0,
          1 - toLevel / perPixel / Math.max(0.5, thickness / 2),
        )
        coverage = Math.min(1, coverage * gain)
      }

      const i = (y * width + x) * 4
      for (let c = 0; c < 3; c++) {
        data[i + c] = paper[c] + (ink[c] - paper[c]) * coverage
      }
    }
  }

  return buffer
}
