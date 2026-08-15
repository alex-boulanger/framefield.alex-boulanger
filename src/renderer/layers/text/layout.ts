import { createRng } from '../../rng'

/**
 * Where every glyph goes, decided without touching a canvas.
 *
 * Layout is separated from rasterization so the two hard parts stay apart: the
 * typography (wrapping, fitting, justification, jitter) is arithmetic that can
 * be tested in node, and the drawing is a dumb loop over the result. It is
 * also what lets the same layout drive three different rasterizers — the
 * canvas one, the block-glyph fallback where there is no canvas, and the 3D
 * layer's coverage mask.
 *
 * Everything here is in *device pixels of the text box*, origin at the box's
 * top-left corner. The caller has already multiplied by the render scale, so
 * layout never has to know what resolution it is working at.
 */

/** Advance width of a string at a font size. Supplied by the rasterizer. */
export type Measure = (text: string, fontPx: number) => number

export interface GlyphPlacement {
  char: string
  /** Left edge of the advance box. */
  x: number
  /** Top edge of the em box — glyphs are drawn with `textBaseline: 'top'`. */
  y: number
  size: number
  /** Radians, about the glyph's own centre. */
  rotate: number
  /** Horizontal scale, used by flush-justified lines. */
  scaleX: number
  /**
   * Palette index offset for this glyph, before the layer's ink index is
   * added. Zero for every glyph unless per-glyph colour chaos is on.
   */
  inkOffset: number
}

export interface TextLayout {
  glyphs: Array<GlyphPlacement>
  /** Union of the laid-out lines, before jitter. */
  blockWidth: number
  blockHeight: number
  /** The size lines were actually set at, after fitting. */
  size: number
}

export interface LayoutInput {
  text: string
  case: string
  size: number
  tracking: number
  leading: number
  align: string
  valign: string
  fit: string
  boxWidth: number
  boxHeight: number
  /** Extra room around the box on the raster canvas, in device pixels. */
  margin: number
  seed: string
  charShift: number
  charTurn: number
  charSize: number
  charColour: number
  swatches: number
}

const MAX_LINES = 16

function applyCase(text: string, mode: string): string {
  if (mode === 'upper') return text.toUpperCase()
  if (mode === 'lower') return text.toLowerCase()
  if (mode === 'title') {
    return text.replace(
      /\p{L}[\p{L}\p{M}']*/gu,
      (word) => word[0].toUpperCase() + word.slice(1).toLowerCase(),
    )
  }
  return text
}

/**
 * A line's width, split into the part that scales with type size and the part
 * that does not.
 *
 * Fitting needs both halves separately. Tracking is authored in pixels, so a
 * line set 40% larger is *not* 40% wider — solving for the size that fills the
 * box means solving `advance * k + tracking * gaps = boxWidth` for `k`, which
 * is impossible if the two have already been added together.
 */
interface LineMetrics {
  text: string
  glyphs: Array<string>
  advance: number
  gaps: number
}

function measureLine(
  text: string,
  size: number,
  measure: Measure,
): LineMetrics {
  const glyphs = [...text]
  let advance = 0
  for (const glyph of glyphs) advance += measure(glyph, size)
  return { text, glyphs, advance, gaps: Math.max(0, glyphs.length - 1) }
}

function lineWidth(line: LineMetrics, tracking: number, scale = 1): number {
  return line.advance * scale + line.gaps * tracking
}

function wrap(
  text: string,
  size: number,
  tracking: number,
  maxWidth: number,
  measure: Measure,
): Array<LineMetrics> {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [measureLine('', size, measure)]

  const lines: Array<LineMetrics> = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    const metrics = measureLine(candidate, size, measure)
    if (current && lineWidth(metrics, tracking) > maxWidth) {
      lines.push(measureLine(current, size, measure))
      current = word
      continue
    }
    current = candidate
  }

  if (current) lines.push(measureLine(current, size, measure))
  return lines
}

/**
 * The scale that makes the widest line exactly fill the box.
 *
 * Guarded on both ends: a line of nothing but tracking has no advance to
 * solve for, and a tracking value wider than the box would ask for a negative
 * size. Both fall back to leaving the size alone rather than collapsing the
 * type to a smear.
 */
function fitScale(
  lines: Array<LineMetrics>,
  tracking: number,
  boxWidth: number,
): number {
  let best = Infinity
  for (const line of lines) {
    if (line.advance <= 0) continue
    const room = boxWidth - line.gaps * tracking
    if (room <= 0) return 1
    best = Math.min(best, room / line.advance)
  }
  return Number.isFinite(best) && best > 0 ? best : 1
}

