import { describe, expect, it } from 'vitest'
import { sanitizeParams } from '../../params'
import { FONTS } from '../../fonts'
import { TEXT_DEFAULTS, TEXT_PARAMS } from './params'
import { randomizeText } from './random'

const PALETTE = ['#050505', '#f5f5f5', '#0057ff']
const CANVAS = { width: 1080, height: 1350 }

const rolls = (count: number, palette = PALETTE, canvas = CANVAS) =>
  Array.from({ length: count }, (_, i) =>
    randomizeText(`seed-${i}`, palette, canvas, TEXT_DEFAULTS()),
  )

describe('randomizeText', () => {
  it('always produces params that survive sanitization', () => {
    for (const params of rolls(300)) {
      expect(sanitizeParams(TEXT_PARAMS, params)).toEqual(params)
    }
  })

  it('is deterministic for a seed', () => {
    expect(randomizeText('abc', PALETTE, CANVAS, TEXT_DEFAULTS())).toEqual(
      randomizeText('abc', PALETTE, CANVAS, TEXT_DEFAULTS()),
    )
  })

  /** The words are the user's; only the way they are set is up for grabs. */
  it('keeps the text it was given', () => {
    const current = { ...TEXT_DEFAULTS(), text: 'HELLO\nTHERE' }
    for (let i = 0; i < 50; i++) {
      const params = randomizeText(`seed-${i}`, PALETTE, CANVAS, current)
      expect(params.text).toBe('HELLO\nTHERE')
    }
  })

  it('sets the words in the palette it was handed', () => {
    const params = randomizeText('abc', ['#000000', '#ffffff'], CANVAS, {
      ...TEXT_DEFAULTS(),
    })
    expect(params.palette).toEqual(['#000000', '#ffffff'])
  })

  /**
   * Wrapping in `swatchAt` means any index renders, so an out-of-range one is
   * invisible until the inspector shows a colour that is not the one drawn.
   */
  it('picks colours that exist in the palette', () => {
    for (const params of rolls(200, ['#000000', '#ffffff'])) {
      for (const key of ['ink', 'paper', 'strokeInk', 'depthInk']) {
        expect(params[key]).toBeGreaterThanOrEqual(0)
        expect(params[key]).toBeLessThan(2)
      }
      // A stroke or a shadow in the face's own colour is one nobody can see.
      expect(params.strokeInk).not.toBe(params.ink)
      expect(params.paper).not.toBe(params.ink)
    }
  })

  /**
   * The opening frame has to be worth looking at, and type pushed off the edge
   * is the failure a random layout reaches for first.
   */
  it('keeps the text box on the canvas', () => {
    for (const canvas of [CANVAS, { width: 1920, height: 1080 }]) {
      for (const params of rolls(200, PALETTE, canvas)) {
        const quarter = Math.abs(Number(params.rotate)) === 90
        const footprintX = Number(quarter ? params.height : params.width)
        const footprintY = Number(quarter ? params.width : params.height)

        expect(Math.abs(Number(params.x)) + footprintX / 2).toBeLessThanOrEqual(
          canvas.width / 2,
        )
        expect(Math.abs(Number(params.y)) + footprintY / 2).toBeLessThanOrEqual(
          canvas.height / 2,
        )
      }
    }
  })

  /**
   * The type size is solved from the box rather than picked, so the block fills
   * the box instead of overflowing the raster canvas around it.
   */
  it('sets the type to fit the box it chose', () => {
    for (const params of rolls(200)) {
      const lines = 2 // TEXT_DEFAULTS is 'FRAME\nFIELD'
      const blockHeight =
        Number(params.size) * (Number(params.leading) * (lines - 1) + 1)
      expect(blockHeight).toBeLessThanOrEqual(Number(params.height))
    }
  })

  it('names a face this build actually carries', () => {
    for (const params of rolls(100)) {
      expect(FONTS.some((font) => font.id === params.font)).toBe(true)
    }
  })

  /** Diversity is the whole point: a run of rolls must not read as one poster. */
  it('varies the setting from roll to roll', () => {
    const params = rolls(60)
    for (const key of ['font', 'fit', 'size', 'fill', 'depth', 'warp']) {
      expect(new Set(params.map((entry) => entry[key])).size).toBeGreaterThan(1)
    }
  })
})
