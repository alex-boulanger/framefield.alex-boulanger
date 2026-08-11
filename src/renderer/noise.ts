/**
 * Continuous-tone field generation.
 *
 * This module exists because the effects are tone *redistributors* — dither,
 * posterize, and ASCII re-encode the tone they are given, they do not invent
 * it. Hard-edged vector shapes produce a bimodal histogram (background spike,
 * fill spike, nothing between), and quantizing that yields flat regions rather
 * than pattern. Noise fields give the effects a full range to work in, at many
 * spatial frequencies at once, which is what makes them read as prints rather
 * than as fills.
 *
 * Everything here is a pure function of position and seed: no state, no
 * allocation per sample, and identical output for identical input.
 */

/* -------------------------------------------------------------------------
 * Hashing
 * ---------------------------------------------------------------------- */

/** Integer hash. Cheap, well-mixed enough for gradient selection. */
function hash2(x: number, y: number, seed: number): number {
  let h = seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 13), 0x297a2d39)
  return (h ^ (h >>> 16)) >>> 0
}

export function seedToInt(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  }
  return h >>> 0
}

/**
 * Unit gradients on a 256-angle wheel, precomputed.
 *
 * Trig in the inner loop is not affordable here: a domain-warped field costs
 * up to 25 `noise2` calls per pixel and each one needs four lattice gradients,
 * so a portrait export would be on the order of a hundred million `cos`/`sin`
 * calls. The table turns that into an array read.
 */
const GRADIENT_COUNT = 256
const GRADIENT_X = new Float32Array(GRADIENT_COUNT)
const GRADIENT_Y = new Float32Array(GRADIENT_COUNT)
for (let i = 0; i < GRADIENT_COUNT; i++) {
  const angle = (i / GRADIENT_COUNT) * Math.PI * 2
  GRADIENT_X[i] = Math.cos(angle)
  GRADIENT_Y[i] = Math.sin(angle)
}

/** Quintic fade — C2 continuous, so fBm sums stay smooth under derivatives. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

/* -------------------------------------------------------------------------
 * Base noise
 * ---------------------------------------------------------------------- */

/**
 * 2D gradient (Perlin-style) noise. Returns roughly -1..1.
 *
 * Gradient rather than value noise: value noise has visible axis-aligned
 * blockiness that survives into the dither pattern and reads as a grid.
 */
export function noise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi

  // Inlined rather than routed through a helper returning a tuple: this runs
  // tens of millions of times per export and the array allocation dominated.
  const h00 = hash2(xi, yi, seed) & 255
  const h10 = hash2(xi + 1, yi, seed) & 255
  const h01 = hash2(xi, yi + 1, seed) & 255
  const h11 = hash2(xi + 1, yi + 1, seed) & 255

  const d00 = GRADIENT_X[h00] * xf + GRADIENT_Y[h00] * yf
  const d10 = GRADIENT_X[h10] * (xf - 1) + GRADIENT_Y[h10] * yf
  const d01 = GRADIENT_X[h01] * xf + GRADIENT_Y[h01] * (yf - 1)
  const d11 = GRADIENT_X[h11] * (xf - 1) + GRADIENT_Y[h11] * (yf - 1)

  const u = fade(xf)
  const v = fade(yf)

  const top = d00 + u * (d10 - d00)
  const bottom = d01 + u * (d11 - d01)

  // Scale to approximately fill -1..1.
  return (top + v * (bottom - top)) * 1.4
}

export interface FbmOptions {
  octaves: number
  lacunarity: number
  gain: number
}

const DEFAULT_FBM: FbmOptions = { octaves: 5, lacunarity: 2, gain: 0.5 }

/**
 * Fractional Brownian motion — the workhorse. Summing octaves at doubling
 * frequency and halving amplitude gives structure at every scale at once,
 * which is exactly the property that makes a dither pattern look organic
 * instead of uniform.
 */
