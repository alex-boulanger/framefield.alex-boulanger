import {
  blur,
  blurPlane,
  createBuffer,
  resamplePlane,
  srgbToLinear,
} from '../buffer'
import type { PixelBuffer } from '../buffer'
import {
  buildFlowField,
  cellularFbm,
  fbm,
  interference,
  lic,
  ridged,
  seedToInt,
  warped,
  whiteNoise,
} from '../noise'
import type { CellMode } from '../noise'
import { hexToRgb } from '../palettes'
import { createRng } from '../rng'
import { defaultParams, list, num, roundParam, str } from '../params'
import type { ParamSpec } from '../params'
import type { Params, RenderEnv } from '../types'

/**
 * Fraction of the render size the LIC plane is computed at.
 *
 * Line integral convolution is the only thing in the generator that costs more
 * than one evaluation per pixel: it walks `2 x steps` samples along a
 * streamline for every pixel, which made the flow field twelve times more
 * expensive than any other and 89% of the cost of a preset that used it.
 *
 * Halving the plane is an eightfold saving — a quarter of the pixels, and half
 * the steps across each — and it costs little, because a LIC plane is smooth
 * along its streaks by construction and is low-passed immediately afterwards
 * anyway. What it does cost is texture granularity: the noise cells the streaks
 * are made of double in size, so the result reads slightly softer.
 *
 * A *ratio* rather than a pixel cap on purpose. A fixed cap would give a small
 * preview relatively more detail than the export, which is exactly the
 * preview/export fidelity the whole param model is built to preserve.
 */
const FLOW_PLANE_SCALE = 0.5

/** Cycles per unit of `scale` for the interference field. See its case below. */
const MOIRE_CYCLES = 6

/**
 * The source generator.
 *
 * Built around continuous-tone *fields* rather than drawn shapes. The previous
 * version rasterized hard-edged vector shapes onto a flat ground, which gave
 * the downstream effects a bimodal histogram to chew on — the dither had no
 * mid-tone to live in, so it collapsed into outline fills. A noise field
 * carries structure at every spatial frequency, which is what the quantizing
 * effects need in order to read as prints.
 *
 * Fully procedural: no canvas, no `drawImage`, no DOM. That makes it
 * deterministic, testable in node, and — because every coordinate is
 * normalized by the short edge — resolution-independent, so a preview really
 * is the export in miniature.
 */

