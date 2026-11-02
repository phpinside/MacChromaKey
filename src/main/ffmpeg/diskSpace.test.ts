import { expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../../shared/types'
import { DiskSpaceBudget, estimateExportBytes } from './diskSpace'
const source = { width: 1920, height: 1080, fps: 30, duration: 60, hasAudio: true }
it('estimates ProRes from duration, crop, fps and audio, with headroom', () => {
  const full = estimateExportBytes(source, DEFAULT_PARAMS)
  expect(full.intermediate).toBe(((60 * 500_000_000) / 8) * 1.3)
  const half = estimateExportBytes(source, { ...DEFAULT_PARAMS, trim: { start: 0, end: 30 } })
  expect(half.intermediate).toBe(full.intermediate / 2)
  expect(
    estimateExportBytes(source, { ...DEFAULT_PARAMS, keepAudio: true }).intermediate
  ).toBeGreaterThan(full.intermediate)
  expect(
    estimateExportBytes(source, { ...DEFAULT_PARAMS, crop: { x: 0, y: 0, w: 960, h: 540 } })
      .intermediate
  ).toBe(full.intermediate / 4)
})
it('reserves a shared volume for concurrent jobs, releases idempotently and reports required/free bytes', async () => {
  const budget = new DiskSpaceBudget(async () => ({ id: 'disk', available: 7 * 1024 ** 3 }))
  const release = await budget.reserve('/temp', '/output', source, DEFAULT_PARAMS)
  await expect(budget.reserve('/temp', '/output', source, DEFAULT_PARAMS)).rejects.toThrow(
    '磁盘空间不足'
  )
  release()
  release()
  const next = await budget.reserve('/temp', '/output', source, DEFAULT_PARAMS)
  next()
})
it('budgets reduced size and capped fps, without increasing a low-fps source estimate', () => {
  const reduced = { ...DEFAULT_PARAMS, exportMaxEdge: 960, exportFps: 15 } as const
  expect(estimateExportBytes(source, reduced).intermediate).toBe(
    estimateExportBytes(source, DEFAULT_PARAMS).intermediate / 8
  )
  const slow = { ...source, fps: 10 }
  expect(estimateExportBytes(slow, { ...DEFAULT_PARAMS, exportFps: 24 })).toEqual(
    estimateExportBytes(slow, DEFAULT_PARAMS)
  )
})
it('checks output disk separately and does not leak a partial reservation when it fails', async () => {
  let outputFree = 1
  const budget = new DiskSpaceBudget(async (path) => ({
    id: path,
    available: path === '/output' ? outputFree : 7 * 1024 ** 3
  }))
  await expect(budget.reserve('/temp', '/output', source, DEFAULT_PARAMS)).rejects.toThrow(
    '/output'
  )
  outputFree = 2 * 1024 ** 3
  const release = await budget.reserve('/temp', '/output', source, DEFAULT_PARAMS)
  release()
})