export function fbm(
  x: number,
  y: number,
  seed: number,
  options: Partial<FbmOptions> = {},
): number {
  const { octaves, lacunarity, gain } = { ...DEFAULT_FBM, ...options }

  let sum = 0
  let amplitude = 1
  let frequency = 1
  let norm = 0

  for (let i = 0; i < octaves; i++) {
    sum += amplitude * noise2(x * frequency, y * frequency, seed + i * 1013)
    norm += amplitude
    amplitude *= gain
    frequency *= lacunarity
  }

  return norm > 0 ? sum / norm : 0
}

/**
 * Ridged multifractal. Folding the noise at zero (`1 - |n|`) turns smooth
 * valleys into sharp creases, giving the erosion/vein look that flat fBm
 * cannot produce.
 */
export function ridged(
  x: number,
  y: number,
  seed: number,
  options: Partial<FbmOptions> = {},
): number {
  const { octaves, lacunarity, gain } = { ...DEFAULT_FBM, ...options }

  let sum = 0
  let amplitude = 1
  let frequency = 1
  let norm = 0

  for (let i = 0; i < octaves; i++) {
    const n =
      1 - Math.abs(noise2(x * frequency, y * frequency, seed + i * 1013))
    sum += amplitude * n * n
    norm += amplitude
    amplitude *= gain
    frequency *= lacunarity
  }

  return norm > 0 ? (sum / norm) * 2 - 1 : 0
}

/**
 * Domain warping — fBm evaluated at coordinates that are themselves displaced
 * by fBm. Two levels of it produce the marbled, fluid forms that read as
 * "generative art" rather than "noise texture"; it is the single highest-value
 * trick in this file.
 */
export function warped(
  x: number,
  y: number,
  seed: number,
  strength: number,
  options: Partial<FbmOptions> = {},
): number {
  /**
   * The four displacement lookups run at reduced octaves.
   *
   * They are *offsets*, not the image: what produces the marbling is
   * low-frequency displacement, and fine detail in a coordinate warp mostly
   * cancels out in the final lookup. Only the last evaluation — the one that
   * actually becomes tone — needs the full octave count. This is the
   * difference between 25 and 13 `noise2` calls per pixel on the default
   * field, and the two are visually near-identical.
   */
  const displace: Partial<FbmOptions> = {
    ...options,
    octaves: Math.min(options.octaves ?? DEFAULT_FBM.octaves, 2),
  }

  const q1 = fbm(x, y, seed, displace)
  const q2 = fbm(x + 5.2, y + 1.3, seed + 7717, displace)

  const r1 = fbm(
    x + strength * q1 + 1.7,
    y + strength * q2 + 9.2,
    seed,
    displace,
  )
  const r2 = fbm(
    x + strength * q1 + 8.3,
    y + strength * q2 + 2.8,
    seed + 3301,
    displace,
  )

  return fbm(x + strength * r1, y + strength * r2, seed + 991, options)
}

/* -------------------------------------------------------------------------
 * Flow
 * ---------------------------------------------------------------------- */

/**
 * Divergence-free direction from the perpendicular of the noise gradient.
 *
 * Curl of a scalar potential never has sources or sinks, so streamlines swirl
 * rather than converging into blobs — the difference between a flow field that
 * looks like smoke and one that looks like a drain.
 */
export function curl(
  x: number,
  y: number,
  seed: number,
  options: Partial<FbmOptions> = {},
): [number, number] {
  const epsilon = 0.0015
  const dx =
    fbm(x + epsilon, y, seed, options) - fbm(x - epsilon, y, seed, options)
  const dy =
    fbm(x, y + epsilon, seed, options) - fbm(x, y - epsilon, seed, options)

  // Perpendicular of the gradient, normalized.
  const length = Math.hypot(dx, dy) || 1
  return [dy / length, -dx / length]
}

/** White noise in 0..1, used as the texture that flow smears. */
export function whiteNoise(x: number, y: number, seed: number): number {
  return hash2(x | 0, y | 0, seed) / 4294967296
}