export const FIELD_PARAMS: Array<ParamSpec> = [
  // The seed lives in `params` like everything else so a generator layer is
  // just `{ kind, params }` — the inspector, sanitizer, and edit actions then
  // treat it exactly like an effect layer with no special-casing anywhere.
  { kind: 'seed', key: 'seed', label: 'Seed', default: 'field' },
  {
    kind: 'select',
    key: 'field',
    label: 'Field',
    default: 'warp',
    options: [
      { value: 'fbm', label: 'fBm' },
      { value: 'warp', label: 'Warp' },
      { value: 'ridged', label: 'Ridge' },
      { value: 'flow', label: 'Flow' },
      { value: 'cellular', label: 'Cells' },
      { value: 'moire', label: 'Moiré' },
      { value: 'gradient', label: 'Ramp' },
    ],
  },
  {
    kind: 'select',
    key: 'cellMode',
    label: 'Cell type',
    default: 'edge',
    options: [
      { value: 'f1', label: 'Stone' },
      { value: 'edge', label: 'Cracks' },
      { value: 'blocks', label: 'Plates' },
    ],
  },
  {
    kind: 'slider',
    key: 'waves',
    label: 'Waves',
    min: 1,
    max: 6,
    step: 1,
    default: 3,
  },
  {
    kind: 'slider',
    key: 'skew',
    label: 'Beat',
    min: 0,
    max: 2,
    step: 0.01,
    default: 0.35,
  },
  {
    kind: 'slider',
    key: 'scale',
    label: 'Scale',
    min: 0.4,
    max: 12,
    step: 0.1,
    default: 2.4,
  },
  {
    kind: 'slider',
    key: 'octaves',
    label: 'Octaves',
    min: 1,
    max: 8,
    step: 1,
    default: 5,
  },
  {
    kind: 'slider',
    key: 'warp',
    label: 'Warp',
    min: 0,
    max: 4,
    step: 0.05,
    default: 1.6,
  },
  {
    kind: 'slider',
    key: 'flow',
    label: 'Flow',
    min: 2,
    max: 40,
    step: 1,
    default: 14,
  },
  {
    kind: 'slider',
    key: 'shapes',
    label: 'Shapes',
    min: 0,
    max: 40,
    step: 1,
    default: 5,
  },
  {
    kind: 'slider',
    key: 'shapeScale',
    label: 'Shape size',
    min: 0.05,
    max: 1.2,
    step: 0.01,
    default: 0.45,
  },
  {
    kind: 'select',
    key: 'composition',
    label: 'Layout',
    default: 'orbit',
    options: [
      { value: 'scatter', label: 'Scatter' },
      { value: 'orbit', label: 'Orbit' },
      { value: 'stack', label: 'Stack' },
      { value: 'grid', label: 'Grid' },
    ],
  },
  {
    kind: 'slider',
    key: 'softness',
    label: 'Softness',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.3,
  },
  {
    kind: 'slider',
    key: 'contrast',
    label: 'Contrast',
    min: -1,
    max: 1,
    step: 0.01,
    default: 0.15,
  },
  {
    kind: 'slider',
    key: 'brightness',
    label: 'Brightness',
    min: -0.5,
    max: 0.5,
    step: 0.01,
    default: 0,
  },
  {
    kind: 'slider',
    key: 'blur',
    label: 'Blur',
    min: 0,
    max: 60,
    step: 1,
    default: 0,
    spatial: true,
    unit: 'px',
  },
  {
    kind: 'slider',
    key: 'grain',
    label: 'Grain',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.06,
  },
  /*
   * Placement. The field is infinite and the frame is a window onto it, so
   * panning and rotating is how you *frame* a field rather than reroll until
   * the seed happens to land somewhere good.
   *
   * Applied to the sample coordinate before anything reads it, so the noise,
   * the shapes and the ramp all move together — the alternative is a pan that
   * slides the texture out from under the composition.
   */
  {
    kind: 'slider',
    key: 'panX',
    label: 'Pan X',
    min: -2048,
    max: 2048,
    step: 1,
    default: 0,
    spatial: true,
    unit: 'px',
  },
  {
    kind: 'slider',
    key: 'panY',
    label: 'Pan Y',
    min: -2048,
    max: 2048,
    step: 1,
    default: 0,
    spatial: true,
    unit: 'px',
  },
  {
    kind: 'slider',
    key: 'rotate',
    label: 'Rotate',
    min: 0,
    max: 360,
    step: 1,
    default: 0,
    unit: '°',
  },
  {
    kind: 'palette',
    key: 'palette',
    label: 'Palette',
    default: ['#050505', '#f5f5f5', '#0057ff'],
  },
]

export const FIELD_DEFAULTS = () => defaultParams(FIELD_PARAMS)

/* -------------------------------------------------------------------------
 * Palette ramp
 * ---------------------------------------------------------------------- */

const RAMP_STEPS = 256

/**
 * Build a tone -> linear RGB lookup from the palette.
 *
 * Interpolated in *sRGB* and then converted, deliberately. Linear
 * interpolation between two swatches is physically how light mixes, but it
 * reads far lighter in the middle than a designer picking those two swatches
 * expects. Perceptual interpolation matches intent; the conversion afterwards
 * keeps the pipeline honest.
 */
function buildRamp(colors: Array<string>): Float32Array {
  const stops = colors.map(hexToRgb)
  const ramp = new Float32Array(RAMP_STEPS * 3)

  if (stops.length === 0) return ramp

  for (let i = 0; i < RAMP_STEPS; i++) {
    const t = i / (RAMP_STEPS - 1)
    let r: number
    let g: number
    let b: number

    if (stops.length === 1) {
      ;({ r, g, b } = stops[0])
    } else {
      const scaled = t * (stops.length - 1)
      const index = Math.min(stops.length - 2, Math.floor(scaled))
      const frac = scaled - index
      const a = stops[index]
      const c = stops[index + 1]
      r = a.r + (c.r - a.r) * frac
      g = a.g + (c.g - a.g) * frac
      b = a.b + (c.b - a.b) * frac
    }

    ramp[i * 3] = srgbToLinear(r / 255)
    ramp[i * 3 + 1] = srgbToLinear(g / 255)
    ramp[i * 3 + 2] = srgbToLinear(b / 255)
  }

  return ramp
}

