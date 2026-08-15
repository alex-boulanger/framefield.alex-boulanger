import { describe, expect, it } from 'vitest'
import { renderRecipe, renderStack } from './renderRecipe'
import {
  createEffectLayer,
  createGeneratorLayer,
  createImageLayer,
  createTextLayer,
} from './recipe'
import type { EffectType, Layer, LayerBase, Params, Recipe } from './types'
import { createBuffer } from './buffer'
import type { PixelBuffer } from './buffer'
import { gradient, hasUniformCells, meanLuminance, pixel } from '#/test/helpers'

/**
 * Pipeline tests.
 *
 * Resuming from index 0 hands the renderer a ready-made accumulator, which
 * bypasses every canvas in the pipeline and leaves the layer loop — ordering,
 * enable flags, opacity, blending — testable in plain node.
 */

function recipe(layers: Array<Layer>, size = 64): Recipe {
  return {
    version: 2,
    canvas: { width: size, height: size },
    background: '#000000',
    layers,
  }
}

function layer(
  type: EffectType,
  params: Params = {},
  overrides: Partial<LayerBase> = {},
): Layer {
  const created = createEffectLayer(type)
  return { ...created, ...overrides, params: { ...created.params, ...params } }
}

describe('renderRecipe', () => {
  it('returns the source untouched for an empty stack', () => {
    const source = gradient(64, 64)
    const result = renderRecipe({ recipe: recipe([]), resume: { index: 0, buffer: source } })
    expect(Array.from(result.data)).toEqual(Array.from(source.data))
  })

  it('does not mutate the supplied source buffer', () => {
    const source = gradient(64, 64)
    const before = Array.from(source.data)
    renderRecipe({
      recipe: recipe([layer('posterize', { levels: 2 })]),
      resume: { index: 0, buffer: source },
    })
    expect(Array.from(source.data)).toEqual(before)
  })

  it('skips disabled layers', () => {
    const source = gradient(64, 64)
    const enabled = renderRecipe({
      recipe: recipe([layer('posterize', { levels: 2 })]),
      resume: { index: 0, buffer: source },
    })
    const disabled = renderRecipe({
      recipe: recipe([layer('posterize', { levels: 2 }, { enabled: false })]),
      resume: { index: 0, buffer: source },
    })

    expect(Array.from(disabled.data)).toEqual(Array.from(source.data))
    expect(Array.from(enabled.data)).not.toEqual(Array.from(source.data))
  })

  it('treats a zero-opacity layer as a no-op', () => {
    const source = gradient(64, 64)
    const result = renderRecipe({
      recipe: recipe([layer('posterize', { levels: 2 }, { opacity: 0 })]),
      resume: { index: 0, buffer: source },
    })
    expect(Array.from(result.data)).toEqual(Array.from(source.data))
  })

  it('blends a partial-opacity layer between source and full effect', () => {
    const source = gradient(64, 64)
    const params = { levels: 2, mode: 'rgb' }

    const full = renderRecipe({
      recipe: recipe([layer('posterize', params)]),
      resume: { index: 0, buffer: source },
    })
    const half = renderRecipe({
      recipe: recipe([layer('posterize', params, { opacity: 0.5 })]),
      resume: { index: 0, buffer: source },
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
      resume: { index: 0, buffer: source },
    })
    const b = renderRecipe({
      recipe: recipe([drift, dither]),
      resume: { index: 0, buffer: source },
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
      resume: { index: 0, buffer: source },
    })
    const b = renderRecipe({
      recipe: recipe([drift, posterize]),
      resume: { index: 0, buffer: source },
    })

    expect(Array.from(a.data)).toEqual(Array.from(b.data))
  })

  it('ignores a cached source of the wrong size', () => {
    // A stale cache must never be used at the wrong dimensions. The render
    // falls back to the source path and comes out at the recipe's size.
    const result = renderRecipe({
      recipe: recipe([], 64),
      resume: { index: 0, buffer: gradient(32, 32) },
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
      resume: { index: 0, buffer: gradient(64, 64) },
    })
    const b = renderRecipe({
      recipe: recipe(layers),
      resume: { index: 0, buffer: gradient(64, 64) },
    })
    expect(Array.from(a.data)).toEqual(Array.from(b.data))
  })
})

