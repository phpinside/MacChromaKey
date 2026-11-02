import { expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ThumbnailCache } from './thumbnail'
import { resolveToolPath } from './detectTools'
import { runProcess } from './run'
it('extracts a real JPEG frame, caches it, and tolerates missing input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'macchromakey-thumb-'))
  try {
    const ffmpeg = await resolveToolPath('ffmpeg')
    const input = join(directory, 'clip.mov')
    await runProcess(ffmpeg, [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=green:s=320x180:d=1',
      '-c:v',
      'libx264',
      input
    ])
    const cache = new ThumbnailCache()
    const jpeg = await cache.get(input)
    expect(jpeg).toMatch(/^data:image\/jpeg;base64,/)
    expect(await cache.get(input)).toBe(jpeg)
    expect(await cache.get(join(directory, 'missing.mov'))).toBeUndefined()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 15000)
