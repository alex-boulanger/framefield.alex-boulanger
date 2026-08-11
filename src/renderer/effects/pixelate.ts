import type { PixelBuffer } from '../buffer'
import { num, str } from '../params'
import type { ParamSpec } from '../params'
import type { Params, RenderEnv } from '../types'
import { scaled } from '../types'

/**
 * Pixelate — reduce the image to uniform cells.
 *
 * Split out of dither, where it never belonged. Dither used to average each
 * cell to a single tone before thresholding, which made "pixel size" a dither
 * parameter and meant the two could never be used independently: no dithering
 * at full resolution, no pixelation without dithering, and error diffusion ran
 * on the cell grid where it does not work at all.
 *
 * As separate layers they compose in either order, which is the point of having
 * a stack.
 */

export const PIXELATE_PARAMS: Array<ParamSpec> = [
  {
    kind: 'slider',
    key: 'size',
    label: 'Cell size',
    min: 2,
    max: 64,
    step: 1,
    default: 8,
    spatial: true,
    unit: 'px',
  },
  {
    kind: 'select',
    key: 'sampling',
    label: 'Sampling',
    default: 'average',
    options: [
      { value: 'average', label: 'Average' },
      { value: 'nearest', label: 'Point' },
    ],
  },
  {
    kind: 'slider',
    key: 'aspect',
    label: 'Aspect',
    min: 0.25,
    max: 4,
    step: 0.05,
    default: 1,
  },
]

export function applyPixelate(
  buffer: PixelBuffer,
  params: Params,
  env: RenderEnv,
): PixelBuffer {
  const { width, height, data } = buffer
  const sampling = str(params, 'sampling', 'average')
  const aspect = Math.max(0.25, num(params, 'aspect', 1))

  const cellX = scaled(num(params, 'size', 8), env)
  const cellY = Math.max(1, Math.round(cellX * aspect))

  const source = sampling === 'nearest' ? new Float32Array(data) : null

  for (let top = 0; top < height; top += cellY) {
    const maxY = Math.min(top + cellY, height)

    for (let left = 0; left < width; left += cellX) {
      const maxX = Math.min(left + cellX, width)

      let r: number
      let g: number
      let b: number
      let a: number

      if (source) {
        // Point sampling takes the cell centre, which keeps hard edges hard
        // instead of smearing them across the cell boundary.
        const cx = Math.min(width - 1, left + ((maxX - left) >> 1))
        const cy = Math.min(height - 1, top + ((maxY - top) >> 1))
        const i = (cy * width + cx) * 4
        r = source[i]
        g = source[i + 1]
        b = source[i + 2]
        a = source[i + 3]
      } else {
        // Averaging in linear light is the physically correct downsample.
        let sr = 0
        let sg = 0
        let sb = 0
        let sa = 0
        let count = 0

        for (let y = top; y < maxY; y++) {
          for (let x = left; x < maxX; x++) {
            const i = (y * width + x) * 4
            sr += data[i]
            sg += data[i + 1]
            sb += data[i + 2]
            sa += data[i + 3]
            count++
          }
        }

        r = sr / count
        g = sg / count
        b = sb / count
        a = sa / count
      }

      for (let y = top; y < maxY; y++) {
        for (let x = left; x < maxX; x++) {
          const i = (y * width + x) * 4
          data[i] = r
          data[i + 1] = g
          data[i + 2] = b
          data[i + 3] = a
        }
      }
    }
  }

  return buffer
}
