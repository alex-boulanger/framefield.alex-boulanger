import { createRng } from '../../rng'
import { roundParam, str } from '../../params'
import { FONTS } from '../../fonts'
import { DEFAULT_TEXT, MAX_SWATCHES, TEXT_DEFAULTS } from './params'
import type { CanvasSize, Params } from '../../types'

/**
 * Seeded typography for remix.
 *
 * The words are the composition; how they are set is the treatment. So this
 * rerolls everything *except* the string — a headline the user typed survives
 * every remix, exactly as an imported photograph does, while the face, the
 * setting, the fill and the damage around it change.
 *
 * Two constraints shape every range in here, and both come from the fact that
 * the opening document is a remix:
 *
 * - **It must land on the canvas.** The box is sized as a fraction of the frame
 *   and the offsets are bounded by the room left over, so no roll can push the
 *   type off the edge — which is the failure a random layout reaches for first.
 * - **It must stay legible.** The type size is solved from the box height and
 *   the line count rather than picked, so the block fills the box instead of
 *   overflowing it, and the fits that refit within the box are the likely ones.
 */

const MAX_LINES = 16

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Lines as the layout will see them: explicit breaks only, capped. */
function lineCount(text: string): number {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').length
  return clamp(lines, 1, MAX_LINES)
}

