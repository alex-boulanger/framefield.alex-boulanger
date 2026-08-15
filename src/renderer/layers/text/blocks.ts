import { createBuffer } from '../../buffer'
import { layoutText } from './layout'
import { linearRgb, swatchAt } from './colors'
import type { Measure } from './layout'
import type { RasterResult } from './raster'
import type { TextSettings } from './settings'

/**
 * The text box without a canvas: every glyph as a solid block.
 *
 * This is what node sees. It exists so the pipeline has no branch that only
 * runs in a browser — `renderRecipe` on a text stack returns real pixels in a
 * plain vitest run, the compositor can be tested against them, and a text
 * layer in a share link never renders as a hole.
 *
 * It goes through the same `layoutText` as the real rasterizer, so what it
 * approximates is only the *shape* of each glyph, never where the glyphs are:
 * wrapping, fitting, justification and jitter are all exercised for real.
 */

/**
 * Advance widths with no font to ask.
 *
 * Three buckets from the ratios a display face actually holds — narrow
 * letters, wide letters, everything else. Crude on purpose: the point is that
 * a wrapped line breaks in a plausible place, not that it matches Anton.
 */
const NARROW = new Set([...'ijltfr.,:;\'"!|()[]{} '])
const WIDE = new Set([...'mwMW@%'])

export const approximateMeasure: Measure = (text, size) => {
  let total = 0
  for (const char of text) {
    if (char === ' ') total += size * 0.26
    else if (NARROW.has(char)) total += size * 0.32
    else if (WIDE.has(char)) total += size * 0.86
    else total += size * 0.58
  }
  return total
}

export function rasterizeBlocks(settings: TextSettings): RasterResult {
  const width = Math.max(1, Math.round(settings.boxWidth + settings.margin * 2))
  const height = Math.max(
    1,
    Math.round(settings.boxHeight + settings.margin * 2),
  )
  const buffer = createBuffer(width, height)
  const layout = layoutText(settings, approximateMeasure)
  const data = buffer.data

  const paint = (
    left: number,
    top: number,
    boxWidth: number,
    boxHeight: number,
    hex: string,
  ) => {
    const { r, g, b } = linearRgb(hex)
    const x0 = Math.max(0, Math.floor(left))
    const x1 = Math.min(width, Math.ceil(left + boxWidth))
    const y0 = Math.max(0, Math.floor(top))
    const y1 = Math.min(height, Math.ceil(top + boxHeight))

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const index = (y * width + x) * 4
        data[index] = r
        data[index + 1] = g
        data[index + 2] = b
        data[index + 3] = 1
      }
    }
  }

  // A block glyph is the em box less its sidebearings and less the space a
  // descender-free cap leaves under the baseline.
  const blockFor = (glyph: (typeof layout.glyphs)[number]) => ({
    left: glyph.x + glyph.size * 0.06,
    top: glyph.y + glyph.size * 0.16,
    width:
      (approximateMeasure(glyph.char, glyph.size) - glyph.size * 0.12) *
      glyph.scaleX,
    height: glyph.size * 0.68,
  })

  const radians = (settings.depthAngle * Math.PI) / 180
  const throwX = Math.cos(radians) * settings.depthSize
  const throwY = Math.sin(radians) * settings.depthSize
  const copies =
    settings.depth === 'off'
      ? 0
      : settings.depth === 'echo'
        ? Math.max(1, Math.round(settings.echoCount))
        : 1

  for (let copy = copies; copy >= 1; copy--) {
    const hex = swatchAt(
      settings.palette,
      settings.depthInk + (settings.echoCycle ? copy : 0),
    )
    for (const glyph of layout.glyphs) {
      const block = blockFor(glyph)
      paint(
        block.left + throwX * copy,
        block.top + throwY * copy,
        block.width,
        block.height,
        hex,
      )
    }
  }

  for (const glyph of layout.glyphs) {
    const block = blockFor(glyph)
    paint(
      block.left,
      block.top,
      block.width,
      block.height,
      swatchAt(settings.palette, settings.ink + glyph.inkOffset),
    )
  }

  return { buffer, layout }
}
