import { fromPerceptual, luma } from '../buffer'
import type { PixelBuffer } from '../buffer'
import { getMask, sampleMask } from '../masks'
import { hexToRgb } from '../palettes'
import { num, bool, list, str } from '../params'
import type { ParamSpec } from '../params'
import type { Params, RenderEnv } from '../types'

/**
 * Dither — ordered masks and error diffusion, per pixel.
 *
 * Three things this gets right that the first version did not:
 *
 * 1. **It runs per pixel.** Cell averaging moved out into its own `pixelate`
 *    effect. Error diffusion is a sequential per-pixel process; running it on a
 *    grid of averaged cells discards the entire mechanism.
 * 2. **Thresholds are compared in linear light.** A dither reproduces a tone by
 *    lighting a fraction of pixels and the eye averages them linearly, so to
 *    hit tone L the lit fraction must be L *linear*. Thresholding sRGB lights
 *    far too many pixels in the shadows and the result reads blown out.
 * 3. **Diffusion can serpentine.** Scanning every row left-to-right pushes
 *    error consistently in one direction, which shows up as diagonal "worming".
 *    Alternating direction each row cancels it.
 */

const DIFFUSION_KERNELS = {
  'floyd-steinberg': {
    divisor: 16,
    taps: [
      [1, 0, 7],
      [-1, 1, 3],
      [0, 1, 5],
      [1, 1, 1],
    ],
  },
  atkinson: {
    // Only 6/8 of the error is passed on; discarding the rest is what gives
    // Atkinson its characteristic blown-out contrast.
    divisor: 8,
    taps: [
      [1, 0, 1],
      [2, 0, 1],
      [-1, 1, 1],
      [0, 1, 1],
      [1, 1, 1],
      [0, 2, 1],
    ],
  },
  jarvis: {
    divisor: 48,
    taps: [
      [1, 0, 7],
      [2, 0, 5],
      [-2, 1, 3],
      [-1, 1, 5],
      [0, 1, 7],
      [1, 1, 5],
      [2, 1, 3],
      [-2, 2, 1],
      [-1, 2, 3],
      [0, 2, 5],
      [1, 2, 3],
      [2, 2, 1],
    ],
  },
  stucki: {
    divisor: 42,
    taps: [
      [1, 0, 8],
      [2, 0, 4],
      [-2, 1, 2],
      [-1, 1, 4],
      [0, 1, 8],
      [1, 1, 4],
      [2, 1, 2],
      [-2, 2, 1],
      [-1, 2, 2],
      [0, 2, 4],
      [1, 2, 2],
      [2, 2, 1],
    ],
  },
} as const satisfies Record<
  string,
  { divisor: number; taps: ReadonlyArray<readonly [number, number, number]> }
>

type DiffusionName = keyof typeof DIFFUSION_KERNELS

/**
 * Blue-noise tile size. 64 is the smallest that avoids a visible repeat at
 * typical export sizes; the mask is built once and cached for the session.
 */
const BLUE_NOISE_TILE = 64

function isDiffusion(algorithm: string): algorithm is DiffusionName {
  return algorithm in DIFFUSION_KERNELS
}

export const DITHER_PARAMS: Array<ParamSpec> = [
  {
    kind: 'select',
    key: 'algorithm',
    label: 'Algorithm',
    default: 'blue',
    options: [
      { value: 'bayer', label: 'Bayer' },
      { value: 'blue', label: 'Blue' },
      { value: 'floyd-steinberg', label: 'Floyd' },
      { value: 'atkinson', label: 'Atkin' },
      { value: 'jarvis', label: 'Jarvis' },
      { value: 'stucki', label: 'Stucki' },
    ],
  },
  {
    kind: 'select',
    key: 'matrixSize',
    label: 'Matrix',
    default: '8',
    options: [
      { value: '2', label: '2' },
      { value: '4', label: '4' },
      { value: '8', label: '8' },
      { value: '16', label: '16' },
    ],
  },
  {
    kind: 'slider',
    key: 'levels',
    label: 'Levels',
    min: 2,
    max: 8,
    step: 1,
    default: 2,
  },
  {
    kind: 'slider',
    key: 'bias',
    label: 'Bias',
    min: -0.5,
    max: 0.5,
    step: 0.01,
    default: 0,
  },
  {
    kind: 'select',
    key: 'mode',
    label: 'Colour',
    default: 'duotone',
    options: [
      { value: 'mono', label: 'Mono' },
      { value: 'duotone', label: 'Duo' },
      { value: 'palette', label: 'Palette' },
      { value: 'source', label: 'Source' },
    ],
  },
  {
    kind: 'palette',
    key: 'palette',
    label: 'Palette',
    default: ['#050505', '#f5f5f5'],
  },
  { kind: 'toggle', key: 'serpentine', label: 'Serpentine', default: true },
  { kind: 'toggle', key: 'invert', label: 'Invert', default: false },
]

interface Rgb {
  r: number
  g: number
  b: number
}

function nearestIn(palette: Array<Rgb>, r: number, g: number, b: number): Rgb {
  let best = palette[0]
  let bestDistance = Infinity

  for (const color of palette) {
    const dr = color.r - r
    const dg = color.g - g
    const db = color.b - b
    const distance = dr * dr + dg * dg + db * db
    if (distance < bestDistance) {
      bestDistance = distance
      best = color
    }
  }

  return best
}

