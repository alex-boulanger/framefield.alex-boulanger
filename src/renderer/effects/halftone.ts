import { fromPerceptual, toPerceptual } from '../buffer'
import type { PixelBuffer } from '../buffer'
import { hexToRgb, paletteExtremes } from '../palettes'
import { bool, list, num, str } from '../params'
import type { ParamSpec } from '../params'
import type { Params, RenderEnv } from '../types'
import { scaled } from '../types'

/**
 * Halftone — rotated screens, the way print actually does it.
 *
 * Analytic rather than mask-based: for each pixel we rotate into screen space,
 * find the nearest screen cell, and ink it if the pixel falls inside a dot
 * whose radius comes from the tone *sampled at that cell's centre*. Sampling at
 * the centre rather than at the pixel is what gives clean round dots instead of
 * ragged ones, and being analytic means the dots stay smooth at any cell size
 * without a supersampling pass.
 *
 * The CMYK mode runs four screens at the classic newspaper angles and combines
 * them subtractively, which is where the rosette pattern comes from. It is the
 * one effect here that is genuinely trying to look like ink on paper.
 */

export const HALFTONE_PARAMS: Array<ParamSpec> = [
  {
    kind: 'select',
    key: 'mode',
    label: 'Mode',
    default: 'mono',
    options: [
      { value: 'mono', label: 'Mono' },
      { value: 'duotone', label: 'Duo' },
      { value: 'cmyk', label: 'CMYK' },
    ],
  },
  {
    kind: 'select',
    key: 'shape',
    label: 'Shape',
    default: 'dot',
    options: [
      { value: 'dot', label: 'Dot' },
      { value: 'square', label: 'Square' },
      { value: 'line', label: 'Line' },
      { value: 'cross', label: 'Cross' },
    ],
  },
  {
    kind: 'slider',
    key: 'cellSize',
    label: 'Screen',
    min: 2,
    max: 40,
    step: 1,
    default: 8,
    spatial: true,
    unit: 'px',
  },
  {
    kind: 'slider',
    key: 'angle',
    label: 'Angle',
    min: 0,
    max: 90,
    step: 1,
    default: 45,
    unit: '°',
  },
  {
    kind: 'slider',
    key: 'spread',
    label: 'Plate spread',
    min: 0,
    max: 90,
    step: 1,
    default: 30,
    unit: '°',
  },
  {
    kind: 'slider',
    key: 'softness',
    label: 'Softness',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.15,
  },
  {
    kind: 'slider',
    key: 'gain',
    label: 'Ink gain',
    min: 0.2,
    max: 2,
    step: 0.01,
    default: 1,
  },
  {
    kind: 'palette',
    key: 'palette',
    label: 'Palette',
    default: ['#050505', '#f5f5f5'],
  },
  { kind: 'toggle', key: 'invert', label: 'Invert', default: false },
]

/** Classic separation angles. Yellow sits at 0 because it hides best. */
const CMYK_ANGLES = { c: 15, m: 75, y: 0, k: 45 }

interface Screen {
  cos: number
  sin: number
  cell: number
}

function screenFor(angleDegrees: number, cell: number): Screen {
  const radians = (angleDegrees * Math.PI) / 180
  return { cos: Math.cos(radians), sin: Math.sin(radians), cell }
}

/**
 * Coverage of the dot at (x, y) for a screen, given a tone lookup.
 *
 * Returns 0..1 ink. `sample` receives image-space coordinates of the cell
 * centre so the caller decides which channel's tone drives the dot.
 */
function inkAt(
  x: number,
  y: number,
  screen: Screen,
  shape: string,
  softness: number,
  sample: (cx: number, cy: number) => number,
): number {
  const { cos, sin, cell } = screen

  // Into screen space.
  const sx = x * cos + y * sin
  const sy = -x * sin + y * cos

  const cellX = Math.floor(sx / cell)
  const cellY = Math.floor(sy / cell)
  const centreX = (cellX + 0.5) * cell
  const centreY = (cellY + 0.5) * cell

  // Back to image space to read the tone under this cell's centre.
  const imageX = centreX * cos - centreY * sin
  const imageY = centreX * sin + centreY * cos
  const tone = sample(imageX, imageY)
  if (tone <= 0) return 0

  const dx = sx - centreX
  const dy = sy - centreY
  // Radius grows with the square root of tone so that *area* — which is what
  // the eye integrates — stays proportional to the tone being reproduced.
  const radius = Math.sqrt(tone) * cell * 0.72

  let distance: number
  switch (shape) {
    case 'square':
      distance = Math.max(Math.abs(dx), Math.abs(dy))
      break
    case 'line':
      distance = Math.abs(dy)
      break
    case 'cross':
      distance = Math.min(Math.abs(dx), Math.abs(dy))
      break
    default:
      distance = Math.hypot(dx, dy)
  }

  // Antialias the rim. A hard cutoff aliases badly at small screen sizes.
  const edge = Math.max(0.5, softness * cell * 0.5)
  return Math.max(0, Math.min(1, (radius - distance) / edge + 0.5))
}

