import { bool, list, num, str } from '../../params'
import { DEFAULT_FONT } from '../../fonts'
import { DEFAULT_PALETTE, DEFAULT_TEXT } from './params'
import type { LayoutInput } from './layout'
import type { Params, RenderEnv } from '../../types'

/**
 * Params, read once and scaled once.
 *
 * Every spatial value in a recipe is authored in export-space pixels (see the
 * README's second rule), so *something* has to multiply by the render scale.
 * Doing it here, in one place, is what keeps a 40% preview a faithful
 * miniature: the alternative — each drawing routine scaling the values it
 * happens to use — is how a stroke ends up 40% too heavy in the preview and
 * nobody notices until the export.
 *
 * Extends `LayoutInput` so the layout module can take this whole object.
 */
export interface TextSettings extends LayoutInput {
  font: string
  x: number
  y: number
  rotate: number
  palette: Array<string>
  fill: string
  ink: number
  paper: number
  fillAngle: number
  fillScale: number
  fillDuty: number
  stroke: string
  strokeWidth: number
  strokeInk: number
  depth: string
  depthSize: number
  depthAngle: number
  depthInk: number
  depthFade: number
  echoCount: number
  echoScale: number
  echoRotate: number
  echoCycle: boolean
  warp: string
  warpAmount: number
  warpFreq: number
  warpPhase: number
}

/**
 * Room around the text box for everything that draws outside it.
 *
 * A long throw, a heavy stroke and a growing echo all reach past the box, and
 * a box-sized canvas would clip them — which reads as a control that stops
 * working half way along its range rather than as a crop. Capped because the
 * margin is canvas area: an uncapped 400px throw times sixteen echo copies at
 * export scale is a canvas nobody asked for.
 */
const MAX_MARGIN = 2400

function marginFor(settings: TextSettings): number {
  const copies =
    settings.depth === 'echo' ? Math.max(1, Math.round(settings.echoCount)) : 1
  const throwLength = settings.depth === 'off' ? 0 : settings.depthSize * copies
  const growth =
    settings.depth === 'echo' && settings.echoScale > 1
      ? (settings.boxWidth * (settings.echoScale ** copies - 1)) / 2
      : 0

  return Math.min(
    MAX_MARGIN,
    Math.ceil(
      throwLength +
        growth +
        settings.strokeWidth * 2 +
        settings.charShift +
        settings.size * 0.6,
    ),
  )
}

export function textSettings(
  params: Params,
  env: RenderEnv,
): TextSettings {
  const scaled = (key: string, fallback: number) =>
    num(params, key, fallback) * env.scale

  const settings: TextSettings = {
    text: str(params, 'text', DEFAULT_TEXT),
    font: str(params, 'font', DEFAULT_FONT),
    case: str(params, 'case', 'upper'),
    fit: str(params, 'fit', 'stretch'),
    size: Math.max(1, scaled('size', 190)),
    tracking: scaled('tracking', -4),
    leading: num(params, 'leading', 0.82),
    align: str(params, 'align', 'center'),
    valign: str(params, 'valign', 'middle'),
    boxWidth: Math.max(1, scaled('width', 900)),
    boxHeight: Math.max(1, scaled('height', 620)),
    x: scaled('x', 0),
    y: scaled('y', 0),
    rotate: num(params, 'rotate', 0),
    palette: list(params, 'palette', DEFAULT_PALETTE),
    fill: str(params, 'fill', 'solid'),
    ink: num(params, 'ink', 1),
    paper: num(params, 'paper', 0),
    fillAngle: num(params, 'fillAngle', 90),
    fillScale: Math.max(1, scaled('fillScale', 18)),
    fillDuty: num(params, 'fillDuty', 0.5),
    stroke: str(params, 'stroke', 'off'),
    strokeWidth: Math.max(0.5, scaled('strokeWidth', 6)),
    strokeInk: num(params, 'strokeInk', 2),
    depth: str(params, 'depth', 'off'),
    depthSize: Math.max(0, scaled('depthSize', 48)),
    depthAngle: num(params, 'depthAngle', 135),
    depthInk: num(params, 'depthInk', 2),
    depthFade: num(params, 'depthFade', 0),
    echoCount: num(params, 'echoCount', 5),
    echoScale: num(params, 'echoScale', 1),
    echoRotate: num(params, 'echoRotate', 0),
    echoCycle: bool(params, 'echoCycle', true),
    seed: str(params, 'seed', 'type'),
    charShift: Math.max(0, scaled('charShift', 0)),
    charTurn: num(params, 'charTurn', 0),
    charSize: num(params, 'charSize', 0),
    charColour: num(params, 'charColour', 0),
    warp: str(params, 'warp', 'off'),
    warpAmount: num(params, 'warpAmount', 0.4),
    warpFreq: num(params, 'warpFreq', 1.5),
    warpPhase: num(params, 'warpPhase', 0),
    swatches: list(params, 'palette', DEFAULT_PALETTE).length,
    margin: 0,
  }

  return { ...settings, margin: marginFor(settings) }
}