export function applyDither(
  buffer: PixelBuffer,
  params: Params,
  _env: RenderEnv,
): PixelBuffer {
  const { width, height, data } = buffer
  const algorithm = str(params, 'algorithm', 'blue')
  const matrixSize = Number.parseInt(str(params, 'matrixSize', '8'), 10) || 8
  const levels = Math.max(2, Math.round(num(params, 'levels', 2)))
  const bias = num(params, 'bias', 0)
  const invert = bool(params, 'invert', false)
  const serpentine = bool(params, 'serpentine', true)
  const mode = str(params, 'mode', 'duotone')

  const palette = list(params, 'palette', ['#050505', '#f5f5f5']).map((hex) => {
    const { r, g, b } = hexToRgb(hex)
    return {
      r: fromPerceptual(r / 255),
      g: fromPerceptual(g / 255),
      b: fromPerceptual(b / 255),
    }
  })

  const dark = palette[0] ?? { r: 0, g: 0, b: 0 }
  const light = palette[palette.length - 1] ?? { r: 1, g: 1, b: 1 }
  const step = 1 / (levels - 1)
  const quantize = (v: number) =>
    Math.max(0, Math.min(1, Math.round(v / step) * step))

  /** Paint one pixel from a quantized 0..1 tone. */
  const writeTone = (i: number, tone: number, sourceLuma: number) => {
    const value = invert ? 1 - tone : tone

    if (mode === 'mono') {
      data[i] = value
      data[i + 1] = value
      data[i + 2] = value
      return
    }

    if (mode === 'source') {
      // Keep the hue, drive brightness by the pattern.
      const factor = sourceLuma > 1e-6 ? value / sourceLuma : 0
      data[i] *= factor
      data[i + 1] *= factor
      data[i + 2] *= factor
      return
    }

    data[i] = dark.r + (light.r - dark.r) * value
    data[i + 1] = dark.g + (light.g - dark.g) * value
    data[i + 2] = dark.b + (light.b - dark.b) * value
  }

  /* --- palette mode: quantize in colour, diffuse the colour error -------- */
  if (mode === 'palette' && isDiffusion(algorithm)) {
    const { divisor, taps } = DIFFUSION_KERNELS[algorithm]

    for (let y = 0; y < height; y++) {
      const reversed = serpentine && y % 2 === 1

      for (let n = 0; n < width; n++) {
        const x = reversed ? width - 1 - n : n
        const i = (y * width + x) * 4

        const chosen = nearestIn(palette, data[i], data[i + 1], data[i + 2])
        const er = data[i] - chosen.r
        const eg = data[i + 1] - chosen.g
        const eb = data[i + 2] - chosen.b

        data[i] = chosen.r
        data[i + 1] = chosen.g
        data[i + 2] = chosen.b

        for (const [dx, dy, weight] of taps) {
          // Mirror the kernel when scanning right-to-left, or the error trails
          // behind the scan instead of ahead of it.
          const tx = x + (reversed ? -dx : dx)
          const ty = y + dy
          if (tx < 0 || tx >= width || ty >= height) continue
          const t = (ty * width + tx) * 4
          const share = weight / divisor
          data[t] += er * share
          data[t + 1] += eg * share
          data[t + 2] += eb * share
        }
      }
    }

    return buffer
  }

  /* --- tone modes -------------------------------------------------------- */
  if (isDiffusion(algorithm)) {
    const { divisor, taps } = DIFFUSION_KERNELS[algorithm]

    // Diffusion accumulates into a working plane; the source luma is kept so
    // `source` mode can recover the original hue after quantizing.
    const work = new Float32Array(width * height)
    const original = new Float32Array(width * height)
    for (let p = 0; p < work.length; p++) {
      const value = luma(buffer, p * 4)
      work[p] = value
      original[p] = value
    }

    for (let y = 0; y < height; y++) {
      const reversed = serpentine && y % 2 === 1

      for (let n = 0; n < width; n++) {
        const x = reversed ? width - 1 - n : n
        const p = y * width + x

        const wanted = work[p] + bias
        const chosen = quantize(wanted)
        const error = wanted - chosen

        writeTone(p * 4, chosen, original[p])

        for (const [dx, dy, weight] of taps) {
          const tx = x + (reversed ? -dx : dx)
          const ty = y + dy
          if (tx < 0 || tx >= width || ty >= height) continue
          work[ty * width + tx] += (error * weight) / divisor
        }
      }
    }

    return buffer
  }

  // Ordered: offset the threshold by position instead of carrying error.
  //
  // Blue noise ignores `matrixSize` and always uses a large tile. The whole
  // point of it is the absence of visible periodicity, and an 8x8 blue-noise
  // tile repeats every 8 pixels exactly like Bayer does — it would be a more
  // expensive way to get the same lattice.
  const mask =
    algorithm === 'blue'
      ? getMask('blue', BLUE_NOISE_TILE)
      : getMask('bayer', matrixSize)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const tone = luma(buffer, i)
      // At bias 0 and two levels this reduces to `tone > uniform(0,1)`, the
      // unbiased ordered dither.
      const offset = (sampleMask(mask, x, y) - 0.5) * step
      writeTone(i, quantize(tone + offset + bias), tone)
    }
  }

  return buffer
}
