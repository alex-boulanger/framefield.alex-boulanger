import { srgbToLinear } from '../../buffer'
import { hexToRgb } from '../../palettes'

/**
 * Palette access for the text layers.
 *
 * Indices wrap rather than clamp. A recipe authored against a six-colour
 * palette that later gets cut to three should keep rendering, and wrapping
 * keeps the choices distinct where clamping would collapse them all onto the
 * last swatch.
 */
export function swatchAt(colors: ReadonlyArray<string>, index: number): string {
  if (colors.length === 0) return '#ffffff'
  const wrapped = ((Math.round(index) % colors.length) + colors.length) %
    colors.length
  return colors[wrapped]
}

export interface LinearRgb {
  r: number
  g: number
  b: number
}

/** A swatch in the linear light the pipeline composites in. */
export function linearRgb(hex: string): LinearRgb {
  const { r, g, b } = hexToRgb(hex)
  return {
    r: srgbToLinear(r / 255),
    g: srgbToLinear(g / 255),
    b: srgbToLinear(b / 255),
  }
}