/* -------------------------------------------------------------------------
 * Signed distance shapes
 * ---------------------------------------------------------------------- */

type ShapeKind = 'circle' | 'box' | 'ring' | 'bar'

interface Shape {
  kind: ShapeKind
  x: number
  y: number
  size: number
  /** Rotation baked into cos/sin once, not recomputed per pixel. */
  cos: number
  sin: number
  tone: number
  strength: number
  /** Radius beyond which coverage is zero, for a cheap early reject. */
  reach: number
}

/**
 * Distance in normalized units. Analytic rather than rasterized: edges are
 * antialiased for free at any resolution, and `softness` becomes a real
 * distance falloff instead of a post-hoc blur.
 *
 * The rotation is precomputed on the shape. Calling `Math.cos`/`Math.sin` here
 * cost two trig operations per shape per pixel and put a 137ms floor under
 * every render, including the plain-ramp field that does no noise work at all.
 */
function shapeDistance(shape: Shape, x: number, y: number): number {
  const dx = x - shape.x
  const dy = y - shape.y
  const px = dx * shape.cos - dy * shape.sin
  const py = dx * shape.sin + dy * shape.cos
  const half = shape.size / 2

  switch (shape.kind) {
    case 'circle':
      return Math.hypot(px, py) - half

    case 'ring':
      return Math.abs(Math.hypot(px, py) - half) - shape.size * 0.08

    case 'bar': {
      const qx = Math.abs(px) - half
      const qy = Math.abs(py) - shape.size * 0.06
      return (
        Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
        Math.min(Math.max(qx, qy), 0)
      )
    }

    case 'box': {
      const qx = Math.abs(px) - half
      const qy = Math.abs(py) - half
      return (
        Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
        Math.min(Math.max(qx, qy), 0)
      )
    }
  }
}

function layout(
  composition: string,
  index: number,
  total: number,
  aspect: number,
  rng: ReturnType<typeof createRng>,
): { x: number; y: number } {
  const t = total <= 1 ? 0.5 : index / (total - 1)

  switch (composition) {
    case 'orbit': {
      // Golden angle: even coverage with no visible lattice.
      const angle = index * 2.39996
      const radius = Math.sqrt(t) * 0.45
      return {
        x: 0.5 * aspect + Math.cos(angle) * radius,
        y: 0.5 + Math.sin(angle) * radius,
      }
    }
    case 'stack':
      return { x: aspect * rng.range(0.2, 0.8), y: 0.12 + t * 0.76 }

    case 'grid': {
      const columns = Math.max(1, Math.round(Math.sqrt(total)))
      const rows = Math.max(1, Math.ceil(total / columns))
      return {
        x: (((index % columns) + 0.5) / columns) * aspect,
        y: (Math.floor(index / columns) + 0.5) / rows,
      }
    }
    default:
      return { x: rng.next() * aspect, y: rng.next() }
  }
}

/* -------------------------------------------------------------------------
 * Tone field
 * ---------------------------------------------------------------------- */

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0 || 1)))
  return t * t * (3 - 2 * t)
}

/** Contrast around mid-grey, then brightness. Applied to tone, not to colour. */
function toneCurve(
  value: number,
  contrast: number,
  brightness: number,
): number {
  const factor = (1 + contrast) ** 2
  return Math.max(0, Math.min(1, (value - 0.5) * factor + 0.5 + brightness))
}

