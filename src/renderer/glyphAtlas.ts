/**
 * Glyph rasterization for the ASCII effect.
 *
 * The difference between cheap ASCII art and good ASCII art is mostly here: the
 * ramp must be ordered by how much ink each character actually puts on the page
 * *in the font being used at the size being used*. Hand-ordered strings are
 * guesses — `%` and `#` swap places between fonts, `@` is not always the
 * heaviest, and a user's custom ramp may be in no order at all. Measuring
 * removes the guess and makes any input string work.
 *
 * This is the second and last place in the renderer that touches a canvas
 * (image import is the other). Everything downstream consumes the atlas as
 * plain arrays, so the effect itself stays pure and testable.
 */

export interface Glyph {
  char: string
  /** Mean ink coverage, 0..1. */
  coverage: number
  /** Per-pixel coverage, `cellWidth * cellHeight`, row-major. */
  bitmap: Float32Array
}

export interface GlyphAtlas {
  cellWidth: number
  cellHeight: number
  /** Ascending by measured coverage — index 0 is the lightest. */
  glyphs: Array<Glyph>
}

const FONT_STACK =
  "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace"

function createCanvas(width: number, height: number) {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height)
  }
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/**
 * Uniform-fill stand-in used when no canvas exists (node, tests).
 *
 * Coverage is taken as the character's position in the ramp, which is true by
 * definition once the ramp is sorted. The result is a tone mosaic rather than
 * letterforms — structurally correct, so the mapping logic still runs, but it
 * is not what a browser produces and no visual claim should rest on it.
 */
function fallbackAtlas(
  chars: Array<string>,
  cellWidth: number,
  cellHeight: number,
): GlyphAtlas {
  return {
    cellWidth,
    cellHeight,
    glyphs: chars.map((char, index) => {
      const coverage = chars.length > 1 ? index / (chars.length - 1) : 0
      return {
        char,
        coverage,
        bitmap: new Float32Array(cellWidth * cellHeight).fill(coverage),
      }
    }),
  }
}

/**
 * Rasterize each character into its own cell and measure the ink.
 *
 * All glyphs are drawn into one strip and read back in a single `getImageData`
 * call — a read per glyph would dominate the cost for a long ramp.
 */
export function buildAtlas(
  characters: string,
  cellWidth: number,
  cellHeight: number,
): GlyphAtlas {
  const chars = [...characters]
  if (chars.length === 0) return fallbackAtlas([' '], cellWidth, cellHeight)

  const canvas = createCanvas(cellWidth * chars.length, cellHeight)
  if (!canvas) return fallbackAtlas(chars, cellWidth, cellHeight)

  const ctx = canvas.getContext('2d', {
    willReadFrequently: true,
  }) as CanvasRenderingContext2D | null
  if (!ctx) return fallbackAtlas(chars, cellWidth, cellHeight)

  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, cellWidth * chars.length, cellHeight)
  // Size to the cell height and let the glyph overflow horizontally if the
  // font is wide; clipping a descender is less objectionable than shrinking
  // every character to fit the widest one.
  ctx.font = `${cellHeight}px ${FONT_STACK}`
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  chars.forEach((char, index) => {
    ctx.fillText(char, index * cellWidth + cellWidth / 2, cellHeight / 2)
  })

  const image = ctx.getImageData(0, 0, cellWidth * chars.length, cellHeight)
  const stripWidth = cellWidth * chars.length

  const glyphs = chars.map((char, index) => {
    const bitmap = new Float32Array(cellWidth * cellHeight)
    let total = 0

    for (let y = 0; y < cellHeight; y++) {
      for (let x = 0; x < cellWidth; x++) {
        // Red channel is enough: the text was drawn pure white on black, so
        // every channel carries the same antialiased coverage.
        const value =
          image.data[(y * stripWidth + index * cellWidth + x) * 4] / 255
        bitmap[y * cellWidth + x] = value
        total += value
      }
    }

    return { char, coverage: total / (cellWidth * cellHeight), bitmap }
  })

  // Sort by what was measured, not by how the string was typed.
  glyphs.sort((a, b) => a.coverage - b.coverage)

  return { cellWidth, cellHeight, glyphs }
}

const CACHE = new Map<string, GlyphAtlas>()

/** Atlases are deterministic in their inputs, so they are built once and kept. */
export function getAtlas(
  characters: string,
  cellWidth: number,
  cellHeight: number,
): GlyphAtlas {
  const key = `${characters}|${cellWidth}x${cellHeight}`
  let atlas = CACHE.get(key)

  if (!atlas) {
    atlas = buildAtlas(characters, cellWidth, cellHeight)
    // A long ramp at a large cell size is a real amount of memory; keep the
    // cache small rather than unbounded.
    if (CACHE.size > 24) CACHE.clear()
    CACHE.set(key, atlas)
  }

  return atlas
}
