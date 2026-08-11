import { describe, expect, it } from 'vitest'
import { applyChannelDrift, CHANNEL_DRIFT_PARAMS } from './channelDrift'
import { defaultParams } from '../params'
import { createBuffer } from '../buffer'
import type { PixelBuffer } from '../buffer'
import { env, pixel, solid } from '#/test/helpers'

const base = () => ({
  ...defaultParams(CHANNEL_DRIFT_PARAMS),
  redX: 0,
  redY: 0,
  blueX: 0,
  blueY: 0,
  jitter: 0,
  scanlines: 0,
})

/** Vertical step in every channel: 0 left of `edge`, 1 from `edge` on. */
function step(width: number, height: number, edge: number): PixelBuffer {
  const buffer = createBuffer(width, height)
  const d = buffer.data
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const value = x >= edge ? 1 : 0
      d[i] = value
      d[i + 1] = value
      d[i + 2] = value
      d[i + 3] = 1
    }
  }
  return buffer
}

describe('applyChannelDrift', () => {
  it('is the identity with no offsets, jitter, or scanlines', () => {
    const buffer = step(32, 4, 16)
    const before = Array.from(buffer.data)
    applyChannelDrift(buffer, base(), env(buffer))
    expect(Array.from(buffer.data)).toEqual(before)
  })

  it('shifts the red channel by exactly the requested offset', () => {
    const buffer = step(32, 4, 16)
    applyChannelDrift(buffer, { ...base(), redX: 6 }, env(buffer))

    // Sampling from x+6 pulls the edge 6px left in red; green stays put.
    expect(pixel(buffer, 10, 0)[0]).toBe(1)
    expect(pixel(buffer, 9, 0)[0]).toBe(0)
    expect(pixel(buffer, 10, 0)[1]).toBe(0)
    expect(pixel(buffer, 16, 0)[1]).toBe(1)
  })

  /**
   * Regression: `scaled()` floors to `min`, which silently turned every
   * negative offset into zero — the default `blueX: -12` did nothing at all.
   * Signed values use `scaledOffset` now.
   */
  it('shifts red and blue in opposite directions', () => {
    const buffer = step(32, 4, 16)
    applyChannelDrift(buffer, { ...base(), redX: 6, blueX: -6 }, env(buffer))
    expect(pixel(buffer, 10, 0)[0]).toBe(1)
    expect(pixel(buffer, 21, 0)[2]).toBe(0)
    expect(pixel(buffer, 22, 0)[2]).toBe(1)
  })

  it('applies negative offsets at all', () => {
    const shifted = step(32, 4, 16)
    const identity = step(32, 4, 16)
    applyChannelDrift(shifted, { ...base(), blueX: -8 }, env(shifted))
    applyChannelDrift(identity, base(), env(identity))
    expect(Array.from(shifted.data)).not.toEqual(Array.from(identity.data))
  })

  it('scales the offset with the render scale', () => {
    // 10px authored in export space is a 5px shift at half scale.
    const buffer = step(32, 4, 16)
    applyChannelDrift(buffer, { ...base(), redX: 10 }, env(buffer, 0.5))
    expect(pixel(buffer, 11, 0)[0]).toBe(1)
    expect(pixel(buffer, 10, 0)[0]).toBe(0)
  })

  it('clamps at the edges instead of wrapping', () => {
    const buffer = step(16, 2, 8)
    applyChannelDrift(buffer, { ...base(), redX: 12 }, env(buffer))
    expect(pixel(buffer, 15, 0)[0]).toBe(1)
  })

  it('darkens alternating bands with scanlines', () => {
    const buffer = solid(8, 8, 0.8, 0.8, 0.8)
    applyChannelDrift(
      buffer,
      { ...base(), scanlines: 0.5, scanlineSize: 1 },
      env(buffer),
    )
    expect(pixel(buffer, 0, 0)[0]).toBeCloseTo(0.4, 6)
    expect(pixel(buffer, 0, 1)[0]).toBeCloseTo(0.8, 6)
  })

  it('is deterministic for a given seed', () => {
    const params = { ...base(), jitter: 8, seed: 'fixed' }
    const a = step(32, 16, 16)
    const b = step(32, 16, 16)
    applyChannelDrift(a, params, env(a))
    applyChannelDrift(b, params, env(b))
    expect(Array.from(a.data)).toEqual(Array.from(b.data))
  })

  it('produces different tearing for different seeds', () => {
    const a = step(32, 16, 16)
    const b = step(32, 16, 16)
    applyChannelDrift(a, { ...base(), jitter: 8, seed: 'one' }, env(a))
    applyChannelDrift(b, { ...base(), jitter: 8, seed: 'two' }, env(b))
    expect(Array.from(a.data)).not.toEqual(Array.from(b.data))
  })
})
