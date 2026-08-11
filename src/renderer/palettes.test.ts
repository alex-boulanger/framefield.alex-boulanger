import { describe, expect, it } from 'vitest'
import { hexToRgb, PALETTES } from './palettes'

describe('hexToRgb', () => {
  it('parses six-digit hex', () => {
    expect(hexToRgb('#0057ff')).toEqual({ r: 0, g: 0x57, b: 0xff })
  })

  it('expands three-digit shorthand', () => {
    expect(hexToRgb('#f0a')).toEqual({ r: 255, g: 0, b: 170 })
  })

  it('tolerates a missing hash', () => {
    expect(hexToRgb('050505')).toEqual({ r: 5, g: 5, b: 5 })
  })

  it('handles the extremes', () => {
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 })
    expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 })
  })
})

describe('PALETTES', () => {
  it('are all valid hex and non-empty', () => {
    for (const palette of PALETTES) {
      expect(palette.colors.length).toBeGreaterThan(0)
      for (const color of palette.colors) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })

  it('have unique ids', () => {
    const ids = PALETTES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('are authored darkest-first, which the ramp assumes', () => {
    for (const palette of PALETTES) {
      const first = hexToRgb(palette.colors[0])
      const second = hexToRgb(palette.colors[1])
      expect(first.r + first.g + first.b).toBeLessThan(
        second.r + second.g + second.b,
      )
    }
  })
})
