import { describe, expect, it } from 'vitest'
import { renderRecipe, renderSource } from './renderRecipe'
import { createLayer } from './recipe'
import type { Layer, Params, Recipe } from './types'
import { createBuffer } from './buffer'
import type { PixelBuffer } from './buffer'
import { gradient, hasUniformCells, meanLuminance, pixel } from '#/test/helpers'

/**
 * Pipeline tests.
 *
 * `renderRecipe` takes a pre-rendered `sourceImage`, so supplying one bypasses
 * the generator's canvas entirely and the whole layer loop — ordering, enable
 * flags, opacity, blending — becomes testable in plain node.
 */

function recipe(layers: Array<Layer>, size = 64): Recipe {
  return {
    version: 1,
    source: { type: 'image', name: 'test' },
    canvas: { width: size, height: size },
    layers,
  }
}

function layer(
  type: Layer['type'],
  params: Params = {},
  overrides: Partial<Layer> = {},
): Layer {
  const created = createLayer(type)
  return { ...created, ...overrides, params: { ...created.params, ...params } }
}

describe('renderRecipe', () => {
  it('returns the source untouched for an empty stack', () => {
    const source = gradient(64, 64)
    const result = renderRecipe({ recipe: recipe([]), sourceImage: source })
    expect(Array.from(result.data)).toEqual(Array.from(source.data))
  })

  it('does not mutate the supplied source buffer', () => {
    const source = gradient(64, 64)
    const before = Array.from(source.data)
    renderRecipe({
      recipe: recipe([layer('posterize', { levels: 2 })]),
      sourceImage: source,
    })
    expect(Array.from(source.data)).toEqual(before)
  })

  it('skips disabled layers', () => {
    const source = gradient(64, 64)
    const enabled = renderRecipe({
      recipe: recipe([layer('posterize', { levels: 2 })]),
      sourceImage: source,
    })
    const disabled = renderRecipe({
      recipe: recipe([layer('posterize', { levels: 2 }, { enabled: false })]),
      sourceImage: source,
    })

    expect(Array.from(disabled.data)).toEqual(Array.from(source.data))
    expect(Array.from(enabled.data)).not.toEqual(Array.from(source.data))
  })

  it('treats a zero-opacity layer as a no-op', () => {
    const source = gradient(64, 64)
    const result = renderRecipe({
      recipe: recipe([layer('posterize', { levels: 2 }, { opacity: 0 })]),
      sourceImage: source,
    })
    expect(Array.from(result.data)).toEqual(Array.from(source.data))
  })

  it('blends a partial-opacity layer between source and full effect', () => {
    const source = gradient(64, 64)
    const params = { levels: 2, mode: 'rgb' }

    const full = renderRecipe({
      recipe: recipe([layer('posterize', params)]),
      sourceImage: source,
    })
    const half = renderRecipe({
      recipe: recipe([layer('posterize', params, { opacity: 0.5 })]),
      sourceImage: source,
    })

    // The half-strength result must sit strictly between the two extremes.
    const x = 20
    const lo = Math.min(pixel(source, x, 0)[0], pixel(full, x, 0)[0])
    const hi = Math.max(pixel(source, x, 0)[0], pixel(full, x, 0)[0])
    expect(pixel(half, x, 0)[0]).toBeGreaterThanOrEqual(lo)
    expect(pixel(half, x, 0)[0]).toBeLessThanOrEqual(hi)
    expect(pixel(half, x, 0)[0]).not.toBe(pixel(full, x, 0)[0])
  })

  it('applies layers in stack order', () => {
    const source = gradient(64, 64)
    // Dither is cell-based, so it does not commute with a channel shift.
    // (Posterize would: a pointwise op composes with any index remap in either
    // order, which makes it useless for detecting ordering.)
    const dither = layer('dither', { pixelSize: 4, mode: 'mono' })
    const drift = layer('channel-drift', { redX: 9, jitter: 0 })

    const a = renderRecipe({
      recipe: recipe([dither, drift]),
      sourceImage: source,
    })
    const b = renderRecipe({
      recipe: recipe([drift, dither]),
      sourceImage: source,
    })

    expect(Array.from(a.data)).not.toEqual(Array.from(b.data))
  })

  it('composes pointwise effects independently of order', () => {
    // The converse, stated deliberately: posterize and channel drift commute,
    // so a change here means one of them stopped being a pure pointwise op or
    // a pure index remap.
    const source = gradient(64, 64)
    const posterize = layer('posterize', { levels: 3, mode: 'rgb' })
    const drift = layer('channel-drift', { redX: 8, jitter: 0 })

    const a = renderRecipe({
      recipe: recipe([posterize, drift]),
      sourceImage: source,
    })
    const b = renderRecipe({
      recipe: recipe([drift, posterize]),
      sourceImage: source,
    })

    expect(Array.from(a.data)).toEqual(Array.from(b.data))
  })

  it('ignores a cached source of the wrong size', () => {
    // A stale cache must never be used at the wrong dimensions. The render
    // falls back to the source path and comes out at the recipe's size.
    const result = renderRecipe({
      recipe: recipe([], 64),
      sourceImage: gradient(32, 32),
    })
    expect([result.width, result.height]).toEqual([64, 64])
  })

  it('is deterministic', () => {
    const layers = [
      layer('posterize', { levels: 4 }),
      layer('dither', { pixelSize: 3 }),
      layer('channel-drift', { jitter: 6, seed: 'fixed' }),
    ]
    const a = renderRecipe({
      recipe: recipe(layers),
      sourceImage: gradient(64, 64),
    })
    const b = renderRecipe({
      recipe: recipe(layers),
      sourceImage: gradient(64, 64),
    })
    expect(Array.from(a.data)).toEqual(Array.from(b.data))
  })
})

