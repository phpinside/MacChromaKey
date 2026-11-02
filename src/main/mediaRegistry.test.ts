import { expect, it } from 'vitest'
import { mkdtemp, rm, writeFile, rename, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MediaRegistry } from './mediaRegistry'
import { serveLocalFile } from './localFileResponse'
it('reuses unchanged tokens, rejects unselected or modified sources, and checks open-file identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'macchromakey-registry-'))
  try {
    const path = join(root, 'clip.mp4')
    await writeFile(path, 'first')
    const registry = new MediaRegistry(),
      media = await registry.authorize(path)
    expect((await registry.authorize(path)).url).toBe(media.url)
    expect(registry.get(media.url + '#fragment')).toBeUndefined()
    await expect(registry.assertPath(join(root, 'other.mp4'))).rejects.toThrow('未经授权')
    const entry = registry.get(media.url)!
    await rename(path, join(root, 'old.mp4'))
    await writeFile(path, 'replacement')
    await expect(registry.assertPath(media.path)).rejects.toThrow('重新导入')
    expect((await serveLocalFile(new Request(media.url), path, entry.identity)).status).toBe(409)
    const fresh = await registry.authorize(path)
    expect(fresh.url).not.toBe(media.url)
    expect(registry.get(media.url)).toBeUndefined()
    expect(registry.get(fresh.url)?.identity.size).toBe((await stat(path)).size)
    registry.clear()
    expect(registry.get(fresh.url)).toBeUndefined()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