export function renderField(params: Params, env: RenderEnv): PixelBuffer {
  const { width, height } = env
  const buffer = createBuffer(width, height)
  const data = buffer.data

  const seedText = str(params, 'seed', 'seed')
  const seed = seedToInt(seedText)
  const rng = createRng(`${seedText}:shapes`)

  const field = str(params, 'field', 'warp')
  const scale = num(params, 'scale', 2.4)
  const octaves = Math.round(num(params, 'octaves', 5))
  const warpAmount = num(params, 'warp', 1.6)
  const flowSteps = Math.round(num(params, 'flow', 14))
  const shapeCount = Math.round(num(params, 'shapes', 5))
  const shapeScale = num(params, 'shapeScale', 0.45)
  const composition = str(params, 'composition', 'orbit')
  const cellMode = str(params, 'cellMode', 'edge') as CellMode
  const waves = num(params, 'waves', 3)
  const skew = num(params, 'skew', 0.35)
  const softness = num(params, 'softness', 0.3)
  const contrast = num(params, 'contrast', 0.15)
  const brightness = num(params, 'brightness', 0)
  const grain = num(params, 'grain', 0.06)
  const renderScale = env.scale > 0 ? env.scale : 1
  const ramp = buildRamp(
    list(params, 'palette', ['#050505', '#f5f5f5', '#0057ff']),
  )

  // Normalize by the short edge so features keep their shape on any aspect and
  // their size at any render scale.
  const short = Math.min(width, height)
  const aspect = width / short
  const fbmOptions = { octaves }

  // Placement, in the same normalized units the field is sampled in. `env.scale`
  // converts the export-space pan so a half-scale preview frames identically.
  const panU = (num(params, 'panX', 0) * renderScale) / short
  const panV = (num(params, 'panY', 0) * renderScale) / short
  const spin = (num(params, 'rotate', 0) * Math.PI) / 180
  const spinCos = Math.cos(spin)
  const spinSin = Math.sin(spin)
  const placed = panU !== 0 || panV !== 0 || spin !== 0
  const centreU = aspect / 2
  const centreV = 0.5

  const shapes: Array<Shape> = []
  for (let i = 0; i < shapeCount; i++) {
    const position = layout(composition, i, shapeCount, aspect, rng)
    const rotation = rng.range(-Math.PI, Math.PI)
    const size = shapeScale * rng.range(0.3, 1)
    shapes.push({
      kind: rng.pick<ShapeKind>(['circle', 'box', 'ring', 'bar']),
      x: position.x,
      y: position.y,
      size,
      cos: Math.cos(-rotation),
      sin: Math.sin(-rotation),
      tone: rng.range(0.15, 1),
      strength: rng.range(0.5, 1),
      // Half-diagonal of the bounding box plus the softness band.
      reach: size * 0.75 + Math.max(1 / short, softness * size * 0.5),
    })
  }

  /**
   * Flow is computed as a whole plane up front rather than per pixel inline,
   * because it needs two passes.
   *
   * Raw LIC is speckled: each pixel averages its own streamline, and the
   * residual per-pixel randomness survives. Low-passing across the streaks
   * removes that speckle while leaving the directional structure — which is
   * the thing worth looking at — intact. The contrast stretch then has to come
   * *after* the blur, since blurring reduces the variance further.
   */
  const flowPlane =
    field === 'flow'
      ? (() => {
          const flowField = buildFlowField(
            Math.max(32, Math.round(160 * aspect)),
            160,
            aspect,
            1,
            seed,
            scale,
            fbmOptions,
          )

          const planeWidth = Math.max(2, Math.round(width * FLOW_PLANE_SCALE))
          const planeHeight = Math.max(2, Math.round(height * FLOW_PLANE_SCALE))
          const planeShort = Math.min(planeWidth, planeHeight)
          // Fewer pixels *and* proportionally fewer steps across each of them,
          // so halving the plane is an eightfold saving rather than fourfold.
          // The streak keeps its length in the finished image because the step
          // is measured against the plane's own short edge.
          const steps = Math.max(1, Math.round(flowSteps * (planeShort / short)))

          const plane = new Float32Array(planeWidth * planeHeight)
          for (let py = 0; py < planeHeight; py++) {
            for (let px = 0; px < planeWidth; px++) {
              plane[py * planeWidth + px] = lic(
                px / planeShort,
                py / planeShort,
                seed,
                flowField,
                {
                  steps,
                  // Exactly one texture cell per step, and this is the whole
                  // trick. A streak appears because neighbouring pixels along the
                  // flow average almost the *same* samples, shifted by one. Any
                  // longer stride makes their sample sets disjoint, the
                  // correlation vanishes, and the result is indistinguishable
                  // from static.
                  stepLength: 1 / planeShort,
                  textureScale: planeShort,
                },
              )
            }
          }

          blurPlane(plane, planeWidth, planeHeight, 1)

          // Measure the spread that actually survived rather than predicting
          // it: the blur radius, step count, and field all affect it.
          let mean = 0
          for (const value of plane) mean += value
          mean /= plane.length
          let variance = 0
          for (const value of plane) variance += (value - mean) ** 2
          const deviation = Math.sqrt(variance / plane.length) || 1
          // Aim for a standard deviation of ~0.22, which fills the range
          // without pinning the tails against 0 and 1.
          const gain = 0.22 / deviation

          for (let i = 0; i < plane.length; i++) {
            plane[i] = 0.5 + (plane[i] - mean) * gain
          }

          // Stretch last: the blur and the measured gain both want to run on
          // the samples that were actually computed, not on interpolated ones.
          return resamplePlane(plane, planeWidth, planeHeight, width, height)
        })()
      : null

  for (let py = 0; py < height; py++) {
    const rawV = py / short

    for (let px = 0; px < width; px++) {
      const rawU = px / short

      // --- placement ----------------------------------------------------
      let u = rawU
      let v = rawV
      if (placed) {
        u -= panU
        v -= panV
        if (spin !== 0) {
          const dx = u - centreU
          const dy = v - centreV
          u = centreU + dx * spinCos - dy * spinSin
          v = centreV + dx * spinSin + dy * spinCos
        }
      }

      // --- base field -------------------------------------------------
      let tone: number
      switch (field) {
        case 'fbm':
          tone = fbm(u * scale, v * scale, seed, fbmOptions) * 0.5 + 0.5
          break
        case 'ridged':
          tone = ridged(u * scale, v * scale, seed, fbmOptions) * 0.5 + 0.5
          break
        case 'flow': {
          // Precomputed above: LIC needs a blur and a measured stretch, both
          // of which are whole-plane operations. Placement therefore has to be
          // a *lookup* into the finished plane rather than a change of sample
          // coordinate — clamped, since the plane has no data outside itself.
          const fx = Math.max(0, Math.min(width - 1, u * short))
          const fy = Math.max(0, Math.min(height - 1, v * short))
          const x0 = Math.floor(fx)
          const y0 = Math.floor(fy)
          const x1 = Math.min(width - 1, x0 + 1)
          const y1 = Math.min(height - 1, y0 + 1)
          const tx = fx - x0
          const ty = fy - y0
          const top =
            flowPlane![y0 * width + x0] +
            (flowPlane![y0 * width + x1] - flowPlane![y0 * width + x0]) * tx
          const bottom =
            flowPlane![y1 * width + x0] +
            (flowPlane![y1 * width + x1] - flowPlane![y1 * width + x0]) * tx
          tone = top + (bottom - top) * ty
          break
        }
        case 'cellular':
          tone = cellularFbm(u * scale, v * scale, seed, cellMode, fbmOptions)
          break
        case 'moire':
          // `scale` counts *features across the frame* for every other field,
          // and a grating needs an order of magnitude more of them to read as
          // a grating at all: at the shared default it was one and a half
          // stripes, which looks like blobs. The multiplier puts the usual
          // slider range onto roughly 3-70 cycles, where the beating lives.
          tone = interference(
            u * scale * MOIRE_CYCLES,
            v * scale * MOIRE_CYCLES,
            seed,
            waves,
            skew,
          )
          break
        case 'gradient':
          // A plain ramp is the honest baseline: pure tone, no texture.
          tone = (u / aspect) * 0.35 + v * 0.65
          break
        default:
          tone =
            warped(u * scale, v * scale, seed, warpAmount, fbmOptions) * 0.5 +
            0.5
      }

      // --- shapes ------------------------------------------------------
      for (const shape of shapes) {
        // Cheap reject before the distance maths: most pixels are outside most
        // shapes, and this keeps shape count from dominating the inner loop.
        const dx = u - shape.x
        const dy = v - shape.y
        if (dx * dx + dy * dy > shape.reach * shape.reach) continue

        const distance = shapeDistance(shape, u, v)
        // Softness widens the falloff band; at 0 it is a one-pixel edge.
        const edge = Math.max(1 / short, softness * shape.size * 0.5)
        const coverage = smoothstep(edge, -edge, distance) * shape.strength
        if (coverage > 0) tone = tone + (shape.tone - tone) * coverage
      }

      // --- grain -------------------------------------------------------
      if (grain > 0) {
        tone +=
          (whiteNoise(
            Math.floor(px / renderScale),
            Math.floor(py / renderScale),
            seed,
          ) -
            0.5) *
          grain
      }

      tone = toneCurve(tone, contrast, brightness)

      const index = (py * width + px) * 4
      const slot = Math.min(RAMP_STEPS - 1, (tone * (RAMP_STEPS - 1)) | 0) * 3
      data[index] = ramp[slot]
      data[index + 1] = ramp[slot + 1]
      data[index + 2] = ramp[slot + 2]
      data[index + 3] = 1
    }
  }

  // Blur last, in linear light, where averaging is physically meaningful.
  const sigma = num(params, 'blur', 0) * env.scale
  if (sigma > 0) blur(buffer, sigma)

  return buffer
}

