import { fromPerceptual } from '../buffer'
import type { PixelBuffer } from '../buffer'
import { getMask, sampleMask } from '../masks'
import { hexToRgb, paletteExtremes } from '../palettes'
import { num, bool, list, str } from '../params'
import type { ParamSpec } from '../params'
import type { Params, RenderEnv } from '../types'
import { scaled } from '../types'

/**
 * Dither — ordered masks and error diffusion.
 *
 * Three things this gets right that the first version did not:
 *
 * 1. **It runs per pixel by default.** The original *always* averaged into
 *    cells first, which meant error diffusion ran on a grid of flat blocks and
 *    lost the entire mechanism. `pixelSize` is now an opt-in: 1 is the pixel
 *    grid, and above 1 the dither runs coarse deliberately — which is just
 *    diffusion on a smaller image, and correct.
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
    key: 'pixelSize',
    label: 'Pixel size',
    min: 1,
    max: 24,
    step: 1,
    default: 1,
    spatial: true,
    unit: 'px',
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

/**
 * Average the buffer into a grid of `cell`-sized blocks.
 *
 * At cell size 1 this is the pixel grid and the dither runs per pixel, which
 * is what error diffusion needs to work properly. Above 1 the dither runs at
 * the coarser resolution — chunky dots without stacking a separate pixelate
 * layer, and coarse error diffusion is simply diffusion on a smaller image.
 */
function toGrid(buffer: PixelBuffer, cell: number) {
  const { width, height, data } = buffer
  const cols = Math.ceil(width / cell)
  const rows = Math.ceil(height / cell)
  const count = cols * rows

  const r = new Float32Array(count)
  const g = new Float32Array(count)
  const b = new Float32Array(count)

  if (cell === 1) {
    for (let i = 0; i < count; i++) {
      r[i] = data[i * 4]
      g[i] = data[i * 4 + 1]
      b[i] = data[i * 4 + 2]
    }
    return { cols, rows, r, g, b }
  }

  for (let row = 0; row < rows; row++) {
    const maxY = Math.min((row + 1) * cell, height)
    for (let col = 0; col < cols; col++) {
      const maxX = Math.min((col + 1) * cell, width)
      let sr = 0
      let sg = 0
      let sb = 0
      let n = 0
      for (let y = row * cell; y < maxY; y++) {
        for (let x = col * cell; x < maxX; x++) {
          const i = (y * width + x) * 4
          sr += data[i]
          sg += data[i + 1]
          sb += data[i + 2]
          n++
        }
      }
      n = n || 1
      const index = row * cols + col
      r[index] = sr / n
      g[index] = sg / n
      b[index] = sb / n
    }
  }

  return { cols, rows, r, g, b }
}

const LUMA_R = 0.2126
const LUMA_G = 0.7152
const LUMA_B = 0.0722

