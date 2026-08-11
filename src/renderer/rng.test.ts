import { describe, expect, it } from 'vitest'
import { createRng, randomSeed } from './rng'

describe('createRng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng('8f31c2')
    const b = createRng('8f31c2')
    const left = Array.from({ length: 32 }, () => a.next())
    const right = Array.from({ length: 32 }, () => b.next())
    expect(left).toEqual(right)
  })

  it('produces different streams for different seeds', () => {
    const a = Array.from({ length: 16 }, createRng('seed-a').next)
    const b = Array.from({ length: 16 }, createRng('seed-b').next)
    expect(a).not.toEqual(b)
  })

  it('stays inside [0, 1)', () => {
    const rng = createRng('bounds')
    for (let i = 0; i < 5000; i++) {
      const value = rng.next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('respects range and int bounds', () => {
    const rng = createRng('ranges')
    for (let i = 0; i < 1000; i++) {
      const r = rng.range(-3, 7)
      expect(r).toBeGreaterThanOrEqual(-3)
      expect(r).toBeLessThan(7)

      const n = rng.int(2, 5)
      expect(Number.isInteger(n)).toBe(true)
      expect(n).toBeGreaterThanOrEqual(2)
      expect(n).toBeLessThanOrEqual(5)
    }
  })

  it('picks only from the given items', () => {
    const rng = createRng('pick')
    const items = ['a', 'b', 'c'] as const
    for (let i = 0; i < 200; i++) {
      expect(items).toContain(rng.pick(items))
    }
  })

  it('honours bool probability at the extremes', () => {
    const rng = createRng('bool')
    for (let i = 0; i < 100; i++) {
      expect(rng.bool(1)).toBe(true)
      expect(rng.bool(0)).toBe(false)
    }
  })
})

describe('randomSeed', () => {
  it('is six lowercase hex characters', () => {
    for (let i = 0; i < 200; i++) {
      expect(randomSeed()).toMatch(/^[0-9a-f]{6}$/)
    }
  })
})
