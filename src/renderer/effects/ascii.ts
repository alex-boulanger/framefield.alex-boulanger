import { fromPerceptual, luma } from '../buffer'
import type { PixelBuffer } from '../buffer'
import { getAtlas } from '../glyphAtlas'
import type { GlyphAtlas } from '../glyphAtlas'
import { hexToRgb, paletteExtremes } from '../palettes'
import { bool, list, num, str } from '../params'
import type { ParamSpec } from '../params'
import type { Params, RenderEnv } from '../types'
import { scaled } from '../types'

/**
 * ASCII — render luminance as characters.
 *
 * Two things make this read as deliberate rather than as a novelty filter:
 *
 * 1. **The ramp is ordered by measured ink coverage**, not by how the string
 *    was typed (see `glyphAtlas.ts`). That is what lets any custom ramp work,
 *    including one in arbitrary order.
 * 2. **Edge awareness.** Mapping tone alone gives an even mush of characters.
 *    Detecting the local gradient and substituting `- / | \` along strong edges
 *    gives the image contours, which is most of what makes ASCII art legible.
 */

/** Ordering here is cosmetic — the atlas re-sorts by what it measures. */
export const RAMPS: Record<string, string> = {
  classic: ' .:-=+*#%@',
  blocks: ' ░▒▓█',
  shades: ' ▁▂▃▄▅▆▇█',
  minimal: ' .:*#',
  dots: ' ·:⁛⁘⁙▪■',
  binary: ' 01',
  terminal:
    ' .\'`^",:;Il!i~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
}

const EDGE_GLYPHS = '-/|\\'

export const ASCII_PARAMS: Array<ParamSpec> = [
  {
    kind: 'select',
    key: 'ramp',
    label: 'Ramp',
    default: 'classic',
    options: [
      { value: 'classic', label: 'Classic' },
      { value: 'blocks', label: 'Blocks' },
      { value: 'shades', label: 'Shades' },
      { value: 'minimal', label: 'Min' },
      { value: 'dots', label: 'Dots' },
      { value: 'binary', label: '01' },
      { value: 'terminal', label: 'Full' },
      { value: 'custom', label: 'Custom' },
    ],
  },
  {
    kind: 'text',
    key: 'custom',
    label: 'Custom ramp',
    default: ' .:-=+*#%@',
    placeholder: 'lightest → darkest',
    maxLength: 128,
  },
  {
    kind: 'slider',
    key: 'cellSize',
    label: 'Cell width',
    min: 3,
    max: 40,
    step: 1,
    default: 8,
    spatial: true,
    unit: 'px',
  },
  {
    kind: 'slider',
    key: 'aspect',
    label: 'Cell aspect',
    min: 1,
    max: 3,
    step: 0.05,
    default: 2,
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
  {
    kind: 'slider',
    key: 'edges',
    label: 'Edges',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.3,
  },
  {
    kind: 'select',
    key: 'mode',
    label: 'Colour',
    default: 'duotone',
    options: [
      { value: 'mono', label: 'Mono' },
      { value: 'duotone', label: 'Duo' },
      { value: 'source', label: 'Source' },
    ],
  },
  {
    kind: 'palette',
    key: 'palette',
    label: 'Palette',
    default: ['#050505', '#f5f5f5'],
  },
  { kind: 'toggle', key: 'invert', label: 'Invert', default: false },
]

export function rampFor(params: Params): string {
  const choice = str(params, 'ramp', 'classic')
  if (choice === 'custom') {
    const custom = str(params, 'custom', RAMPS.classic)
    // A one-character ramp cannot express tone; fall back rather than divide
    // by zero downstream.
    return [...custom].length >= 2 ? custom : RAMPS.classic
  }
  return RAMPS[choice] ?? RAMPS.classic
}

interface Cell {
  tone: number
  r: number
  g: number
  b: number
  edge: number
  angle: number
}

/**
 * Reduce the image to one sample per character cell.
 *
 * Averaging in linear light is the physically correct downsample, and the mean
 * colour is kept so `source` mode can ink each glyph with the colour of what it
 * replaced.
 */
function sampleCells(
  buffer: PixelBuffer,
  cellWidth: number,
  cellHeight: number,
): { cells: Array<Cell>; cols: number; rows: number } {
  const { width, height, data } = buffer
  const cols = Math.ceil(width / cellWidth)
  const rows = Math.ceil(height / cellHeight)
  const cells: Array<Cell> = new Array(cols * rows)

  for (let row = 0; row < rows; row++) {
    const maxY = Math.min((row + 1) * cellHeight, height)

    for (let col = 0; col < cols; col++) {
      const maxX = Math.min((col + 1) * cellWidth, width)
      let tone = 0
      let r = 0
      let g = 0
      let b = 0
      let count = 0

      for (let y = row * cellHeight; y < maxY; y++) {
        for (let x = col * cellWidth; x < maxX; x++) {
          const i = (y * width + x) * 4
          tone += luma(buffer, i)
          r += data[i]
          g += data[i + 1]
          b += data[i + 2]
          count++
        }
      }

      count = count || 1
      cells[row * cols + col] = {
        tone: tone / count,
        r: r / count,
        g: g / count,
        b: b / count,
        edge: 0,
        angle: 0,
      }
    }
  }

  // Sobel over the cell grid rather than the pixel grid: the glyph is chosen
  // per cell, so that is the resolution the edge decision needs.
  const at = (col: number, row: number) =>
    cells[
      Math.min(rows - 1, Math.max(0, row)) * cols +
        Math.min(cols - 1, Math.max(0, col))
    ].tone

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const gx =
        at(col + 1, row - 1) +
        2 * at(col + 1, row) +
        at(col + 1, row + 1) -
        (at(col - 1, row - 1) + 2 * at(col - 1, row) + at(col - 1, row + 1))
      const gy =
        at(col - 1, row + 1) +
        2 * at(col, row + 1) +
        at(col + 1, row + 1) -
        (at(col - 1, row - 1) + 2 * at(col, row - 1) + at(col + 1, row - 1))

      const cell = cells[row * cols + col]
      cell.edge = Math.hypot(gx, gy)
      cell.angle = Math.atan2(gy, gx)
    }
  }

  return { cells, cols, rows }
}