describe('renderSource', () => {
  it('draws imported sources without canvas smoothing', () => {
    const originalDocument = globalThis.document
    let smoothingAtDraw: boolean | null = null

    globalThis.document = {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          imageSmoothingEnabled: true,
          drawImage() {
            smoothingAtDraw = this.imageSmoothingEnabled
          },
          getImageData: () => new ImageData(8, 8),
        }),
      }),
    } as unknown as Document

    try {
      renderSource({
        recipe: {
          version: 1,
          source: { type: 'image', name: 'pixel-art.png' },
          canvas: { width: 8, height: 8 },
          layers: [],
        },
        bitmap: { width: 4, height: 4 } as ImageBitmap,
      })
    } finally {
      globalThis.document = originalDocument
    }

    expect(smoothingAtDraw).toBe(false)
  })
})

/**
 * Scale fidelity — the decision the whole param model rests on.
 *
 * Params are authored in export-space pixels and multiplied by the render
 * scale, so a half-scale preview must be a faithful miniature of the export
 * rather than a differently-quantized image. Nothing else in the codebase
 * enforces that; these tests do.
 */
describe('scale fidelity', () => {
  const SIZE = 128

  function renderAt(scale: number, layers: Array<Layer>): PixelBuffer {
    const side = Math.round(SIZE * scale)
    return renderRecipe({
      recipe: recipe(layers, SIZE),
      sourceImage: gradient(side, side),
      scale,
    })
  }

  it('keeps overall tone stable across scales', () => {
    // Pixelate carries the spatial param now; pairing it with dither keeps
    // this exercising the scaling rather than a per-pixel op that cannot fail.
    const layers = [
      layer('pixelate', { size: 4 }),
      layer('dither', { mode: 'mono' }),
    ]
    const full = meanLuminance(renderAt(1, layers))
    const half = meanLuminance(renderAt(0.5, layers))
    const quarter = meanLuminance(renderAt(0.25, layers))

    expect(half).toBeCloseTo(full, 1)
    expect(quarter).toBeCloseTo(full, 1)
  })

  it('keeps pixelate cell size proportional to the image', () => {
    // 8px cells at export size stay 8px; at half scale they become 4px, which
    // is the same fraction of a half-size image.
    expect(
      hasUniformCells(renderAt(1, [layer('pixelate', { size: 8 })]), 8),
    ).toBe(true)
    expect(
      hasUniformCells(renderAt(0.5, [layer('pixelate', { size: 8 })]), 4),
    ).toBe(true)
    expect(
      hasUniformCells(renderAt(0.25, [layer('pixelate', { size: 8 })]), 2),
    ).toBe(true)
  })

  it('keeps pixelate and posterize structure stable across scales', () => {
    const layers = [
      layer('pixelate', { size: 8, sampling: 'average' }),
      layer('posterize', { levels: 4, mode: 'duotone' }),
    ]
    const full = renderAt(1, layers)
    const half = renderAt(0.5, layers)

    let mismatches = 0
    for (let y = 0; y < half.height; y++) {
      for (let x = 0; x < half.width; x++) {
        const halfPixel = pixel(half, x, y)
        const fullPixel = pixel(full, x * 2, y * 2)
        if (
          Math.abs(halfPixel[0] - fullPixel[0]) > 0.03 ||
          Math.abs(halfPixel[1] - fullPixel[1]) > 0.03 ||
          Math.abs(halfPixel[2] - fullPixel[2]) > 0.03
        ) {
          mismatches += 1
        }
      }
    }

    expect(mismatches / (half.width * half.height)).toBeLessThan(0.02)
  })

  it('keeps channel offsets proportional to the image', () => {
    // A *step* source, not a gradient. A smooth ramp has no edge to locate, so
    // the previous version of this test found nothing in either render and
    // compared -1 to -1 — it passed without measuring anything.
    const layers = [layer('channel-drift', { redX: 16, jitter: 0 })]

    const renderStepAt = (scale: number) => {
      const side = Math.round(SIZE * scale)
      return renderRecipe({
        recipe: recipe(layers, SIZE),
        sourceImage: step(side, side, side / 2),
        scale,
      })
    }

    const full = renderStepAt(1)
    const half = renderStepAt(0.5)

    const edgeFull = findRedEdge(full)
    const edgeHalf = findRedEdge(half)
    expect(edgeFull).toBeGreaterThan(0)
    expect(edgeHalf).toBeGreaterThan(0)

    // Both edges land at the same fraction across the image: the source seam
    // is at 50% and a 16px shift is 12.5% of a 128px canvas at either scale.
    expect(edgeFull / full.width).toBeCloseTo(edgeHalf / half.width, 1)
    expect(edgeFull / full.width).toBeCloseTo(0.375, 1)
  })

  it('would fail if a spatial param ignored the scale', () => {
    // Sensitivity check: rendering the half-size source *without* telling the
    // renderer it is half scale must produce visibly different structure. If
    // this ever passes, the scaling above has stopped doing anything.
    const layers = [layer('pixelate', { size: 8 })]
    const correct = renderAt(0.5, layers)
    const unscaled = renderRecipe({
      recipe: recipe(layers, SIZE / 2),
      sourceImage: gradient(SIZE / 2, SIZE / 2),
      scale: 1,
    })
    expect(Array.from(correct.data)).not.toEqual(Array.from(unscaled.data))
  })
})

/** Vertical step: 0 left of `edge`, 1 from `edge` on. */
function step(width: number, height: number, edge: number): PixelBuffer {
  const buffer = createBuffer(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const value = x >= edge ? 1 : 0
      buffer.data[i] = value
      buffer.data[i + 1] = value
      buffer.data[i + 2] = value
      buffer.data[i + 3] = 1
    }
  }
  return buffer
}

/** First x where the red channel rises, scanning the top row. */
function findRedEdge(buffer: PixelBuffer): number {
  for (let x = 1; x < buffer.width; x++) {
    if (pixel(buffer, x, 0)[0] > pixel(buffer, x - 1, 0)[0] + 0.03) return x
  }
  return -1
}