export function randomizeText(
  seed: string,
  palette: Array<string>,
  canvas: CanvasSize,
  current: Params,
): Params {
  const rng = createRng(`${seed}:type`)
  const text = str(current, 'text', DEFAULT_TEXT)

  /**
   * A face from one register rather than from all ten.
   *
   * Picking uniformly makes every remix feel like the same lottery; picking a
   * category first means a run of them reads as "this one is a serif poster,
   * that one is terminal output", which is the diversity that shows.
   */
  const category = rng.pick([
    'display',
    'display',
    'display',
    'grotesk',
    'grotesk',
    'serif',
    'serif',
    'mono',
    'pixel',
  ])
  const faces = FONTS.filter((font) => font.category === category)
  const font = rng.pick(faces.length > 0 ? faces : FONTS).id

  /*
   * `width` and `off` are left out on purpose. Both let the block grow past the
   * box — `width` solves the type size against the box's width alone, `off`
   * against nothing at all — and the raster canvas is only box-plus-margin, so
   * a tall roll comes back with its ascenders sliced off. The three kept fits
   * are all bounded: `block` refits inside the box, and `stretch` and `spread`
   * set at the size solved below.
   */
  const fit = rng.pick([
    'stretch',
    'stretch',
    'stretch',
    'block',
    'block',
    'spread',
  ])

  const boxWidth = clamp(
    Math.round(canvas.width * rng.range(0.58, 0.94)),
    16,
    4096,
  )
  const boxHeight = clamp(
    Math.round(canvas.height * rng.range(0.3, 0.62)),
    16,
    4096,
  )

  const leading = roundParam(rng.range(0.72, 1.15))
  // The height of a block of `lines` lines, in multiples of the type size.
  const steps = leading * (lineCount(text) - 1) + 1
  const size = clamp(
    Math.round((boxHeight * rng.range(0.5, 0.92)) / steps),
    8,
    900,
  )

  /*
   * Tracking is authored in pixels but read against a type size that ranges
   * from a caption to a whole frame, so it is picked as a fraction of the size
   * — a fixed 20px is a gulf at 90px and invisible at 700.
   */
  // `roundParam` rather than `Math.round`: a tracking that rounds to negative
  // zero serializes as `0` and the recipe stops round-tripping.
  const tracking = clamp(roundParam(size * rng.range(-0.03, 0.11), 0), -40, 120)

  /**
   * Turning the type on its side, but only when it still fits turned.
   *
   * A quarter turn is the one rotation that reads as a decision rather than a
   * wobble, and it is also the one that can put a wide box through the side of
   * a narrow frame — hence the check, and hence the offsets below measuring
   * their room against the footprint the rotation actually produces.
   */
  const quarter =
    rng.bool(0.08) && boxWidth <= canvas.height && boxHeight <= canvas.width
  const rotate = quarter
    ? rng.pick([90, -90])
    : rng.bool(0.3)
      ? roundParam(rng.range(-8, 8), 1)
      : 0

  const footprintX = quarter ? boxHeight : boxWidth
  const footprintY = quarter ? boxWidth : boxHeight
  // Seven tenths of the slack, so a stroke or a throw still has somewhere to go.
  const room = (extent: number, footprint: number) =>
    Math.max(0, Math.round(((extent - footprint) / 2) * 0.7))
  const slackX = room(canvas.width, footprintX)
  const slackY = room(canvas.height, footprintY)
  const x = rng.bool(0.45) ? rng.int(-slackX, slackX) : 0
  const y = rng.bool(0.45) ? rng.int(-slackY, slackY) : 0

  /**
   * Colour is an index, and the index has to exist.
   *
   * `swatchAt` wraps, so any number renders — but on a three-colour palette an
   * index of 4 is the first swatch under another name, which makes the
   * inspector lie about what was chosen. Wrapping here instead keeps the
   * choices distinct, and keeps a stroke from landing on the face's own colour.
   */
  const swatches = clamp(palette.length, 1, MAX_SWATCHES)
  const swatch = (preferred: ReadonlyArray<number>, avoid?: number): number => {
    const usable = preferred.filter(
      (index) => index < swatches && index !== avoid,
    )
    if (usable.length > 0) return rng.pick(usable)
    return avoid === undefined ? 0 : (avoid + 1) % swatches
  }

  // Palettes are authored dark-first with an accent last, so the light entry is
  // the one that reads over a damaged field, and the dark one is the gamble.
  const ink = swatch([1, 1, 1, 2, 2, 0])

  const fill = rng.pick([
    'solid',
    'solid',
    'solid',
    'solid',
    'solid',
    'solid',
    'solid',
    'gradient',
    'gradient',
    'stripe',
    'stripe',
    'scan',
    'scan',
    'check',
    'check',
    // Rare: the stencil covers the whole frame in paper and knocks the words
    // out of it, so it is the one fill that hides the picture it sits on.
    'stencil',
  ])

  const stroke = rng.pick([
    'off',
    'off',
    'off',
    'off',
    'off',
    'outline',
    'outline',
    'inline',
    'only',
  ])

  const depth = rng.pick([
    'off',
    'off',
    'off',
    'off',
    'shadow',
    'shadow',
    'extrude',
    'extrude',
    'echo',
  ])
  const echoCount = rng.int(3, 8)
  // Throws are a fraction of the type size for the same reason tracking is —
  // and an echo's throw is paid once per copy, so it is the shortest of the
  // three.
  const throwFraction =
    depth === 'echo'
      ? rng.range(0.04, 0.13)
      : depth === 'extrude'
        ? rng.range(0.06, 0.28)
        : rng.range(0.05, 0.22)
  const depthSize = clamp(Math.round(size * throwFraction), 0, 400)

  const warp = rng.pick([
    'off',
    'off',
    'off',
    'off',
    'off',
    'arc',
    'arc',
    'wave',
    'skew',
    'bulge',
    'persp',
  ])
  const sign = rng.bool() ? 1 : -1
  const warpAmount = roundParam(
    warp === 'arc'
      ? sign * rng.range(0.25, 0.6)
      : warp === 'wave'
        ? sign * rng.range(0.2, 0.55)
        : warp === 'skew'
          ? sign * rng.range(0.15, 0.5)
          : warp === 'bulge'
            ? sign * rng.range(0.15, 0.45)
            : sign * rng.range(0.25, 0.65),
  )

  /**
   * Spread over the defaults rather than written out.
   *
   * A remixed recipe has to round-trip through the sanitizer exactly, which
   * means every declared key must be present — and this layer declares forty of
   * them, with more likely to come. Starting from the defaults makes that true
   * by construction instead of by review.
   */
  return {
    ...TEXT_DEFAULTS(),
    text,
    font,
    case: rng.pick([
      'upper',
      'upper',
      'upper',
      'upper',
      'upper',
      'upper',
      'as-is',
      'title',
      'lower',
    ]),
    fit,
    size,
    tracking,
    leading,
    align: rng.pick(['center', 'center', 'center', 'left', 'left', 'right']),
    valign: rng.pick(['middle', 'middle', 'middle', 'top', 'bottom']),
    width: boxWidth,
    height: boxHeight,
    x,
    y,
    rotate,
    palette: [...palette],
    fill,
    ink,
    paper: swatch([0, 0, 2, 1], ink),
    fillAngle: rng.int(0, 359),
    fillScale: clamp(Math.round(size * rng.range(0.04, 0.22)), 2, 200),
    fillDuty: roundParam(rng.range(0.25, 0.7)),
    stroke,
    strokeWidth: clamp(Math.round(size * rng.range(0.015, 0.06)), 1, 60),
    strokeInk: swatch([0, 2, 2, 1], ink),
    depth,
    depthSize,
    depthAngle: rng.int(0, 359),
    depthInk: swatch([2, 2, 0, 1], ink),
    depthFade: rng.bool(0.5) ? roundParam(rng.range(0.15, 0.6)) : 0,
    echoCount,
    echoScale: roundParam(rng.range(0.94, 1.12)),
    echoRotate: rng.bool(0.4) ? roundParam(rng.range(-6, 6), 1) : 0,
    echoCycle: rng.bool(0.6),
    seed,
    charShift: rng.bool(0.25)
      ? clamp(Math.round(size * rng.range(0.01, 0.06)), 0, 120)
      : 0,
    charTurn: rng.bool(0.2) ? roundParam(rng.range(1, 7), 1) : 0,
    charSize: rng.bool(0.2) ? roundParam(rng.range(0.05, 0.22)) : 0,
    charColour: rng.bool(0.25) ? roundParam(rng.range(0.15, 0.6)) : 0,
    warp,
    warpAmount,
    warpFreq: Math.round(rng.range(0.75, 3.5) * 4) / 4,
    warpPhase: roundParam(rng.next()),
  }
}
