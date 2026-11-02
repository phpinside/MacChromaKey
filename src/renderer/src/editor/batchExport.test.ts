import { expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../../../shared/types'
import { batchParams } from './batchExport'
const source = { width: 1920, height: 1080, duration: 10, fps: 24, hasAudio: false }
it('scales crop in each source dimension to even pixels without changing keying parameters', () => {
  const result = batchParams(
    { ...DEFAULT_PARAMS, crop: { x: 200, y: 100, w: 1000, h: 800 } },
    source,
    { ...source, width: 960, height: 540 },
    'scale'
  )
  expect(result.crop).toEqual({ x: 100, y: 50, w: 500, h: 400 })
  expect(result.similarity).toBe(DEFAULT_PARAMS.similarity)
})
it('ignores crop on request, clips trim end to shorter sources and rejects no overlap', () => {
  const params = {
    ...DEFAULT_PARAMS,
    crop: { x: 0, y: 0, w: 100, h: 100 },
    trim: { start: 1, end: 8 }
  }
  expect(batchParams(params, source, { ...source, duration: 3 }, 'ignore')).toMatchObject({
    crop: null,
    trim: { start: 1, end: 3 }
  })
  expect(() => batchParams(params, source, { ...source, duration: 1 }, 'scale')).toThrow('时长')
})
