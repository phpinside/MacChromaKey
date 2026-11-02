import { describe, expect, it } from 'vitest'
import { dragCrop, fitAspect, fitVideo, formatTime, stepFrame, type Handle } from './geometry'

describe('source pixel geometry', () => {
  it('steps back correctly from microsecond-rounded seek times and clamps video endpoints', () => {
    expect(stepFrame(1, 1, 24, 4)).toBeCloseTo(25 / 24)
    expect(stepFrame(1.041666, -1, 24, 4)).toBe(1)
    expect(stepFrame(0, -1, 24, 4)).toBe(0)
    expect(stepFrame(4, 1, 24, 4)).toBeCloseTo(95 / 24)
  })
  it('accounts for top/bottom and left/right letterbox offsets', () => {
    expect(fitVideo({ width: 800, height: 600 }, { width: 1920, height: 1080 })).toEqual({
      x: 0,
      y: 75,
      w: 800,
      h: 450,
      scale: 800 / 1920
    })
    const portrait = fitVideo({ width: 800, height: 600 }, { width: 720, height: 1280 })
    expect(portrait).toEqual({ x: 231.25, y: 0, w: 337.5, h: 600, scale: 600 / 1280 })
  })
  it('preserves the stored source rectangle when display scale changes', () => {
    const crop = { x: 200, y: 100, w: 800, h: 600 }
    const large = fitVideo({ width: 960, height: 600 }, { width: 1920, height: 1080 })
    const small = fitVideo({ width: 480, height: 300 }, { width: 1920, height: 1080 })
    expect((crop.x * large.scale + large.x) / 2).toBe(crop.x * small.scale + small.x)
    expect(crop).toEqual({ x: 200, y: 100, w: 800, h: 600 })
  })
  it('clamps movement without changing crop dimensions', () => {
    expect(
      dragCrop(
        { x: 20, y: 20, w: 200, h: 100 },
        'move',
        1000,
        -1000,
        { width: 400, height: 300 },
        null
      )
    ).toEqual({ x: 200, y: 0, w: 200, h: 100 })
  })
  it.each(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as Handle[])(
    'keeps %s resizing in bounds without flipping',
    (handle) => {
      for (const delta of [-10000, 10000]) {
        const crop = dragCrop(
          { x: 100, y: 100, w: 320, h: 180 },
          handle,
          delta,
          delta,
          { width: 800, height: 600 },
          null
        )
        expect(crop.x).toBeGreaterThanOrEqual(0)
        expect(crop.y).toBeGreaterThanOrEqual(0)
        expect(crop.w).toBeGreaterThanOrEqual(2)
        expect(crop.h).toBeGreaterThanOrEqual(2)
        expect(crop.x + crop.w).toBeLessThanOrEqual(800)
        expect(crop.y + crop.h).toBeLessThanOrEqual(600)
      }
    }
  )
  it.each(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as Handle[])(
    'locks aspect for %s, within integer-pixel rounding',
    (handle) => {
      const crop = dragCrop(
        { x: 200, y: 100, w: 320, h: 180 },
        handle,
        30,
        -20,
        { width: 1000, height: 800 },
        16 / 9
      )
      expect(Math.abs(crop.w - (crop.h * 16) / 9)).toBeLessThanOrEqual(1)
    }
  )
  it('fits portrait/square/landscape ratios inside the source', () => {
    for (const ratio of [16 / 9, 1, 9 / 16]) {
      const crop = fitAspect({ x: 0, y: 0, w: 720, h: 1280 }, { width: 720, height: 1280 }, ratio)
      expect(crop.x).toBeGreaterThanOrEqual(0)
      expect(crop.y).toBeGreaterThanOrEqual(0)
      expect(crop.x + crop.w).toBeLessThanOrEqual(720)
      expect(crop.y + crop.h).toBeLessThanOrEqual(1280)
      expect(Math.abs(crop.w - crop.h * ratio)).toBeLessThanOrEqual(1)
    }
    expect(formatTime(59.999)).toBe('01:00.00')
  })
})
