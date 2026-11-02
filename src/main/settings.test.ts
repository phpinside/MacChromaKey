import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SETTINGS } from '../shared/types'
import { SettingsStore } from './settings'
let directory: string
async function open(): Promise<SettingsStore> {
  directory = await mkdtemp(join(tmpdir(), 'macchromakey-settings-'))
  return SettingsStore.open(join(directory, 'settings.json'))
}
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})
it('persists settings and retains defaults until an atomic save completes', async () => {
  const store = await open()
  expect(store.get()).toEqual(DEFAULT_SETTINGS)
  const value = { concurrency: 3, outputDirectory: directory, tempDirectory: directory }
  await store.save(value)
  expect((await SettingsStore.open(join(directory, 'settings.json'))).get()).toEqual(value)
})
it('rejects invalid counts/missing directories without corrupting saved settings', async () => {
  const store = await open()
  await store.save(DEFAULT_SETTINGS)
  await expect(store.save({ ...DEFAULT_SETTINGS, concurrency: 0 })).rejects.toThrow('1–8')
  await expect(
    store.save({ ...DEFAULT_SETTINGS, tempDirectory: join(directory, 'missing') })
  ).rejects.toThrow('目录不存在')
  expect(JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8'))).toEqual(
    DEFAULT_SETTINGS
  )
  await writeFile(join(directory, 'settings.json'), '{broken')
  await expect(SettingsStore.open(join(directory, 'settings.json'))).rejects.toThrow(
    'settings.json'
  )
})
