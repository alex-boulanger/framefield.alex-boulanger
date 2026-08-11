import { describe, expect, it } from 'vitest'
import { applyAscii, ASCII_PARAMS, RAMPS, rampFor, renderAscii } from './ascii'
import { defaultParams } from '../params'
import { buildAtlas } from '../glyphAtlas'
import type { GlyphAtlas } from '../glyphAtlas'
import { createBuffer } from '../buffer'
import { env, gradient, meanLuminance, pixel, solid } from '#/test/helpers'

const base = () => defaultParams(ASCII_PARAMS)

/**
 * A synthetic atlas with known bitmaps.
 *
 * Real glyph rasterization needs a canvas and depends on which fonts a machine
 * has installed, neither of which belongs in a unit test. Injecting an atlas
 * tests the part that matters — tone to glyph, cell layout, colour, edges —
 * against bitmaps whose coverage is exactly known.
 */
function syntheticAtlas(
  cellWidth = 2,
  cellHeight = 2,
  chars = [' ', '-', '/', '|', '\\', '#'],
): GlyphAtlas {
  const area = cellWidth * cellHeight
  return {
    cellWidth,
    cellHeight,
    glyphs: chars.map((char, index) => {
      const coverage = index / (chars.length - 1)
      return {
        char,
        coverage,
        bitmap: new Float32Array(area).fill(coverage),
      }
    }),
  }
}

const BLACK = { r: 0, g: 0, b: 0 }
const WHITE = { r: 1, g: 1, b: 1 }

const options = (
  overrides: Partial<Parameters<typeof renderAscii>[2]> = {},
) => ({
  contrast: 0,
  edges: 0,
  invert: false,
  mode: 'mono',
  ink: WHITE,
  ground: BLACK,
  ...overrides,
})

describe('rampFor', () => {
  it('returns the named premade ramp', () => {
    expect(rampFor({ ramp: 'blocks' })).toBe(RAMPS.blocks)
    expect(rampFor({ ramp: 'binary' })).toBe(RAMPS.binary)
  })

  it('falls back for an unknown name', () => {
    expect(rampFor({ ramp: 'nope' })).toBe(RAMPS.classic)
  })

  it('uses the custom string when custom is selected', () => {
    expect(rampFor({ ramp: 'custom', custom: 'abc' })).toBe('abc')
  })

  it('rejects a custom ramp too short to express tone', () => {
    // One character cannot carry a gradient, and it would divide by zero when
    // mapping tone onto the ramp.
    expect(rampFor({ ramp: 'custom', custom: 'x' })).toBe(RAMPS.classic)
    expect(rampFor({ ramp: 'custom', custom: '' })).toBe(RAMPS.classic)
  })

  it('accepts multi-byte characters as single glyphs', () => {
    // `[...str]` rather than `.length`, so block and braille ramps count right.
    expect(rampFor({ ramp: 'custom', custom: '░▒' })).toBe('░▒')
  })

  it('has at least two glyphs in every premade ramp', () => {
    for (const [name, ramp] of Object.entries(RAMPS)) {
      expect([...ramp].length, name).toBeGreaterThan(1)
    }
  })
})

