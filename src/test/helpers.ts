import { createBuffer, luma, srgbToLinear } from '#/renderer/buffer'
import type { PixelBuffer } from '#/renderer/buffer'
import type { RenderEnv } from '#/renderer/types'

/**
 * Test fixtures operate on `PixelBuffer` in **linear light**, same as the
 * pipeline. Where a test needs to reason in the values a designer would type,
 * the helper takes perceptual input and converts — `solidSrgb` — so the
 * intent stays readable.
 */

/** Uniform buffer from linear 0..1 components. */
export function solid(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  a = 1,
): PixelBuffer {
  const buffer = createBuffer(width, height)
  const d = buffer.data
  for (let i = 0; i < d.length; i += 4) {
    d[i] = r
    d[i + 1] = g
    d[i + 2] = b
    d[i + 3] = a
  }
  return buffer
}

/** Uniform buffer from 0..255 sRGB components, converted to linear. */
export function solidSrgb(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
): PixelBuffer {
  return solid(
    width,
    height,
    srgbToLinear(r / 255),
    srgbToLinear(g / 255),
    srgbToLinear(b / 255),
  )
}

/**
 * Horizontal ramp, even in *perceptual* steps. An even linear ramp spends most
 * of its width looking white, which makes tonal assertions misleading.
 */
export function gradient(width: number, height: number): PixelBuffer {
  const buffer = createBuffer(width, height)
  const d = buffer.data

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const value = srgbToLinear(x / Math.max(1, width - 1))
      d[i] = value
      d[i + 1] = value
      d[i + 2] = value
      d[i + 3] = 1
    }
  }

  return buffer
}

export function pixel(
  buffer: PixelBuffer,
  x: number,
  y: number,
): [number, number, number, number] {
  const i = (y * buffer.width + x) * 4
  const d = buffer.data
  return [d[i], d[i + 1], d[i + 2], d[i + 3]]
}

export function meanLuminance(buffer: PixelBuffer): number {
  let sum = 0
  for (let i = 0; i < buffer.data.length; i += 4) sum += luma(buffer, i)
  return sum / (buffer.data.length / 4)
}

/** Distinct RGB triples, rounded so float noise does not inflate the count. */
export function uniqueColors(buffer: PixelBuffer, places = 4): Set<string> {
  const colors = new Set<string>()
  const d = buffer.data
  for (let i = 0; i < d.length; i += 4) {
    colors.add(
      `${d[i].toFixed(places)},${d[i + 1].toFixed(places)},${d[i + 2].toFixed(places)}`,
    )
  }
  return colors
}

export function env(buffer: PixelBuffer, scale = 1): RenderEnv {
  return { scale, width: buffer.width, height: buffer.height }
}

/**
 * True when the image is composed of uniform `cell`-sized blocks. This is how
 * the tests verify that a spatial param actually scaled: the block size is the
 * observable consequence of `pixelSize`.
 */
export function hasUniformCells(buffer: PixelBuffer, cell: number): boolean {
  for (let y = 0; y < buffer.height; y++) {
    for (let x = 0; x < buffer.width; x++) {
      const anchor = pixel(buffer, x - (x % cell), y - (y % cell))
      const here = pixel(buffer, x, y)
      if (
        anchor[0] !== here[0] ||
        anchor[1] !== here[1] ||
        anchor[2] !== here[2]
      ) {
        return false
      }
    }
  }
  return true
}
