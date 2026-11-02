import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PARAMS } from '../shared/types'
import { PresetStore } from './presets'
let directory: string
async function open(): Promise<{ store: PresetStore; path: string }> {
  directory = await mkdtemp(join(tmpdir(), 'macchromakey-presets-'))
  const path = join(directory, 'presets.json')
  return { store: new PresetStore(path), path }
}
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})
it('keeps builtin immutable, saves/loads/deletes JSON and never carries file-specific crop/trim', async () => {
  const { store, path } = await open()
  expect((await store.list())[0]).toMatchObject({ builtin: true, name: '默认绿幕' })
  const [, preset] = await store.save('蓝幕', {
    ...DEFAULT_PARAMS,
    despillType: 'blue',
    crop: { x: 0, y: 0, w: 50, h: 50 },
    trim: { start: 1, end: 2 }
  })
  expect(preset.params).toMatchObject({ crop: null, trim: null, despillType: 'blue' })
  expect(await new PresetStore(path).list()).toEqual(await store.list())
  await store.save('蓝幕', { ...DEFAULT_PARAMS, blend: 0.2 })
  expect((await store.list())[1].id).toBe(preset.id)
  expect(JSON.parse(await readFile(path, 'utf8'))).toHaveLength(1)
  await expect(store.delete('default-green')).rejects.toThrow('不能删除')
  expect(await store.delete(preset.id)).toHaveLength(1)
})
it('serializes concurrent writes, rejects bad params and preserves corrupt JSON for recovery', async () => {
  const { store, path } = await open()
  await Promise.all([store.save('A', DEFAULT_PARAMS), store.save('B', DEFAULT_PARAMS)])
  expect(await store.list()).toHaveLength(3)
  expect(() => store.save('bad', { ...DEFAULT_PARAMS, similarity: NaN })).toThrow()
  await writeFile(path, '{broken')
  await expect(store.save('C', DEFAULT_PARAMS)).rejects.toThrow('presets.json')
  expect(await readFile(path, 'utf8')).toBe('{broken')
})
