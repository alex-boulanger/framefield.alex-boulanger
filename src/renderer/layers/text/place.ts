import { createBuffer } from '../../buffer'
import { linearRgb, swatchAt } from './colors'
import type { PixelBuffer } from '../../buffer'
import type { RenderEnv } from '../../types'
import type { TextSettings } from './settings'

/**
 * Getting the drawn box into the frame: rotation, warp, and the stencil.
 *
 * All of it runs backwards — for each pixel of the frame, ask which pixel of
 * the box lands there. Forward-mapping a warp leaves holes wherever the source
 * stretches, and filling those holes is a far worse problem than inverting six
 * closed-form functions.
 *
 * Which also means the warps are *defined* by their inverse. `bulge` in
 * particular is authored that way: the forward map that would produce it is
 * not expressible in closed form, and does not need to be.
 */

/** A point of the box, in pixels from the box's top-left corner. */
interface BoxPoint {
  x: number
  y: number
}

/**
 * Undo the warp: given where a pixel landed, find where it came from.
 *
 * Coordinates are relative to the box centre, so every warp is symmetric
 * about it and none of them care where the box sits in the frame.
 */
export function unwarp(
  settings: TextSettings,
  dx: number,
  dy: number,
  halfWidth: number,
  halfHeight: number,
): BoxPoint {
  const amount = settings.warpAmount
  if (settings.warp === 'off' || amount === 0) return { x: dx, y: dy }

  switch (settings.warp) {
    case 'wave': {
      const u = dx / Math.max(1, halfWidth)
      const phase = settings.warpPhase * Math.PI * 2
      const swing = amount * halfHeight * 0.5
      return {
        x: dx,
        y: dy - swing * Math.sin(u * Math.PI * settings.warpFreq + phase),
      }
    }

    case 'skew': {
      return { x: dx - amount * dy, y: dy }
    }

    case 'persp': {
      // Keystone: a scale that varies down the box, so the far edge closes up
      // like type on a receding plane.
      const taper = 1 + amount * (dy / Math.max(1, halfHeight))
      return { x: dx / Math.max(0.05, taper), y: dy }
    }

    case 'bulge': {
      const radius = Math.hypot(dx, dy)
      const extent = Math.max(1, Math.hypot(halfWidth, halfHeight))
      const t = radius / extent
      const push = 1 + amount * (1 - t * t)
      return { x: dx * push, y: dy * push }
    }

    case 'arc': {
      /**
       * The text's centre line is wrapped onto a circle whose arc length
       * across the box is unchanged, so the type keeps its size as it bends.
       * `warpAmount` is the half-span in units of 90°.
       */
      const span = amount * Math.PI * 0.5
      if (Math.abs(span) < 1e-4) return { x: dx, y: dy }
      const r = halfWidth / span
      const toCentre = r - dy
      return {
        x: Math.atan2(dx, toCentre) * r,
        y: r - Math.hypot(dx, toCentre),
      }
    }

    default:
      return { x: dx, y: dy }
  }
}

/**
 * Bilinear sample of the box, premultiplied.
 *
 * Filtering straight alpha across a glyph edge mixes the colour of pixels that
 * are not there — canvas leaves fully transparent pixels black — and every
 * letter picks up a dark fringe. Weighting colour by coverage first and
 * dividing it back out afterwards is the whole fix.
 */
function sample(
  box: PixelBuffer,
  x: number,
  y: number,
  out: Float32Array,
): void {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  let r = 0
  let g = 0
  let b = 0
  let a = 0

  for (let j = 0; j <= 1; j++) {
    const sy = y0 + j
    if (sy < 0 || sy >= box.height) continue
    const wy = j === 0 ? 1 - fy : fy
    if (wy === 0) continue

    for (let i = 0; i <= 1; i++) {
      const sx = x0 + i
      if (sx < 0 || sx >= box.width) continue
      const weight = (i === 0 ? 1 - fx : fx) * wy
      if (weight === 0) continue

      const index = (sy * box.width + sx) * 4
      const alpha = box.data[index + 3]
      const scaled = weight * alpha
      r += box.data[index] * scaled
      g += box.data[index + 1] * scaled
      b += box.data[index + 2] * scaled
      a += weight * alpha
    }
  }

  if (a > 0) {
    out[0] = r / a
    out[1] = g / a
    out[2] = b / a
  } else {
    out[0] = 0
    out[1] = 0
    out[2] = 0
  }
  out[3] = a
}

/**
 * Place the drawn box into a frame-sized buffer.
 *
 * The stencil fill inverts here rather than in the rasterizer, and has to:
 * what it covers is "the frame, except the letters", and the letters are not
 * in their final shape until they have been rotated and warped. Inverting the
 * box before placing it would stencil the box's rectangle, not the glyphs.
 */
export function placeText(
  box: PixelBuffer,
  settings: TextSettings,
  env: RenderEnv,
): PixelBuffer {
  const output = createBuffer(env.width, env.height)
  const centreX = env.width / 2 + settings.x
  const centreY = env.height / 2 + settings.y
  const radians = (settings.rotate * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const halfWidth = settings.boxWidth / 2
  const halfHeight = settings.boxHeight / 2
  // The box canvas is margin-padded; its centre is still the box's centre.
  const originX = box.width / 2
  const originY = box.height / 2

  const stencil = settings.fill === 'stencil'
  const paper = stencil ? linearRgb(swatchAt(settings.palette, settings.paper))
    : null
  const texel = new Float32Array(4)
  const data = output.data

  for (let y = 0; y < env.height; y++) {
    for (let x = 0; x < env.width; x++) {
      const dx = x + 0.5 - centreX
      const dy = y + 0.5 - centreY
      // Inverse rotation first: warps are authored in the box's own frame.
      const rx = cos * dx + sin * dy
      const ry = -sin * dx + cos * dy
      const source = unwarp(settings, rx, ry, halfWidth, halfHeight)

      sample(box, originX + source.x - 0.5, originY + source.y - 0.5, texel)

      const index = (y * env.width + x) * 4
      if (paper) {
        const coverage = 1 - texel[3]
        data[index] = paper.r
        data[index + 1] = paper.g
        data[index + 2] = paper.b
        data[index + 3] = coverage
        continue
      }

      if (texel[3] <= 0) continue
      data[index] = texel[0]
      data[index + 1] = texel[1]
      data[index + 2] = texel[2]
      data[index + 3] = texel[3]
    }
  }

  return output
}
