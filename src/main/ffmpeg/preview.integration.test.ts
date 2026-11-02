import { afterAll, beforeAll, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PARAMS } from '../../shared/types'
import { resolveToolPath } from './detectTools'
import { renderPreview } from './preview'
import { runProcess } from './run'

let directory: string, input: string, ffmpeg: string
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'macchromakey-preview-'))
  input = join(directory, 'green.mp4')
  ffmpeg = await resolveToolPath('ffmpeg')
  await runProcess(ffmpeg, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=0x00ff00:s=1920x1080:r=24:d=1,drawbox=x=500:y=200:w=400:h=400:color=red:t=fill',
    '-c:v',
    'libx264',
    input
  ])
}, 30_000)
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

it('renders actual transparent PNG and alphaextract mask at <=960px, respecting crop', async () => {
  for (const mode of ['keyed', 'alpha'] as const) {
    const dataUrl = await renderPreview(
      input,
      {
        id: mode,
        url: 'authorized-in-IPC',
        time: 0.5,
        mode,
        params: { ...DEFAULT_PARAMS, crop: { x: 200, y: 100, w: 1200, h: 800 } }
      },
      new AbortController().signal
    )
    const png = Buffer.from(dataUrl.split(',')[1], 'base64')
    expect(png.readUInt32BE(16)).toBe(960)
    expect(png.readUInt32BE(20)).toBe(640)
    const path = join(directory, mode + '.png')
    await writeFile(path, png)
    const { stdout } = await runProcess(ffmpeg, [
      '-v',
      'error',
      '-i',
      path,
      '-pix_fmt',
      'rgba',
      '-f',
      'rawvideo',
      'pipe:1'
    ])
    const pixel = (x: number, y: number): number[] =>
      Array.from(stdout.subarray((y * 960 + x) * 4, (y * 960 + x) * 4 + 4))
    if (mode === 'keyed') {
      expect(pixel(30, 30)[3]).toBe(0)
      expect(pixel(320, 160)[3]).toBe(255)
    } else {
      expect(pixel(30, 30)).toEqual([0, 0, 0, 255])
      expect(pixel(320, 160)).toEqual([255, 255, 255, 255])
    }
  }
}, 30_000)
