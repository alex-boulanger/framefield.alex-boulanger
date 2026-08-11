export interface Palette {
  id: string
  name: string
  colors: Array<string>
}

/**
 * Small curated set. Randomize pulls from these rather than from random hues,
 * which is what keeps "remix produces consistently usable results" true.
 */
export const PALETTES: Array<Palette> = [
  { id: 'ink', name: 'Ink', colors: ['#050505', '#f5f5f5', '#0057ff'] },
  { id: 'riso', name: 'Riso', colors: ['#1a1a1a', '#fff1e5', '#ff4a3d'] },
  { id: 'acid', name: 'Acid', colors: ['#0b0f00', '#eaff00', '#00c2a8'] },
  { id: 'bone', name: 'Bone', colors: ['#12100e', '#e8e0d4', '#a4907c'] },
  { id: 'cobalt', name: 'Cobalt', colors: ['#04070f', '#dce6ff', '#2b4bff'] },
  { id: 'ember', name: 'Ember', colors: ['#100604', '#ffd7b0', '#ff5c1a'] },
  { id: 'plasma', name: 'Plasma', colors: ['#0a0014', '#ffe0f7', '#ff2e9a'] },
  { id: 'mono', name: 'Mono', colors: ['#000000', '#ffffff'] },
]

export interface Rgb {
  r: number
  g: number
  b: number
}

/**
 * Parse a swatch into 0..255 sRGB components.
 *
 * Ramp construction and tone mapping moved into `buffer.ts` and the generator
 * when the pipeline went linear — the palette module's only remaining job is
 * turning authored hex into numbers.
 */
export function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '')
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean
  const value = Number.parseInt(full, 16)
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  }
}