describe('image layers', () => {
  it('draws imported pixels without canvas smoothing', () => {
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
      renderRecipe({
        recipe: recipe([imageLayer('photo')], 8),
        assets: { photo: { width: 4, height: 4 } as ImageBitmap },
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
      resume: { index: 0, buffer: gradient(side, side) },
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
        resume: { index: 0, buffer: step(side, side, side / 2) },
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
      resume: { index: 0, buffer: gradient(SIZE / 2, SIZE / 2) },
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

/* -------------------------------------------------------------------------
 * Unified stack semantics
 * ---------------------------------------------------------------------- */

function generatorLayer(
  seed: string,
  overrides: Partial<LayerBase> = {},
): Layer {
  const created = createGeneratorLayer(seed)
  return { ...created, ...overrides }
}

function imageLayer(
  asset: string,
  params: Params = {},
  overrides: Partial<LayerBase> = {},
): Layer {
  const created = createImageLayer(asset, asset)
  return { ...created, ...overrides, params: { ...created.params, ...params } }
}

function textLayer(params: Params = {}, overrides: Partial<LayerBase> = {}): Layer {
  const created = createTextLayer()
  return { ...created, ...overrides, params: { ...created.params, ...params } }
}

/**
 * Stand in for the one canvas the pipeline still touches.
 *
 * Image layers are the only source that cannot be rendered in node, so the
 * bitmap they would have drawn is supplied directly — which is what makes
 * coverage, the thing source compositing turns on, testable at all.
 */
function withFakeCanvas<T>(image: ImageData, run: () => T): T {
  const original = globalThis.document
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        imageSmoothingEnabled: true,
        drawImage() {},
        getImageData: () => image,
      }),
    }),
  } as unknown as Document

  try {
    return run()
  } finally {
    globalThis.document = original
  }
}

/** RGBA sRGB bytes: opaque white on the left half, transparent on the right. */
function halfCovered(size: number): ImageData {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size / 2; x++) {
      const i = (y * size + x) * 4
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
      data[i + 3] = 255
    }
  }
  return new ImageData(data, size, size)
}

describe('source layers', () => {
  it('renders a 2D text layer as source pixels', () => {
    const result = renderRecipe({
      recipe: recipe(
        [
          textLayer({
            text: 'A',
            width: 32,
            height: 16,
            size: 12,
            fill: '#ffffff',
          }),
        ],
        64,
      ),
    })

    expect(meanLuminance(result)).toBeGreaterThan(0)
    expect(pixel(result, 0, 0)[0]).toBeCloseTo(0, 5)
  })

  it('treats 2D text with later effects', () => {
    const text = textLayer({
      text: 'A',
      width: 32,
      height: 16,
      size: 12,
      fill: '#888888',
    })
    const plain = renderRecipe({ recipe: recipe([text], 64) })
    const treated = renderRecipe({
      recipe: recipe([text, layer('posterize', { levels: 2, mode: 'rgb' })], 64),
    })

    expect(Array.from(treated.data)).not.toEqual(Array.from(plain.data))
  })

  it('gives pixel sort textured 2D text to reorder', () => {
    const text = textLayer({
      text: 'The quick brown fox jumps over the lazy dog',
      width: 56,
      height: 44,
      size: 12,
      treatment: 'stripes',
    })
    const plain = renderRecipe({ recipe: recipe([text], 64) })
    const sorted = renderRecipe({
      recipe: recipe(
        [text, layer('pixel-sort', { low: 0, high: 1, maxRun: 64 })],
        64,
      ),
    })

    expect(Array.from(sorted.data)).not.toEqual(Array.from(plain.data))
  })

  it('composites by coverage rather than replacing the stack', () => {
    const beneath = gradient(16, 16)
    const result = withFakeCanvas(halfCovered(16), () =>
      renderRecipe({
        recipe: recipe([imageLayer('photo')], 16),
        assets: { photo: { width: 16, height: 16 } as ImageBitmap },
        resume: { index: 0, buffer: beneath },
      }),
    )

    // Covered half takes the layer's pixels; uncovered half is untouched.
    expect(pixel(result, 2, 0)[0]).toBeCloseTo(1, 5)
    expect(pixel(result, 12, 0)).toEqual(pixel(beneath, 12, 0))
  })

  it('leaves the stack intact when a layer covers nothing', () => {
    const beneath = gradient(8, 8)
    const result = withFakeCanvas(new ImageData(8, 8), () =>
      renderRecipe({
        recipe: recipe([imageLayer('photo')], 8),
        assets: { photo: { width: 8, height: 8 } as ImageBitmap },
        resume: { index: 0, buffer: beneath },
      }),
    )
    expect(Array.from(result.data)).toEqual(Array.from(beneath.data))
  })

  it('skips an image layer whose asset is missing', () => {
    const beneath = gradient(8, 8)
    const result = renderRecipe({
      recipe: recipe([imageLayer('gone')], 8),
      resume: { index: 0, buffer: beneath },
    })
    expect(Array.from(result.data)).toEqual(Array.from(beneath.data))
  })

  it('blends one generator over another', () => {
    const lower = recipe([generatorLayer('a')], 32)
    const both = recipe(
      [generatorLayer('a'), generatorLayer('b', { opacity: 0.5 })],
      32,
    )

    const alone = renderRecipe({ recipe: lower })
    const blended = renderRecipe({ recipe: both })
    expect(Array.from(blended.data)).not.toEqual(Array.from(alone.data))
  })

  it('skips a disabled source layer', () => {
    const withSource = recipe([generatorLayer('a')], 32)
    const disabled = recipe([generatorLayer('a', { enabled: false })], 32)

    const on = renderRecipe({ recipe: withSource })
    const off = renderRecipe({ recipe: disabled })
    const ground = renderRecipe({ recipe: recipe([], 32) })

    expect(Array.from(off.data)).toEqual(Array.from(ground.data))
    expect(Array.from(on.data)).not.toEqual(Array.from(ground.data))
  })

  it('starts from an opaque ground so nothing renders transparent', () => {
    const result = renderRecipe({ recipe: recipe([], 8) })
    for (let i = 3; i < result.data.length; i += 4) {
      expect(result.data[i]).toBe(1)
    }
  })
})

