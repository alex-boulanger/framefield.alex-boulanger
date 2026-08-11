import { describe, expect, it } from 'vitest'
import { applyPixelate, PIXELATE_PARAMS } from './pixelate'
import { defaultParams } from '../params'
import {
  env,
  gradient,
  hasUniformCells,
  meanLuminance,
  pixel,
  solid,
} from '#/test/helpers'

const base = () => defaultParams(PIXELATE_PARAMS)

describe('applyPixelate', () => {
  it.each([2, 4, 8, 16])('paints uniform %ipx cells', (size) => {
    const buffer = gradient(64, 64)
    applyPixelate(buffer, { ...base(), size }, env(buffer))
    expect(hasUniformCells(buffer, size)).toBe(true)
  })

  it('scales the cell with the render scale', () => {
    // 16px authored in export space becomes 8px at half scale, which is the
    // same fraction of a half-size image.
    const buffer = gradient(64, 64)
    applyPixelate(buffer, { ...base(), size: 16 }, env(buffer, 0.5))
    expect(hasUniformCells(buffer, 8)).toBe(true)
    expect(hasUniformCells(buffer, 16)).toBe(false)
  })

  it('never collapses a cell below one pixel', () => {
    const buffer = gradient(16, 16)
    expect(() =>
      applyPixelate(buffer, { ...base(), size: 2 }, env(buffer, 0.01)),
    ).not.toThrow()
  })

  it('preserves mean brightness when averaging', () => {
    const buffer = gradient(64, 64)
    const before = meanLuminance(buffer)
    applyPixelate(buffer, { ...base(), size: 8 }, env(buffer))
    expect(meanLuminance(buffer)).toBeCloseTo(before, 3)
  })

  it('averages rather than point-sampling by default', () => {
    const buffer = gradient(64, 1)
    applyPixelate(
      buffer,
      { ...base(), size: 8, sampling: 'average' },
      env(buffer),
    )
    // The first cell holds the mean of columns 0..7, not the value of any one.
    const source = gradient(64, 1)
    let expected = 0
    for (let x = 0; x < 8; x++) expected += pixel(source, x, 0)[0]
    expect(pixel(buffer, 0, 0)[0]).toBeCloseTo(expected / 8, 5)
  })

  it('point sampling takes the cell centre', () => {
    const source = gradient(64, 1)
    const buffer = gradient(64, 1)
    applyPixelate(
      buffer,
      { ...base(), size: 8, sampling: 'nearest' },
      env(buffer),
    )
    expect(pixel(buffer, 0, 0)[0]).toBeCloseTo(pixel(source, 4, 0)[0], 5)
  })

  it('stretches cells with aspect', () => {
    const buffer = gradient(64, 64)
    applyPixelate(buffer, { ...base(), size: 8, aspect: 2 }, env(buffer))
    // 8 wide, 16 tall: uniform on the 8px grid horizontally but the top two
    // 8px rows must match, which a square grid would not guarantee.
    for (let x = 0; x < 64; x++) {
      expect(pixel(buffer, x, 0)[0]).toBeCloseTo(pixel(buffer, x, 15)[0], 6)
    }
  })

  it('leaves a uniform field uniform', () => {
    const buffer = solid(32, 32, 0.3, 0.4, 0.5)
    applyPixelate(buffer, base(), env(buffer))
    for (let i = 0; i < buffer.data.length; i += 4) {
      expect(buffer.data[i]).toBeCloseTo(0.3, 5)
    }
  })

  it('is idempotent at the same cell size', () => {
    const once = gradient(64, 64)
    const twice = gradient(64, 64)
    applyPixelate(once, { ...base(), size: 8 }, env(once))
    applyPixelate(twice, { ...base(), size: 8 }, env(twice))
    applyPixelate(twice, { ...base(), size: 8 }, env(twice))
    expect(Array.from(twice.data)).toEqual(Array.from(once.data))
  })
})