/** Pick `- / | \` from the gradient direction, quantized to four bands. */
function edgeGlyphFor(angle: number): string {
  // The edge *runs* perpendicular to the gradient, hence the quarter turn.
  const along = angle + Math.PI / 2
  const normalized = ((along % Math.PI) + Math.PI) % Math.PI
  const band = Math.round(normalized / (Math.PI / 4)) % 4
  return EDGE_GLYPHS[band]
}

/**
 * The pure core: paint an already-built atlas over the buffer.
 *
 * Separated from `applyAscii` so the mapping can be tested against a synthetic
 * atlas, without a canvas and without depending on which fonts a machine has.
 */
export function renderAscii(
  buffer: PixelBuffer,
  atlas: GlyphAtlas,
  options: {
    contrast: number
    edges: number
    invert: boolean
    mode: string
    ink: { r: number; g: number; b: number }
    ground: { r: number; g: number; b: number }
  },
): PixelBuffer {
  const { width, height, data } = buffer
  const { cellWidth, cellHeight, glyphs } = atlas
  if (glyphs.length === 0) return buffer

  const { cells, cols, rows } = sampleCells(buffer, cellWidth, cellHeight)

  const byChar = new Map(glyphs.map((glyph) => [glyph.char, glyph]))
  const factor = (1 + options.contrast) ** 2
  const last = glyphs.length - 1

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cell = cells[row * cols + col]

      let tone = (cell.tone - 0.5) * factor + 0.5
      tone = Math.max(0, Math.min(1, tone))
      if (options.invert) tone = 1 - tone

      let glyph = glyphs[Math.round(tone * last)]

      // Edge override: only where the gradient is strong enough, and only if
      // the directional character exists in this atlas.
      //
      // The scale matters more than it looks. A Sobel over a 0..1 tone field
      // maxes out near 5.7, and ordinary grain sits around 0.5–1.5 — so a
      // threshold near 1 fires on almost every cell and the image drowns in
      // slashes. Mapping the control across 0.3..4.3 keeps it picking out
      // genuine contours at usable settings.
      if (options.edges > 0 && cell.edge > (1 - options.edges) * 4 + 0.3) {
        const candidate = byChar.get(edgeGlyphFor(cell.angle))
        if (candidate) glyph = candidate
      }

      const inkR = options.mode === 'source' ? cell.r : options.ink.r
      const inkG = options.mode === 'source' ? cell.g : options.ink.g
      const inkB = options.mode === 'source' ? cell.b : options.ink.b

      const maxY = Math.min((row + 1) * cellHeight, height)
      const maxX = Math.min((col + 1) * cellWidth, width)

      for (let y = row * cellHeight; y < maxY; y++) {
        const gy = y - row * cellHeight
        for (let x = col * cellWidth; x < maxX; x++) {
          const coverage = glyph.bitmap[gy * cellWidth + (x - col * cellWidth)]
          const i = (y * width + x) * 4
          data[i] = options.ground.r + (inkR - options.ground.r) * coverage
          data[i + 1] = options.ground.g + (inkG - options.ground.g) * coverage
          data[i + 2] = options.ground.b + (inkB - options.ground.b) * coverage
        }
      }
    }
  }

  return buffer
}

export function applyAscii(
  buffer: PixelBuffer,
  params: Params,
  env: RenderEnv,
): PixelBuffer {
  const cellWidth = scaled(num(params, 'cellSize', 8), env, 2)
  const cellHeight = Math.max(
    2,
    Math.round(cellWidth * Math.max(1, num(params, 'aspect', 2))),
  )

  const mode = str(params, 'mode', 'duotone')
  const edges = num(params, 'edges', 0.35)

  // The directional characters have to be in the atlas to be selectable, so
  // they are appended when edge detection is on. They still take part in the
  // coverage sort, which is correct — they are ordinary glyphs.
  const characters = rampFor(params) + (edges > 0 ? EDGE_GLYPHS : '')
  const atlas = getAtlas(characters, cellWidth, cellHeight)

  const toLinear = (hex: string) => {
    const { r, g, b } = hexToRgb(hex)
    return {
      r: fromPerceptual(r / 255),
      g: fromPerceptual(g / 255),
      b: fromPerceptual(b / 255),
    }
  }

  // Chosen by lightness rather than position: the last palette entry is an
  // accent, so taking the ends directly picks the wrong ink.
  const ends = paletteExtremes(list(params, 'palette', ['#050505', '#f5f5f5']))
  const ground = mode === 'mono' ? { r: 0, g: 0, b: 0 } : toLinear(ends.dark)
  const ink = mode === 'mono' ? { r: 1, g: 1, b: 1 } : toLinear(ends.light)

  return renderAscii(buffer, atlas, {
    contrast: num(params, 'contrast', 0),
    edges,
    invert: bool(params, 'invert', false),
    mode,
    ink,
    ground,
  })
}