/**
 * Seeded parameter randomization for remix.
 *
 * Ranges stay well inside the slider bounds on purpose: the quality bar asks
 * for consistently usable results, and the extremes of `scale` and `octaves`
 * produce mush at both ends.
 */
export function randomizeField(seed: string, palette: Array<string>): Params {
  const rng = createRng(`${seed}:params`)
  const field = rng.pick([
    'fbm',
    'warp',
    'warp',
    'ridged',
    'flow',
    'cellular',
    'cellular',
    'moire',
  ])

  return {
    seed,
    field,
    /*
     * Scale ranges are per-field on purpose. Cellular counts *cells across the
     * frame*, so the fbm range would give either four boulders or gravel; and
     * moiré is a frequency, where anything above a few cycles aliases into
     * noise at preview scale and stops being a pattern at all.
     */
    scale: roundParam(
      field === 'flow'
        ? rng.range(1, 4)
        : field === 'cellular'
          ? rng.range(2, 7)
          : field === 'moire'
            ? rng.range(0.6, 2.4)
            : rng.range(1, 6),
      1,
    ),
    octaves: rng.int(3, 7),
    warp: roundParam(rng.range(0.6, 2.6)),
    flow: rng.int(8, 26),
    shapes: rng.bool(0.6) ? rng.int(1, 12) : 0,
    shapeScale: roundParam(rng.range(0.2, 0.8)),
    composition: rng.pick(['scatter', 'orbit', 'stack', 'grid']),
    cellMode: rng.pick(['f1', 'edge', 'edge', 'blocks']),
    waves: rng.int(2, 5),
    skew: roundParam(rng.range(0.1, 1.2)),
    softness: roundParam(rng.range(0.05, 0.7)),
    contrast: roundParam(rng.range(-0.1, 0.5)),
    brightness: roundParam(rng.range(-0.12, 0.12)),
    blur: rng.bool(0.25) ? rng.int(2, 20) : 0,
    grain: roundParam(rng.range(0, 0.18)),
    /*
     * Placement is a framing control, not a randomization axis, so remix leaves
     * it alone. Panning a seamless field only shows a different part of it,
     * which reseeding already does — while risking sliding the shapes
     * off-frame. Rotation does read on the directional fields (ramp, flow), so
     * it gets a small chance.
     *
     * Written out rather than omitted: `randomizeField` returns the whole param
     * set, and a missing key round-trips through the sanitizer as its default,
     * which would break the "every remix is shareable" equality check.
     */
    panX: 0,
    panY: 0,
    rotate: rng.bool(0.15) ? rng.int(0, 359) : 0,
    palette: [...palette],
  }
}