describe('renderAscii', () => {
  it('maps dark cells to light glyphs and bright cells to heavy ones', () => {
    const atlas = syntheticAtlas()
    const dark = solid(8, 8, 0, 0, 0)
    const bright = solid(8, 8, 1, 1, 1)

    renderAscii(dark, atlas, options())
    renderAscii(bright, atlas, options())

    // The lightest glyph has zero coverage, so a dark cell stays ground.
    expect(meanLuminance(dark)).toBeCloseTo(0, 5)
    expect(meanLuminance(bright)).toBeCloseTo(1, 5)
  })

  it('tracks tone monotonically', () => {
    const atlas = syntheticAtlas()
    const tones = [0, 0.25, 0.5, 0.75, 1].map((value) => {
      const buffer = solid(8, 8, value, value, value)
      renderAscii(buffer, atlas, options())
      return meanLuminance(buffer)
    })

    for (let i = 1; i < tones.length; i++) {
      expect(tones[i]).toBeGreaterThanOrEqual(tones[i - 1])
    }
  })

  it('paints in cells of the atlas size', () => {
    const atlas = syntheticAtlas(4, 8)
    const buffer = gradient(32, 32)
    renderAscii(buffer, atlas, options())

    // Every pixel in a cell shares the glyph's coverage at that position; with
    // uniform synthetic bitmaps the whole cell is one value.
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const anchor = pixel(buffer, x - (x % 4), y - (y % 8))
        expect(pixel(buffer, x, y)[0]).toBeCloseTo(anchor[0], 6)
      }
    }
  })

  it('inverts', () => {
    const atlas = syntheticAtlas()
    const normal = solid(8, 8, 0.9, 0.9, 0.9)
    const inverted = solid(8, 8, 0.9, 0.9, 0.9)

    renderAscii(normal, atlas, options())
    renderAscii(inverted, atlas, options({ invert: true }))

    expect(meanLuminance(inverted)).toBeLessThan(meanLuminance(normal))
  })

  it('inks with the palette in duotone mode', () => {
    const atlas = syntheticAtlas()
    const buffer = solid(4, 4, 1, 1, 1)
    renderAscii(
      buffer,
      atlas,
      options({ mode: 'duotone', ink: { r: 1, g: 0, b: 0 }, ground: BLACK }),
    )
    expect(pixel(buffer, 0, 0)).toEqual([1, 0, 0, 1])
  })

  it('inks with the source colour in source mode', () => {
    const atlas = syntheticAtlas()
    const buffer = solid(4, 4, 0.2, 0.8, 0.4)
    renderAscii(buffer, atlas, options({ mode: 'source' }))

    // The heaviest glyph is fully covered, so the cell takes the mean colour
    // of what it replaced rather than the palette ink.
    const [r, g, b] = pixel(buffer, 0, 0)
    expect(g).toBeGreaterThan(r)
    expect(g).toBeGreaterThan(b)
  })

  it('substitutes a directional glyph on a strong edge', () => {
    const atlas = syntheticAtlas()
    // Vertical seam: left half black, right half white.
    const buffer = createBuffer(16, 16)
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const value = x < 8 ? 0 : 1
        const i = (y * 16 + x) * 4
        buffer.data[i] = value
        buffer.data[i + 1] = value
        buffer.data[i + 2] = value
        buffer.data[i + 3] = 1
      }
    }

    const withEdges = { ...buffer, data: new Float32Array(buffer.data) }
    renderAscii(buffer, atlas, options({ edges: 0 }))
    renderAscii(withEdges, atlas, options({ edges: 1 }))

    expect(Array.from(withEdges.data)).not.toEqual(Array.from(buffer.data))
  })

  it('leaves a flat field free of edge glyphs', () => {
    // No gradient means no edges, so enabling detection must change nothing.
    const atlas = syntheticAtlas()
    const plain = solid(16, 16, 0.5, 0.5, 0.5)
    const edged = solid(16, 16, 0.5, 0.5, 0.5)

    renderAscii(plain, atlas, options({ edges: 0 }))
    renderAscii(edged, atlas, options({ edges: 1 }))

    expect(Array.from(edged.data)).toEqual(Array.from(plain.data))
  })

  it('spreads tone further with contrast', () => {
    const atlas = syntheticAtlas()
    const flat = gradient(32, 32)
    const punchy = gradient(32, 32)

    renderAscii(flat, atlas, options({ contrast: 0 }))
    renderAscii(punchy, atlas, options({ contrast: 0.9 }))

    expect(Array.from(punchy.data)).not.toEqual(Array.from(flat.data))
  })

  it('leaves alpha untouched', () => {
    const buffer = gradient(16, 16)
    renderAscii(buffer, syntheticAtlas(), options())
    for (let i = 3; i < buffer.data.length; i += 4) {
      expect(buffer.data[i]).toBe(1)
    }
  })
})

describe('buildAtlas without a canvas', () => {
  it('still returns one glyph per character', () => {
    // node has no canvas, so this exercises the documented fallback.
    const atlas = buildAtlas(' .:#', 4, 8)
    expect(atlas.glyphs.map((g) => g.char)).toEqual([' ', '.', ':', '#'])
    expect(atlas.cellWidth).toBe(4)
    expect(atlas.cellHeight).toBe(8)
  })

  it('orders coverage ascending', () => {
    const atlas = buildAtlas(' .:#', 4, 8)
    for (let i = 1; i < atlas.glyphs.length; i++) {
      expect(atlas.glyphs[i].coverage).toBeGreaterThanOrEqual(
        atlas.glyphs[i - 1].coverage,
      )
    }
  })

  it('handles an empty ramp without throwing', () => {
    expect(() => buildAtlas('', 4, 4)).not.toThrow()
    expect(buildAtlas('', 4, 4).glyphs).toHaveLength(1)
  })

  it('counts multi-byte characters as single glyphs', () => {
    expect(buildAtlas('░▒▓█', 4, 4).glyphs).toHaveLength(4)
  })
})

describe('applyAscii', () => {
  it('runs end to end and quantizes the image into cells', () => {
    const buffer = gradient(64, 64)
    applyAscii(buffer, { ...base(), cellSize: 8, aspect: 2 }, env(buffer))
    // 8 wide, 16 tall.
    for (let x = 0; x < 64; x++) {
      expect(pixel(buffer, x, 0)[0]).toBeCloseTo(pixel(buffer, x, 15)[0], 6)
    }
  })

  it('scales the cell with the render scale', () => {
    const full = gradient(64, 64)
    const half = gradient(64, 64)
    applyAscii(full, { ...base(), cellSize: 8 }, env(full, 1))
    applyAscii(half, { ...base(), cellSize: 8 }, env(half, 0.5))
    expect(Array.from(full.data)).not.toEqual(Array.from(half.data))
  })

  it('accepts a custom ramp', () => {
    const buffer = gradient(32, 32)
    expect(() =>
      applyAscii(
        buffer,
        { ...base(), ramp: 'custom', custom: ' .oO@' },
        env(buffer),
      ),
    ).not.toThrow()
  })

  it('is deterministic', () => {
    const a = gradient(48, 48)
    const b = gradient(48, 48)
    applyAscii(a, base(), env(a))
    applyAscii(b, base(), env(b))
    expect(Array.from(a.data)).toEqual(Array.from(b.data))
  })
})
