/**
 * The bundled typefaces.
 *
 * Text layers used to draw in whatever `system-ui` and `Impact` resolved to,
 * which meant the artwork's most legible element was the one thing that looked
 * like a default. These ten faces ship with the app instead: the same bytes
 * render on every machine, so a shared recipe reproduces the image rather than
 * approximating it, and the export matches the preview.
 *
 * All ten are SIL Open Font License, latin subset only — the whole set is
 * ~150KB, less than a single photograph, and they are fetched once and cached
 * by the browser like any other asset.
 *
 * Registered at runtime rather than through CSS `@font-face` because the
 * renderer draws inside a worker, where there is no stylesheet: a face has to
 * be added to that worker's own `FontFaceSet` before `ctx.font` can name it.
 */

export interface BundledFont {
  id: string
  label: string
  /** Family name the canvas asks for, and the one the face registers under. */
  family: string
  weight: number
  /**
   * Drawn with until the face resolves, and in node where there is no canvas.
   * Never empty: a missing face has to degrade to *something* shaped roughly
   * like the real one, or a slow network silently reflows every layout.
   */
  fallback: string
  /** Grouping for the picker, and what remix uses to stay in a register. */
  category: 'display' | 'serif' | 'grotesk' | 'mono' | 'pixel'
  url: string
}

export const FONTS: Array<BundledFont> = [
  {
    id: 'anton',
    label: 'Anton',
    family: 'Anton',
    weight: 400,
    fallback: '"Arial Narrow", Impact, sans-serif',
    category: 'display',
    url: new URL('../assets/fonts/anton.woff2', import.meta.url).href,
  },
  {
    id: 'archivo-black',
    label: 'Archivo Black',
    family: 'Archivo Black',
    weight: 400,
    fallback: '"Arial Black", Helvetica, sans-serif',
    category: 'grotesk',
    url: new URL('../assets/fonts/archivo-black.woff2', import.meta.url).href,
  },
  {
    id: 'syne',
    label: 'Syne',
    family: 'Syne',
    weight: 800,
    fallback: 'Helvetica, sans-serif',
    category: 'display',
    url: new URL('../assets/fonts/syne-extrabold.woff2', import.meta.url).href,
  },
  {
    id: 'bricolage',
    label: 'Bricolage',
    family: 'Bricolage Grotesque',
    weight: 800,
    fallback: 'Helvetica, sans-serif',
    category: 'grotesk',
    url: new URL('../assets/fonts/bricolage-extrabold.woff2', import.meta.url)
      .href,
  },
  {
    id: 'alfa-slab',
    label: 'Alfa Slab',
    family: 'Alfa Slab One',
    weight: 400,
    fallback: 'Rockwell, Georgia, serif',
    category: 'display',
    url: new URL('../assets/fonts/alfa-slab-one.woff2', import.meta.url).href,
  },
  {
    id: 'instrument-serif',
    label: 'Instrument',
    family: 'Instrument Serif',
    weight: 400,
    fallback: 'Georgia, "Times New Roman", serif',
    category: 'serif',
    url: new URL('../assets/fonts/instrument-serif.woff2', import.meta.url)
      .href,
  },
  {
    id: 'bodoni',
    label: 'Bodoni',
    family: 'Bodoni Moda',
    weight: 700,
    fallback: '"Didot", Georgia, serif',
    category: 'serif',
    url: new URL('../assets/fonts/bodoni-moda-bold.woff2', import.meta.url)
      .href,
  },
  {
    id: 'dm-serif',
    label: 'DM Serif',
    family: 'DM Serif Display',
    weight: 400,
    fallback: 'Georgia, serif',
    category: 'serif',
    url: new URL('../assets/fonts/dm-serif-display.woff2', import.meta.url)
      .href,
  },
  {
    id: 'space-mono',
    label: 'Space Mono',
    family: 'Space Mono',
    weight: 700,
    fallback: '"SFMono-Regular", Consolas, monospace',
    category: 'mono',
    url: new URL('../assets/fonts/space-mono-bold.woff2', import.meta.url).href,
  },
  {
    id: 'vt323',
    label: 'VT323',
    family: 'VT323',
    weight: 400,
    fallback: '"Courier New", monospace',
    category: 'pixel',
    url: new URL('../assets/fonts/vt323.woff2', import.meta.url).href,
  },
]

export const DEFAULT_FONT = 'anton'

export function fontById(id: string): BundledFont {
  return FONTS.find((font) => font.id === id) ?? FONTS[0]
}

/** The `ctx.font` shorthand for a face at a size, fallback stack included. */
export function fontShorthand(id: string, sizePx: number): string {
  const font = fontById(id)
  return `${font.weight} ${sizePx}px "${font.family}", ${font.fallback}`
}

/** The CSS `font-family` for showing a face in the UI. */
export function fontFamilyCss(id: string): string {
  const font = fontById(id)
  return `"${font.family}", ${font.fallback}`
}

type FaceSet = { add: (face: FontFace) => void }

function faceSet(): FaceSet | null {
  const scope = globalThis as {
    fonts?: FaceSet
    document?: { fonts?: FaceSet }
  }
  // Worker scope carries `self.fonts`; the window carries `document.fonts`.
  // Node has neither, which is the case `null` exists for.
  return scope.fonts ?? scope.document?.fonts ?? null
}

let loading: Promise<void> | null = null

/**
 * Load every bundled face into whichever scope is calling, once.
 *
 * Idempotent and memoized because every render path awaits it — the worker
 * before each frame, the thumbnails before each miniature — and none of them
 * should pay for it twice. A face that fails to load is swallowed rather than
 * rejected: one missing file should cost that layer its typeface, not the
 * whole render.
 */
export function ensureFonts(): Promise<void> {
  if (loading) return loading

  const target = faceSet()
  if (!target || typeof FontFace === 'undefined') {
    loading = Promise.resolve()
    return loading
  }

  loading = Promise.all(
    FONTS.map(async (font) => {
      try {
        const face = new FontFace(font.family, `url(${font.url})`, {
          weight: String(font.weight),
        })
        await face.load()
        target.add(face)
      } catch {
        // Falls back to the stack in `font.fallback`.
      }
    }),
  ).then(() => undefined)

  return loading
}
