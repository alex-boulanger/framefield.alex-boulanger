/**
 * The pipeline's working format: RGBA float in **linear light**.
 *
 * Two reasons this replaces 8-bit sRGB `ImageData` as the currency:
 *
 * 1. Correctness. Light adds linearly; sRGB values do not. Averaging, blurring,
 *    blending, and — critically — dithering all assume linear arithmetic. A
 *    dither that thresholds sRGB values puts too many lit pixels in the
 *    shadows, and the result reads visibly washed out.
 * 2. Headroom. Every 8-bit pass requantizes, so banding compounds down a stack.
 *    Float carries the error until the single conversion at the end.
 *
 * Conversion happens exactly twice per render: once entering, once leaving.
 */

export interface PixelBuffer {
  /** RGBA, linear light, nominally 0..1 — passes may transiently exceed it. */
  data: Float32Array
  width: number
  height: number
}

export function createBuffer(width: number, height: number): PixelBuffer {
  return { data: new Float32Array(width * height * 4), width, height }
}

export function cloneBuffer(buffer: PixelBuffer): PixelBuffer {
  return {
    data: new Float32Array(buffer.data),
    width: buffer.width,
    height: buffer.height,
  }
}

export function sameSize(a: PixelBuffer, b: PixelBuffer): boolean {
  return a.width === b.width && a.height === b.height
}

/* -------------------------------------------------------------------------
 * sRGB transfer
 * ---------------------------------------------------------------------- */

export function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

export function linearToSrgb(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055
}

/** Decode is exact: only 256 possible inputs. */
const DECODE = new Float32Array(256)
for (let i = 0; i < 256; i++) DECODE[i] = srgbToLinear(i / 255)

/**
 * Encode is a lookup too, because the direct form needs a `pow` per channel and
 * a 1080x1920 export is six million of them. 16k entries keeps the error below
 * a quarter of an output step, which is invisible after rounding to 8 bits.
 */
const ENCODE_STEPS = 16384
const ENCODE = new Uint8Array(ENCODE_STEPS + 1)
for (let i = 0; i <= ENCODE_STEPS; i++) {
  ENCODE[i] = Math.round(linearToSrgb(i / ENCODE_STEPS) * 255)
}

function encode(value: number): number {
  if (value <= 0) return 0
  if (value >= 1) return 255
  return ENCODE[(value * ENCODE_STEPS) | 0]
}

export function fromImageData(image: ImageData): PixelBuffer {
  const buffer = createBuffer(image.width, image.height)
  const src = image.data
  const dst = buffer.data

  for (let i = 0; i < src.length; i += 4) {
    dst[i] = DECODE[src[i]]
    dst[i + 1] = DECODE[src[i + 1]]
    dst[i + 2] = DECODE[src[i + 2]]
    // Alpha is not a light measurement — it stays linear in its own right.
    dst[i + 3] = src[i + 3] / 255
  }

  return buffer
}

export function toImageData(buffer: PixelBuffer): ImageData {
  const out = new Uint8ClampedArray(buffer.width * buffer.height * 4)
  const src = buffer.data

  for (let i = 0; i < src.length; i += 4) {
    out[i] = encode(src[i])
    out[i + 1] = encode(src[i + 1])
    out[i + 2] = encode(src[i + 2])
    out[i + 3] = Math.round(Math.max(0, Math.min(1, src[i + 3])) * 255)
  }

  return new ImageData(out, buffer.width, buffer.height)
}

/* -------------------------------------------------------------------------
 * Perceptual space
 * ---------------------------------------------------------------------- */

/**
 * Float sRGB <-> linear, via lookup.
 *
 * Not everything belongs in linear light. Blend modes and tone quantization are
 * artistic controls defined against *perceived* lightness: `multiply` computed
 * in linear light is far darker than anyone expects, and posterize levels
 * spaced linearly bunch all their steps in the shadows. Those operations hop
 * into perceptual space and back; light-mixing operations (blur, opacity
 * crossfade, dither averaging) stay linear.
 */
const PERCEPTUAL_STEPS = 4096
const TO_PERCEPTUAL = new Float32Array(PERCEPTUAL_STEPS + 1)
const FROM_PERCEPTUAL = new Float32Array(PERCEPTUAL_STEPS + 1)
for (let i = 0; i <= PERCEPTUAL_STEPS; i++) {
  TO_PERCEPTUAL[i] = linearToSrgb(i / PERCEPTUAL_STEPS)
  FROM_PERCEPTUAL[i] = srgbToLinear(i / PERCEPTUAL_STEPS)
}

export function toPerceptual(linear: number): number {
  if (linear <= 0) return 0
  if (linear >= 1) return 1
  return TO_PERCEPTUAL[(linear * PERCEPTUAL_STEPS) | 0]
}

export function fromPerceptual(perceptual: number): number {
  if (perceptual <= 0) return 0
  if (perceptual >= 1) return 1
  return FROM_PERCEPTUAL[(perceptual * PERCEPTUAL_STEPS) | 0]
}

/* -------------------------------------------------------------------------
 * Sampling
 * ---------------------------------------------------------------------- */

/** Rec. 709 luma of a linear-light pixel. */
export function luma(buffer: PixelBuffer, index: number): number {
  const d = buffer.data
  return 0.2126 * d[index] + 0.7152 * d[index + 1] + 0.0722 * d[index + 2]
}