export function applyDither(
  buffer: PixelBuffer,
  params: Params,
  env: RenderEnv,
): PixelBuffer {
  const { width, height, data } = buffer
  const algorithm = str(params, 'algorithm', 'blue')
  const matrixSize = Number.parseInt(str(params, 'matrixSize', '8'), 10) || 8
  const levels = Math.max(2, Math.round(num(params, 'levels', 2)))
  const bias = num(params, 'bias', 0)
  const invert = bool(params, 'invert', false)
  const serpentine = bool(params, 'serpentine', true)
  const mode = str(params, 'mode', 'duotone')
  const cell = scaled(num(params, 'pixelSize', 1), env, 1)

  const toLinear = (hex: string) => {
    const { r, g, b } = hexToRgb(hex)
    return {
      r: fromPerceptual(r / 255),
      g: fromPerceptual(g / 255),
      b: fromPerceptual(b / 255),
    }
  }

  const hexes = list(params, 'palette', ['#050505', '#f5f5f5'])
  // Full palette, for the colour-quantizing mode.
  const palette = hexes.map(toLinear)
  // By lightness, not by position: the last palette entry is an accent colour,
  // not necessarily the lightest one.
  const ends = paletteExtremes(hexes)
  const dark = toLinear(ends.dark)
  const light = toLinear(ends.light)

  const step = 1 / (levels - 1)
  const quantize = (v: number) =>
    Math.max(0, Math.min(1, Math.round(v / step) * step))

  const grid = toGrid(buffer, cell)
  const { cols, rows } = grid
  const count = cols * rows

  const outR = new Float32Array(count)
  const outG = new Float32Array(count)
  const outB = new Float32Array(count)

  /** Resolve a quantized tone into the output colour for one cell. */
  const paintTone = (index: number, tone: number) => {
    const value = invert ? 1 - tone : tone

    if (mode === 'mono') {
      outR[index] = value
      outG[index] = value
      outB[index] = value
      return
    }

    if (mode === 'source') {
      // Keep the hue, drive brightness by the pattern.
      const source =
        LUMA_R * grid.r[index] + LUMA_G * grid.g[index] + LUMA_B * grid.b[index]
      const factor = source > 1e-6 ? value / source : 0
      outR[index] = grid.r[index] * factor
      outG[index] = grid.g[index] * factor
      outB[index] = grid.b[index] * factor
      return
    }

    outR[index] = dark.r + (light.r - dark.r) * value
    outG[index] = dark.g + (light.g - dark.g) * value
    outB[index] = dark.b + (light.b - dark.b) * value
  }

  if (mode === 'palette') {
    /* --- quantize in colour, carry the colour error --------------------- */
    const wr = Float32Array.from(grid.r)
    const wg = Float32Array.from(grid.g)
    const wb = Float32Array.from(grid.b)
    const kernel = isDiffusion(algorithm) ? DIFFUSION_KERNELS[algorithm] : null
    const mask = kernel
      ? null
      : algorithm === 'blue'
        ? getMask('blue', BLUE_NOISE_TILE)
        : getMask('bayer', matrixSize)

    for (let row = 0; row < rows; row++) {
      const reversed = kernel !== null && serpentine && row % 2 === 1

      for (let n = 0; n < cols; n++) {
        const col = reversed ? cols - 1 - n : n
        const index = row * cols + col

        // Ordered masks perturb the colour before the lookup; diffusion feeds
        // in accumulated error instead. Either way the nearest entry wins.
        const offset = mask ? (sampleMask(mask, col, row) - 0.5) * step : 0
        const chosen = nearestIn(
          palette,
          wr[index] + offset + bias,
          wg[index] + offset + bias,
          wb[index] + offset + bias,
        )

        outR[index] = chosen.r
        outG[index] = chosen.g
        outB[index] = chosen.b

        if (kernel) {
          const er = wr[index] - chosen.r
          const eg = wg[index] - chosen.g
          const eb = wb[index] - chosen.b

          for (const [dx, dy, weight] of kernel.taps) {
            // Mirror the kernel when scanning right-to-left, or the error
            // trails behind the scan instead of ahead of it.
            const tx = col + (reversed ? -dx : dx)
            const ty = row + dy
            if (tx < 0 || tx >= cols || ty >= rows) continue
            const t = ty * cols + tx
            const share = weight / kernel.divisor
            wr[t] += er * share
            wg[t] += eg * share
            wb[t] += eb * share
          }
        }
      }
    }
  } else if (isDiffusion(algorithm)) {
    /* --- tone modes, error diffusion ------------------------------------ */
    const { divisor, taps } = DIFFUSION_KERNELS[algorithm]
    const work = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      work[i] = LUMA_R * grid.r[i] + LUMA_G * grid.g[i] + LUMA_B * grid.b[i]
    }

    for (let row = 0; row < rows; row++) {
      const reversed = serpentine && row % 2 === 1

      for (let n = 0; n < cols; n++) {
        const col = reversed ? cols - 1 - n : n
        const index = row * cols + col

        const wanted = work[index] + bias
        const chosen = quantize(wanted)
        const error = wanted - chosen
        paintTone(index, chosen)

        for (const [dx, dy, weight] of taps) {
          const tx = col + (reversed ? -dx : dx)
          const ty = row + dy
          if (tx < 0 || tx >= cols || ty >= rows) continue
          work[ty * cols + tx] += (error * weight) / divisor
        }
      }
    }
  } else {
    /* --- tone modes, ordered mask ---------------------------------------- */
    //
    // Blue noise ignores `matrixSize` and always uses a large tile. The whole
    // point of it is the absence of visible periodicity, and an 8x8 blue-noise
    // tile repeats every 8 pixels exactly like Bayer does — it would be a more
    // expensive way to get the same lattice.
    const mask =
      algorithm === 'blue'
        ? getMask('blue', BLUE_NOISE_TILE)
        : getMask('bayer', matrixSize)

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const index = row * cols + col
        const tone =
          LUMA_R * grid.r[index] +
          LUMA_G * grid.g[index] +
          LUMA_B * grid.b[index]
        // At bias 0 and two levels this reduces to `tone > uniform(0,1)`, the
        // unbiased ordered dither.
        const offset = (sampleMask(mask, col, row) - 0.5) * step
        paintTone(index, quantize(tone + offset + bias))
      }
    }
  }

  // Paint the grid back over the buffer.
  for (let row = 0; row < rows; row++) {
    const maxY = cell === 1 ? row + 1 : Math.min((row + 1) * cell, height)
    for (let col = 0; col < cols; col++) {
      const maxX = cell === 1 ? col + 1 : Math.min((col + 1) * cell, width)
      const index = row * cols + col

      for (let y = row * cell; y < maxY; y++) {
        for (let x = col * cell; x < maxX; x++) {
          const i = (y * width + x) * 4
          data[i] = outR[index]
          data[i + 1] = outG[index]
          data[i + 2] = outB[index]
        }
      }
    }
  }

  return buffer
}
