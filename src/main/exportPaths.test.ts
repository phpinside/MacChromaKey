import { expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { batchExportPaths, defaultExportPath } from './exportPaths'
it('uses the input directory and alpha suffix and avoids duplicate or existing batch outputs', async () => {
  expect(defaultExportPath('/video/test #1.mp4')).toBe('/video/test #1_alpha.mov')
  const directory = await mkdtemp(join(tmpdir(), 'macchromakey-paths-'))
  try {
    await writeFile(join(directory, 'clip_alpha.mov'), 'existing')
    expect(
      await batchExportPaths(['/a/clip.mov', '/b/clip.mp4', '/c/other.mp4'], directory)
    ).toEqual([
      join(directory, 'clip_alpha_2.mov'),
      join(directory, 'clip_alpha_3.mov'),
      join(directory, 'other_alpha.mov')
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