export function applyHalftone(
  buffer: PixelBuffer,
  params: Params,
  env: RenderEnv,
): PixelBuffer {
  const { width, height, data } = buffer
  const source = new Float32Array(data)

  const mode = str(params, 'mode', 'mono')
  const shape = str(params, 'shape', 'dot')
  const cell = scaled(num(params, 'cellSize', 8), env, 2)
  const angle = num(params, 'angle', 45)
  const softness = num(params, 'softness', 0.15)
  const gain = num(params, 'gain', 1)
  const invert = bool(params, 'invert', false)

  const toLinear = (hex: string) => {
    const { r, g, b } = hexToRgb(hex)
    return {
      r: fromPerceptual(r / 255),
      g: fromPerceptual(g / 255),
      b: fromPerceptual(b / 255),
    }
  }

  // A halftone lays dark ink on light paper, and the two are chosen by
  // lightness — the last palette entry is an accent, not necessarily the
  // lightest, so taking the ends by position picks the wrong paper colour.
  const hexes = list(params, 'palette', ['#050505', '#f5f5f5'])
  const ends = paletteExtremes(hexes)
  const inkColor = toLinear(ends.dark)
  const paper = toLinear(ends.light)
  const spread = num(params, 'spread', 30)

  // Every palette entry except the paper becomes its own plate. Two swatches
  // give one ink on paper; three give the two-colour overprint riso is named
  // for.
  const plateColors = hexes
    .filter((hex) => hex !== ends.light)
    .map((hex) => ({ hex, rgb: toLinear(hex) }))

  /** Nearest-pixel channel read, clamped. */
  const read = (x: number, y: number, channel: number) => {
    const cx = Math.max(0, Math.min(width - 1, Math.round(x)))
    const cy = Math.max(0, Math.min(height - 1, Math.round(y)))
    return source[(cy * width + cx) * 4 + channel]
  }

  /**
   * Screens measure *ink*, so tone is inverted and read perceptually: a dot's
   * size should track how dark the area looks, not how little light it emits.
   */
  const inkTone = (value: number) =>
    Math.max(0, Math.min(1, (1 - toPerceptual(value)) * gain))

  if (mode === 'cmyk') {
    const screens = {
      c: screenFor(CMYK_ANGLES.c, cell),
      m: screenFor(CMYK_ANGLES.m, cell),
      y: screenFor(CMYK_ANGLES.y, cell),
      k: screenFor(CMYK_ANGLES.k, cell),
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Separate at the cell centre inside each screen, so every plate reads
        // its own grid rather than sharing one sample point.
        const separation =
          (channel: 0 | 1 | 2 | 3) => (cx: number, cy: number) => {
            const r = toPerceptual(read(cx, cy, 0))
            const g = toPerceptual(read(cx, cy, 1))
            const b = toPerceptual(read(cx, cy, 2))
            const k = 1 - Math.max(r, g, b)
            if (channel === 3) return Math.max(0, Math.min(1, k * gain))
            const denominator = 1 - k || 1
            const value =
              channel === 0
                ? (1 - r - k) / denominator
                : channel === 1
                  ? (1 - g - k) / denominator
                  : (1 - b - k) / denominator
            return Math.max(0, Math.min(1, value * gain))
          }

        const c = inkAt(x, y, screens.c, shape, softness, separation(0))
        const m = inkAt(x, y, screens.m, shape, softness, separation(1))
        const yl = inkAt(x, y, screens.y, shape, softness, separation(2))
        const k = inkAt(x, y, screens.k, shape, softness, separation(3))

        // Subtractive: each plate removes its complement, black removes all.
        const i = (y * width + x) * 4
        data[i] = fromPerceptual((1 - c) * (1 - k))
        data[i + 1] = fromPerceptual((1 - m) * (1 - k))
        data[i + 2] = fromPerceptual((1 - yl) * (1 - k))
      }
    }

    return buffer
  }

  const screen = screenFor(angle, cell)

  const toneAt = (cx: number, cy: number) => {
    const px = Math.max(0, Math.min(width - 1, Math.round(cx)))
    const py = Math.max(0, Math.min(height - 1, Math.round(cy)))
    const i = (py * width + px) * 4
    const value =
      0.2126 * source[i] + 0.7152 * source[i + 1] + 0.0722 * source[i + 2]
    return inkTone(invert ? 1 - value : value)
  }

  if (mode === 'mono') {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const coverage = inkAt(x, y, screen, shape, softness, toneAt)
        const value = 1 - coverage
        const i = (y * width + x) * 4
        data[i] = value
        data[i + 1] = value
        data[i + 2] = value
      }
    }

    return buffer
  }

  /* --- duotone: one screen per ink, each at its own angle ---------------- */
  //
  // Real two-colour printing runs each ink through its own rotated screen, and
  // the offset between those screens is what produces the interference texture
  // and the slight misregistration that says "riso" rather than "filter". A
  // single screen tinted two colours cannot produce either.
  const inks =
    plateColors.length > 0 ? plateColors : [{ hex: ends.dark, rgb: inkColor }]
  const plates = inks.map((ink, index) => ({
    rgb: ink.rgb,
    screen: screenFor(angle + index * spread, cell),
  }))

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4

      // Start on paper and lay each ink down subtractively, so overlapping
      // plates darken the way overlapping ink does.
      let r = paper.r
      let g = paper.g
      let b = paper.b

      for (const plate of plates) {
        const coverage = inkAt(x, y, plate.screen, shape, softness, toneAt)
        if (coverage <= 0) continue
        r *= 1 - coverage * (1 - plate.rgb.r)
        g *= 1 - coverage * (1 - plate.rgb.g)
        b *= 1 - coverage * (1 - plate.rgb.b)
      }

      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
    }
  }

  return buffer
}