describe('effect layers as adjustment layers', () => {
  it('treats everything beneath it, not just the layer below', () => {
    // Same two sources, same effect — only its position in the stack moves.
    const treated = recipe(
      [
        generatorLayer('a'),
        layer('posterize', { levels: 2, mode: 'rgb' }),
        generatorLayer('b', { opacity: 0.5 }),
      ],
      32,
    )
    const untreated = recipe(
      [
        generatorLayer('a'),
        generatorLayer('b', { opacity: 0.5 }),
        layer('posterize', { levels: 2, mode: 'rgb' }),
      ],
      32,
    )

    expect(
      Array.from(renderRecipe({ recipe: treated }).data),
    ).not.toEqual(Array.from(renderRecipe({ recipe: untreated }).data))
  })

  it('does not crash at the bottom of the stack', () => {
    // An effect with nothing beneath it processes the bare ground. Reachable
    // by dragging, so it must be boring rather than fatal.
    expect(() =>
      renderRecipe({
        recipe: recipe([layer('dither'), generatorLayer('a')], 16),
      }),
    ).not.toThrow()
  })
})

describe('checkpoints', () => {
  it('resuming mid-stack matches a render from the ground up', () => {
    const layers = [
      generatorLayer('a'),
      layer('posterize', { levels: 3 }),
      layer('dither', { mode: 'mono' }),
    ]
    const full = renderRecipe({ recipe: recipe(layers, 32) })

    // Capture before the top layer, then resume from it.
    const first = renderStack({ recipe: recipe(layers, 32), captureAt: 2 })
    expect(first.captured?.index).toBe(2)

    const resumed = renderStack({
      recipe: recipe(layers, 32),
      resume: first.captured,
    })
    expect(Array.from(resumed.buffer.data)).toEqual(Array.from(full.data))
  })

  it('ignores a checkpoint captured at another size', () => {
    const layers = [generatorLayer('a'), layer('posterize', { levels: 3 })]
    const small = renderStack({ recipe: recipe(layers, 16), captureAt: 1 })
    const result = renderStack({
      recipe: recipe(layers, 32),
      resume: small.captured,
    })
    expect([result.buffer.width, result.buffer.height]).toEqual([32, 32])
  })
})
