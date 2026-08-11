import { describe, expect, it } from 'vitest'
import {
  bool,
  defaultParams,
  list,
  num,
  roundParam,
  sanitizeParams,
  str,
} from './params'
import type { ParamSpec } from './params'

const SPECS: Array<ParamSpec> = [
  {
    kind: 'slider',
    key: 'amount',
    label: 'Amount',
    min: 0,
    max: 10,
    step: 1,
    default: 4,
  },
  { kind: 'toggle', key: 'invert', label: 'Invert', default: false },
  {
    kind: 'select',
    key: 'mode',
    label: 'Mode',
    default: 'a',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ],
  },
  { kind: 'palette', key: 'palette', label: 'Palette', default: ['#000000'] },
  { kind: 'seed', key: 'seed', label: 'Seed', default: 'xyz' },
]

describe('roundParam', () => {
  it('rounds to two places', () => {
    expect(roundParam(0.12345)).toBe(0.12)
    expect(roundParam(1.789)).toBe(1.79)
    expect(roundParam(-0.256)).toBe(-0.26)
  })

  it('never produces negative zero', () => {
    // -0 survives in memory but JSON.stringify writes "0", so a recipe holding
    // -0 decodes as +0 and stops round-tripping. Regression: remix generated
    // contrast in [-0.2, 0.5] and hit -0 roughly one run in four.
    for (const input of [-0, -0.001, -0.0049, -0.000001]) {
      expect(Object.is(roundParam(input), -0)).toBe(false)
      expect(roundParam(input)).toBe(0)
    }
  })

  it('round-trips through JSON', () => {
    for (let i = 0; i < 1000; i++) {
      const value = roundParam(Math.random() * 0.7 - 0.2)
      expect(JSON.parse(JSON.stringify(value))).toBe(value)
      expect(Object.is(JSON.parse(JSON.stringify(value)), value)).toBe(true)
    }
  })

  it('honours a custom precision', () => {
    expect(roundParam(0.123456, 4)).toBe(0.1235)
    expect(roundParam(1.5, 0)).toBe(2)
  })
})

describe('defaultParams', () => {
  it('materializes every declared default', () => {
    expect(defaultParams(SPECS)).toEqual({
      amount: 4,
      invert: false,
      mode: 'a',
      palette: ['#000000'],
      seed: 'xyz',
    })
  })

  it('copies array defaults so callers cannot mutate the spec', () => {
    const first = defaultParams(SPECS).palette as Array<string>
    first.push('#ffffff')
    expect(defaultParams(SPECS).palette).toEqual(['#000000'])
  })
})

describe('readers', () => {
  const params = { n: 5, s: 'hi', b: true, l: ['#fff'] }

  it('return the value when the type matches', () => {
    expect(num(params, 'n', 0)).toBe(5)
    expect(str(params, 's', '')).toBe('hi')
    expect(bool(params, 'b', false)).toBe(true)
    expect(list(params, 'l', [])).toEqual(['#fff'])
  })

  it('fall back on the wrong type or a missing key', () => {
    expect(num(params, 's', 99)).toBe(99)
    expect(num(params, 'missing', 99)).toBe(99)
    expect(str(params, 'n', 'fallback')).toBe('fallback')
    expect(bool(params, 'n', true)).toBe(true)
    expect(list(params, 'n', ['d'])).toEqual(['d'])
  })

  it('rejects non-finite numbers', () => {
    expect(num({ n: Number.NaN }, 'n', 7)).toBe(7)
    expect(num({ n: Number.POSITIVE_INFINITY }, 'n', 7)).toBe(7)
  })

  it('treats an empty list as absent', () => {
    expect(list({ l: [] }, 'l', ['fallback'])).toEqual(['fallback'])
  })
})

describe('sanitizeParams', () => {
  it('clamps sliders into range', () => {
    expect(sanitizeParams(SPECS, { amount: 999 }).amount).toBe(10)
    expect(sanitizeParams(SPECS, { amount: -999 }).amount).toBe(0)
  })

  it('rejects select values outside the option list', () => {
    expect(sanitizeParams(SPECS, { mode: 'nope' }).mode).toBe('a')
    expect(sanitizeParams(SPECS, { mode: 'b' }).mode).toBe('b')
  })

  it('rejects palettes containing non-hex entries', () => {
    expect(sanitizeParams(SPECS, { palette: ['#fff', 'red'] }).palette).toEqual(
      ['#000000'],
    )
    expect(sanitizeParams(SPECS, { palette: ['#ff0000'] }).palette).toEqual([
      '#ff0000',
    ])
  })

  it('drops unknown keys entirely', () => {
    expect(sanitizeParams(SPECS, { evil: 'payload' })).not.toHaveProperty(
      'evil',
    )
  })

  it('survives junk input', () => {
    for (const input of [null, undefined, 42, 'string', []]) {
      expect(sanitizeParams(SPECS, input)).toEqual(defaultParams(SPECS))
    }
  })

  it('rejects an empty seed', () => {
    expect(sanitizeParams(SPECS, { seed: '' }).seed).toBe('xyz')
    expect(sanitizeParams(SPECS, { seed: 'abc' }).seed).toBe('abc')
  })
})