export function setPixel(
  buffer: PixelBuffer,
  index: number,
  r: number,
  g: number,
  b: number,
  a = 1,
): void {
  const d = buffer.data
  d[index] = r
  d[index + 1] = g
  d[index + 2] = b
  d[index + 3] = a
}

/* -------------------------------------------------------------------------
 * Blur
 * ---------------------------------------------------------------------- */

/**
 * Box sizes whose repeated application approximates a gaussian of `sigma`.
 * Standard construction (Kutskir): three boxes get within ~3% of a true
 * gaussian, which is far below what is visible in an image.
 */
function boxSizesForGaussian(sigma: number, passes: number): Array<number> {
  const ideal = Math.sqrt((12 * sigma * sigma) / passes + 1)
  let lower = Math.floor(ideal)
  if (lower % 2 === 0) lower--
  const upper = lower + 2

  const idealM =
    (12 * sigma * sigma -
      passes * lower * lower -
      4 * passes * lower -
      3 * passes) /
    (-4 * lower - 4)
  const m = Math.round(idealM)

  return Array.from({ length: passes }, (_, i) => (i < m ? lower : upper))
}

/** One horizontal box pass with a running sum — O(1) per pixel, not O(radius). */
function boxBlurH(
  src: Float32Array,
  dst: Float32Array,
  width: number,
  height: number,
  radius: number,
): void {
  if (radius < 1) {
    dst.set(src)
    return
  }
  const span = radius * 2 + 1

  for (let y = 0; y < height; y++) {
    const row = y * width * 4

    for (let c = 0; c < 4; c++) {
      // Seed the window with the clamped left edge.
      let sum = src[row + c] * (radius + 1)
      for (let x = 1; x <= radius; x++) {
        sum += src[row + Math.min(x, width - 1) * 4 + c]
      }

      for (let x = 0; x < width; x++) {
        dst[row + x * 4 + c] = sum / span
        const add = src[row + Math.min(x + radius + 1, width - 1) * 4 + c]
        const drop = src[row + Math.max(x - radius, 0) * 4 + c]
        sum += add - drop
      }
    }
  }
}

/** Vertical counterpart. Separability is what makes the whole thing cheap. */
function boxBlurV(
  src: Float32Array,
  dst: Float32Array,
  width: number,
  height: number,
  radius: number,
): void {
  if (radius < 1) {
    dst.set(src)
    return
  }
  const span = radius * 2 + 1
  const stride = width * 4

  for (let x = 0; x < width; x++) {
    const column = x * 4

    for (let c = 0; c < 4; c++) {
      let sum = src[column + c] * (radius + 1)
      for (let y = 1; y <= radius; y++) {
        sum += src[Math.min(y, height - 1) * stride + column + c]
      }

      for (let y = 0; y < height; y++) {
        dst[y * stride + column + c] = sum / span
        const add =
          src[Math.min(y + radius + 1, height - 1) * stride + column + c]
        const drop = src[Math.max(y - radius, 0) * stride + column + c]
        sum += add - drop
      }
    }
  }
}

/**
 * Box blur of a single-channel plane, in place.
 *
 * The RGBA blur above is the wrong shape for scalar work like a tone field —
 * this avoids padding a Float32Array out to four channels just to smooth it.
 */
export function blurPlane(
  plane: Float32Array,
  width: number,
  height: number,
  radius: number,
): void {
  if (radius < 1) return
  const span = radius * 2 + 1
  const scratch = new Float32Array(plane.length)

  for (let y = 0; y < height; y++) {
    const row = y * width
    let sum = plane[row] * (radius + 1)
    for (let x = 1; x <= radius; x++) sum += plane[row + Math.min(x, width - 1)]

    for (let x = 0; x < width; x++) {
      scratch[row + x] = sum / span
      sum +=
        plane[row + Math.min(x + radius + 1, width - 1)] -
        plane[row + Math.max(x - radius, 0)]
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = scratch[x] * (radius + 1)
    for (let y = 1; y <= radius; y++) {
      sum += scratch[Math.min(y, height - 1) * width + x]
    }

    for (let y = 0; y < height; y++) {
      plane[y * width + x] = sum / span
      sum +=
        scratch[Math.min(y + radius + 1, height - 1) * width + x] -
        scratch[Math.max(y - radius, 0) * width + x]
    }
  }
}

/**
 * Gaussian blur, in place, in linear light.
 *
 * Approximated with three box passes rather than a true convolution: a real
 * gaussian at sigma 20 needs ~121 taps per axis, which is 350M multiply-adds on
 * a portrait export. The box form is a constant four adds per pixel per pass
 * regardless of radius, so blur stops being a param users have to be afraid of.
 */
export function blur(buffer: PixelBuffer, sigma: number): PixelBuffer {
  if (sigma <= 0) return buffer

  const { width, height } = buffer
  const data = buffer.data
  // One scratch allocation for all six passes. H writes into it, V writes back
  // out of it, so `data` holds the result after every pair — no ping-pong
  // bookkeeping needed.
  const scratch = new Float32Array(data.length)

  for (const size of boxSizesForGaussian(sigma, 3)) {
    const radius = (size - 1) / 2
    boxBlurH(data, scratch, width, height, radius)
    boxBlurV(scratch, data, width, height, radius)
  }

  return buffer
}