/**
 * Lay out a block of text.
 *
 * `fit` is the interesting control, and the reason this function is not just a
 * loop over `fillText`:
 *
 * - `width` and `block` scale the type until it fills the box, which is how a
 *   poster is set — the type is sized by the frame, not typed at a size and
 *   hoped for.
 * - `stretch` scales each line *horizontally on its own* so every line ends
 *   flush at both margins. Glyphs distort, deliberately: it is the look, and
 *   the alternative (`spread`, which pushes the letters apart instead) is
 *   offered next to it for when it is not.
 */
export function layoutText(input: LayoutInput, measure: Measure): TextLayout {
  const boxWidth = Math.max(1, input.boxWidth)
  const boxHeight = Math.max(1, input.boxHeight)
  const raw = applyCase(input.text, input.case)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .slice(0, MAX_LINES)

  const wrapping = input.fit === 'off' || input.fit === 'spread'
  let lines = raw
    .flatMap((line) =>
      wrapping
        ? wrap(line, input.size, input.tracking, boxWidth, measure)
        : [measureLine(line.trim(), input.size, measure)],
    )
    .slice(0, MAX_LINES)

  let size = input.size
  let tracking = input.tracking

  if (input.fit === 'width' || input.fit === 'block') {
    let scale = fitScale(lines, tracking, boxWidth)
    if (input.fit === 'block') {
      // Height is measured in whole line steps, so the vertical constraint is
      // solved against the same scale rather than applied after it.
      const steps = Math.max(1, lines.length - 1) * input.leading + 1
      scale = Math.min(scale, boxHeight / (input.size * steps))
    }
    size = Math.max(1, input.size * scale)
    lines = lines.map((line) => measureLine(line.text, size, measure))
  }

  const lineStep = Math.max(1, size * input.leading)
  const blockHeight = lineStep * Math.max(0, lines.length - 1) + size

  // Per-line horizontal scale (`stretch`) and per-line tracking (`spread`) are
  // the two ways to reach both margins; everything else leaves lines alone.
  const scaleFor = (line: LineMetrics) =>
    input.fit === 'stretch' && line.advance > 0
      ? Math.max(0.05, (boxWidth - line.gaps * tracking) / line.advance)
      : 1
  const trackingFor = (line: LineMetrics) =>
    input.fit === 'spread' && line.gaps > 0
      ? (boxWidth - line.advance) / line.gaps
      : tracking

  const top =
    input.margin +
    (input.valign === 'top'
      ? 0
      : input.valign === 'bottom'
        ? boxHeight - blockHeight
        : (boxHeight - blockHeight) / 2)

  const rng = createRng(`${input.seed}:text`)
  const glyphs: Array<GlyphPlacement> = []
  const swatches = Math.max(1, input.swatches)
  let blockWidth = 0
  let y = top

  for (const line of lines) {
    const scaleX = scaleFor(line)
    const lineTracking = trackingFor(line)
    const width = lineWidth(line, lineTracking, scaleX)
    blockWidth = Math.max(blockWidth, width)

    let x =
      input.margin +
      (input.align === 'left'
        ? 0
        : input.align === 'right'
          ? boxWidth - width
          : (boxWidth - width) / 2)

    for (const char of line.glyphs) {
      const advance = measure(char, size) * scaleX
      /**
       * Six draws per position, always, before anything branches on them.
       *
       * A space contributes no glyph but must still consume its numbers: if
       * the stream only advanced for inked characters, adding a space would
       * re-roll the jitter of every character after it, and nudging a word
       * apart would reshuffle the line.
       */
      const shiftX = rng.next() * 2 - 1
      const shiftY = rng.next() * 2 - 1
      const grow = rng.next() * 2 - 1
      const turn = rng.next() * 2 - 1
      const colourRoll = rng.next()
      const colourPick = rng.next()

      if (char.trim().length > 0) {
        glyphs.push({
          char,
          x: x + shiftX * input.charShift,
          y: y + shiftY * input.charShift,
          size: size * (1 + grow * input.charSize),
          rotate: ((turn * input.charTurn) / 180) * Math.PI,
          scaleX,
          inkOffset:
            colourRoll < input.charColour
              ? 1 + Math.floor(colourPick * (swatches - 1))
              : 0,
        })
      }

      x += advance + lineTracking
    }

    y += lineStep
  }

  return { glyphs, blockWidth, blockHeight, size }
}
