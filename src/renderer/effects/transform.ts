import { sampleChannel } from '../buffer'
import type { PixelBuffer } from '../buffer'
import { bool, num, str } from '../params'
import type { ParamSpec } from '../params'
import type { Params, RenderEnv } from '../types'

/**
 * Transform — move the picture rather than recolour it.
 *
 * The only pass in the registry that reads pixels from somewhere other than
 * where it writes them, which is why it exists: everything else changes how the
 * frame is rendered, this changes what the composition *is*. Mirror, rotate,
 * tile and kaleidoscope are one effect rather than four because they are one
 * coordinate remap with four terms, and separating them would mean four
 * resamples down a stack instead of one.
 *
 * It runs on the accumulated buffer, not on a source, so coverage is never in
 * question — an effect's output covers exactly what its input covered. That is
 * the reason geometry lives here and not as a per-layer property: moving an
 * effect layer's own output would leave regions the compositor has no rule for.
 */

export const TRANSFORM_PARAMS: Array<ParamSpec> = [
  {
    kind: 'select',
    key: 'symmetry',
    label: 'Symmetry',
    default: 'none',
    options: [
      { value: 'none', label: 'None' },
      { value: 'x', label: 'X' },
      { value: 'y', label: 'Y' },
      { value: 'quad', label: 'Quad' },
    ],
  },
  {
    kind: 'slider',
    key: 'kaleido',
    label: 'Kaleidoscope',
    min: 0,
    max: 12,
    step: 1,
    default: 0,
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
    kind: 'slider',
    key: 'zoom',
    label: 'Zoom',
    min: 0.25,
    max: 4,
    step: 0.01,
    default: 1,
  },
  {
    kind: 'slider',
    key: 'tile',
    label: 'Tile',
    min: 1,
    max: 8,
    step: 1,
    default: 1,
  },
  {
    kind: 'slider',
    key: 'offsetX',
    label: 'Offset X',
    min: -2048,
    max: 2048,
    step: 1,
    default: 0,
    spatial: true,
    unit: 'px',
  },
  {
    kind: 'slider',
    key: 'offsetY',
    label: 'Offset Y',
    min: -2048,
    max: 2048,
    step: 1,
    default: 0,
    spatial: true,
    unit: 'px',
  },
  { kind: 'toggle', key: 'flipX', label: 'Flip X', default: false },
  { kind: 'toggle', key: 'flipY', label: 'Flip Y', default: false },
  { kind: 'toggle', key: 'wrap', label: 'Wrap edges', default: true },
]

/** Whether the params amount to anything, so the identity costs no resample. */
function isIdentity(params: Params): boolean {
  return (
    str(params, 'symmetry', 'none') === 'none' &&
    Math.round(num(params, 'kaleido', 0)) < 2 &&
    num(params, 'rotate', 0) % 360 === 0 &&
    num(params, 'zoom', 1) === 1 &&
    Math.round(num(params, 'tile', 1)) <= 1 &&
    num(params, 'offsetX', 0) === 0 &&
    num(params, 'offsetY', 0) === 0 &&
    !bool(params, 'flipX', false) &&
    !bool(params, 'flipY', false)
  )
}

export function applyTransform(
  buffer: PixelBuffer,
  params: Params,
  env: RenderEnv,
): PixelBuffer {
  // A resample is lossy even when it changes nothing, so the identity has to
  // short-circuit rather than round-trip every pixel through a bilinear filter.
  if (isIdentity(params)) return buffer

  const { width, height, data } = buffer
  const source = new Float32Array(data)

  const symmetry = str(params, 'symmetry', 'none')
  const symX = symmetry === 'x' || symmetry === 'quad'
  const symY = symmetry === 'y' || symmetry === 'quad'
  const segments = Math.round(num(params, 'kaleido', 0))
  const angle = (num(params, 'rotate', 0) * Math.PI) / 180
  const zoom = Math.max(0.01, num(params, 'zoom', 1))
  const tile = Math.max(1, Math.round(num(params, 'tile', 1)))
  const flipX = bool(params, 'flipX', false)
  const flipY = bool(params, 'flipY', false)
  const wrap = bool(params, 'wrap', true)

  // Offsets are authored in export pixels like every other spatial param, and
  // converted to frame fractions so the maths below stays resolution-free.
  const offsetU = (num(params, 'offsetX', 0) * env.scale) / width
  const offsetV = (num(params, 'offsetY', 0) * env.scale) / height

  const cos = Math.cos(-angle)
  const sin = Math.sin(-angle)
  // Rotation happens in aspect-corrected space; rotating raw `uv` on a 4:5
  // frame shears the image instead of turning it.
  const aspect = width / height
  const wedge = segments >= 2 ? (Math.PI * 2) / segments : 0

  const fract = (value: number) => value - Math.floor(value)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Inverse mapping: for this destination pixel, where does it read from?
      let u = x / width - offsetU
      let v = y / height - offsetV

      let ax = (u - 0.5) * aspect
      let ay = v - 0.5

      // Zoom before rotation, so zooming stays centred whatever the angle.
      ax /= zoom
      ay /= zoom

      if (angle !== 0) {
        const rx = ax * cos - ay * sin
        ay = ax * sin + ay * cos
        ax = rx
      }

      if (wedge > 0) {
        // Fold the angle into one wedge and mirror within it, which is what
        // makes the seams meet instead of butting against each other.
        const radius = Math.hypot(ax, ay)
        let theta = Math.atan2(ay, ax)
        theta = ((theta % wedge) + wedge) % wedge
        if (theta > wedge / 2) theta = wedge - theta
        ax = Math.cos(theta) * radius
        ay = Math.sin(theta) * radius
      }

      if (symX) ax = Math.abs(ax)
      if (symY) ay = Math.abs(ay)

      u = ax / aspect + 0.5
      v = ay + 0.5

      if (tile > 1) {
        u = fract(u * tile)
        v = fract(v * tile)
      }

      if (flipX) u = 1 - u
      if (flipY) v = 1 - v

      const sx = u * width
      const sy = v * height
      const i = (y * width + x) * 4
      data[i] = sampleChannel(source, width, height, sx, sy, 0, wrap)
      data[i + 1] = sampleChannel(source, width, height, sx, sy, 1, wrap)
      data[i + 2] = sampleChannel(source, width, height, sx, sy, 2, wrap)
    }
  }

  return buffer
}
