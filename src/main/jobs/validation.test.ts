import { expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../../shared/types'
import { parseKeyParams } from './validation'

it('migrates legacy parameters to original size/timing and persists compact export settings', () => {
  const { exportMaxEdge: _size, exportFps: _fps, ...legacy } = DEFAULT_PARAMS
  expect([_size, _fps]).toEqual([0, 0])
  expect(parseKeyParams(legacy)).toEqual(DEFAULT_PARAMS)
  expect(parseKeyParams({ ...DEFAULT_PARAMS, exportMaxEdge: 720, exportFps: 24 })).toMatchObject({
    exportMaxEdge: 720,
    exportFps: 24
  })
  expect(() => parseKeyParams({ ...legacy, exportFps: '24' })).toThrow('帧率')
  expect(() => parseKeyParams({ ...legacy, exportMaxEdge: 800 })).toThrow('尺寸')
})