/**
 * A curl field baked onto a coarse grid.
 *
 * Evaluating `curl` inside the LIC walk is what made the flow field unusable:
 * each curl is four `fbm` calls, and a 14-step walk in both directions costs
 * 28 of them — 560 `noise2` evaluations per pixel, or 22 seconds for a portrait
 * export. The field is smooth by construction, so sampling a baked grid with
 * bilinear interpolation is visually indistinguishable and turns the walk into
 * array reads.
 */
export interface FlowField {
  cols: number
  rows: number
  uMax: number
  vMax: number
  vx: Float32Array
  vy: Float32Array
}

export function buildFlowField(
  cols: number,
  rows: number,
  uMax: number,
  vMax: number,
  seed: number,
  fieldScale: number,
  options: Partial<FbmOptions> = {},
): FlowField {
  const vx = new Float32Array(cols * rows)
  const vy = new Float32Array(cols * rows)

  for (let row = 0; row < rows; row++) {
    const v = (row / (rows - 1)) * vMax
    for (let col = 0; col < cols; col++) {
      const u = (col / (cols - 1)) * uMax
      const [x, y] = curl(u * fieldScale, v * fieldScale, seed, options)
      vx[row * cols + col] = x
      vy[row * cols + col] = y
    }
  }

  return { cols, rows, uMax, vMax, vx, vy }
}

/** Bilinear sample, clamped at the edges. Returns a unit-ish direction. */
export function sampleFlowField(
  field: FlowField,
  u: number,
  v: number,
): [number, number] {
  const { cols, rows, uMax, vMax, vx, vy } = field

  const fx = Math.max(0, Math.min(1, u / uMax)) * (cols - 1)
  const fy = Math.max(0, Math.min(1, v / vMax)) * (rows - 1)
  const x0 = Math.min(cols - 1, fx | 0)
  const y0 = Math.min(rows - 1, fy | 0)
  const x1 = Math.min(cols - 1, x0 + 1)
  const y1 = Math.min(rows - 1, y0 + 1)
  const tx = fx - x0
  const ty = fy - y0

  const i00 = y0 * cols + x0
  const i10 = y0 * cols + x1
  const i01 = y1 * cols + x0
  const i11 = y1 * cols + x1

  const top = vx[i00] + (vx[i10] - vx[i00]) * tx
  const bottom = vx[i01] + (vx[i11] - vx[i01]) * tx
  const outX = top + (bottom - top) * ty

  const topY = vy[i00] + (vy[i10] - vy[i00]) * tx
  const bottomY = vy[i01] + (vy[i11] - vy[i01]) * tx
  const outY = topY + (bottomY - topY) * ty

  return [outX, outY]
}

export interface LicOptions {
  /** Samples taken in each direction along the streamline. */
  steps: number
  /** Distance between samples, in the same units as the input coordinates. */
  stepLength: number
  /**
   * Multiplier turning input coordinates into texture-lattice coordinates.
   *
   * This has to be separate from the flow field's own scale. The field wants a
   * handful of units across the whole image; the texture being smeared wants
   * roughly one cell per pixel. Sampling the texture in field units gives a
   * dozen enormous blocks and the convolution has nothing to average — the
   * streaks vanish entirely.
   */
  textureScale: number
}

/**
 * Line integral convolution: average a white-noise texture along the flow
 * streamline through each point.
 *
 * This is what makes a vector field *visible* as silky directional striations.
 * Advecting particles and accumulating hits would also work, but LIC is
 * per-pixel and order-independent, so it stays deterministic and parallelizes
 * cleanly if this ever moves to a worker.
 */
export function lic(
  x: number,
  y: number,
  seed: number,
  field: FlowField,
  options: LicOptions,
): number {
  const { steps, stepLength, textureScale } = options

  let sum = whiteNoise(x * textureScale, y * textureScale, seed)
  let count = 1

  // Walk both directions so the streak is centred on the sample.
  for (const direction of [1, -1]) {
    let px = x
    let py = y

    for (let i = 0; i < steps; i++) {
      const [vx, vy] = sampleFlowField(field, px, py)
      px += vx * stepLength * direction
      py += vy * stepLength * direction
      sum += whiteNoise(px * textureScale, py * textureScale, seed)
      count++
    }
  }

  return sum / count
}
