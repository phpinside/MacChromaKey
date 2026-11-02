import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { DEFAULT_PARAMS } from '../../shared/types'
import {
  buildExportArgs,
  buildFilter,
  buildPreviewArgs,
  exportDimensions,
  normalizeCrop
} from './buildFilter'

const source = { width: 1920, height: 1080, duration: 10, fps: 30 }
const verified =
  "chromakey=0x00FF00:0.3:0.05,format=yuva420p,lutyuv=a='clip((val-100)*255/(200-100),0,255)',despill=type=green,format=yuva444p10le"

describe('buildFilter', () => {
  it('matches the verified pipeline without crop', () => {
    expect(buildFilter(DEFAULT_PARAMS)).toBe(verified)
  })

  it('normalizes all crop values to even pixels and puts crop first', () => {
    const crop = { x: 11, y: 21, w: 1001, h: 701 }
    expect(buildFilter({ ...DEFAULT_PARAMS, crop }, source)).toBe(`crop=1000:700:10:20,${verified}`)
    expect(crop).toEqual({ x: 11, y: 21, w: 1001, h: 701 })
  })

  it('accepts a crop ending exactly at the video edge', () => {
    expect(normalizeCrop({ x: 20, y: 20, w: 1900, h: 1060 }, source)).toEqual({
      x: 20,
      y: 20,
      w: 1900,
      h: 1060
    })
  })

  it.each([
    { x: 1920, y: 0, w: 2, h: 2 },
    { x: 0, y: 1080, w: 2, h: 2 },
    { x: -1, y: 0, w: 2, h: 2 },
    { x: 0, y: 0, w: 1, h: 2 },
    { x: NaN, y: 0, w: 2, h: 2 }
  ])('rejects invalid/out-of-bounds crop %j', (crop) => {
    expect(() => buildFilter({ ...DEFAULT_PARAMS, crop }, source)).toThrow()
  })

  it('requires source dimensions when crop is enabled', () => {
    expect(() => buildFilter({ ...DEFAULT_PARAMS, crop: { x: 0, y: 0, w: 10, h: 10 } })).toThrow(
      '源视频尺寸'
    )
  })

  it('omits despill only when disabled', () => {
    expect(buildFilter({ ...DEFAULT_PARAMS, despill: false })).toBe(
      verified.replace(',despill=type=green', '')
    )
    expect(buildFilter({ ...DEFAULT_PARAMS, despillType: 'blue' })).toContain('despill=type=blue')
  })

  it.each([
    [100, 100],
    [200, 100],
    [255, 0]
  ])('rejects alphaLow=%s >= alphaHigh=%s', (alphaLow, alphaHigh) => {
    expect(() => buildFilter({ ...DEFAULT_PARAMS, alphaLow, alphaHigh })).toThrow(
      'alphaHigh 必须大于 alphaLow'
    )
  })

  it('rejects filter injection and invalid numeric inputs', () => {
    expect(() => buildFilter({ ...DEFAULT_PARAMS, keyColor: '0x00FF00,scale=1:1' })).toThrow()
    expect(() => buildFilter({ ...DEFAULT_PARAMS, similarity: Infinity })).toThrow()
    expect(() => buildFilter({ ...DEFAULT_PARAMS, blend: -1 })).toThrow()
  })
})

describe('compact exports', () => {
  const params = { ...DEFAULT_PARAMS, exportMaxEdge: 720, exportFps: 24 } as const
  it('fits landscape and portrait into an even size without upscaling, after source-pixel crop', () => {
    expect(exportDimensions(source, params)).toEqual({ width: 720, height: 404 })
    expect(exportDimensions({ width: 720, height: 1280 }, params)).toEqual({
      width: 404,
      height: 720
    })
    expect(exportDimensions({ width: 320, height: 180 }, params)).toEqual({
      width: 320,
      height: 180
    })
    const cropped = { ...params, crop: { x: 11, y: 21, w: 1001, h: 701 } }
    expect(buildFilter(cropped, source)).toBe(
      `crop=1000:700:10:20,scale=720:504,setsar=1,${verified}`
    )
  })

  it('applies the same size cap to preview and export, keeps alpha and only caps export fps', () => {
    const filter = buildFilter(params, source)
    expect(filter).toBe(`scale=720:404,setsar=1,${verified}`)
    const preview = buildPreviewArgs('in.mp4', 1, params, source)
    expect(preview[preview.indexOf('-vf') + 1]).toBe(
      filter.replace('format=yuva444p10le', 'format=rgba')
    )
    expect(preview[preview.indexOf('-vf') + 1]).not.toContain('fps=')
    const exported = buildExportArgs('in.mp4', 'out.mov', params, source)
    expect(exported[exported.indexOf('-vf') + 1]).toBe(`fps=24,${filter}`)
    const slow = buildExportArgs('in.mp4', 'out.mov', params, { ...source, fps: 15 })
    expect(slow[slow.indexOf('-vf') + 1]).toBe(`fps=15,${filter}`)
    expect(exported[exported.indexOf('-fps_mode') + 1]).toBe('passthrough')
    expect(buildExportArgs('in.mp4', 'out.mov', DEFAULT_PARAMS)).not.toContain('-fps_mode')
    expect(() => buildFilter(params)).toThrow('源视频尺寸')
  })

  it.each([
    { exportMaxEdge: '720,scale=1:1' },
    { exportMaxEdge: null },
    { exportFps: -1 },
    { exportFps: 120 }
  ])('rejects invalid compression controls: %j', (patch) => {
    expect(() => buildFilter({ ...params, ...patch } as never, source)).toThrow()
  })
})

describe('argument builders', () => {
  it('uses absolute input trim times and PCM audio in the intermediate', () => {
    const args = buildExportArgs(
      'a video.mp4',
      'temp.mov',
      { ...DEFAULT_PARAMS, trim: { start: 2, end: 4 }, keepAudio: true },
      source
    )
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-i'))).toEqual([
      '-ss',
      '2',
      '-to',
      '4',
      '-protocol_whitelist',
      'file,pipe',
      '-noautorotate'
    ])
    expect(args[args.indexOf('-c:a') + 1]).toBe('pcm_s16le')
    expect(args[args.indexOf('-i') + 1]).toBe(resolve('a video.mp4'))
    expect(args[args.indexOf('-vf') + 1]).toBe(verified)
    expect(args.at(-1)).toBe(resolve('temp.mov'))
    expect(args).not.toContain('-an')
  })

  it('disables audio by default and rejects invalid trim bounds', () => {
    expect(buildExportArgs('in.mp4', 'temp.mov', DEFAULT_PARAMS)).toContain('-an')
    expect(() =>
      buildExportArgs(
        'in.mp4',
        'temp.mov',
        { ...DEFAULT_PARAMS, trim: { start: 9, end: 11 } },
        source
      )
    ).toThrow('trim')
  })

  it('shares the filter chain and emits a single transparent PNG to stdout', () => {
    const args = buildPreviewArgs('in.mp4', 2.5, DEFAULT_PARAMS, source)
    expect(args[args.indexOf('-vf') + 1]).toBe(
      `scale=960:540,setsar=1,${verified.replace('format=yuva444p10le', 'format=rgba')}`
    )
    expect(args[args.indexOf('-frames:v') + 1]).toBe('1')
    expect(args[args.indexOf('-pix_fmt') + 1]).toBe('rgba')
    expect(args.slice(-3)).toEqual(['-f', 'image2pipe', 'pipe:1'])
    expect(() => buildPreviewArgs('in.mp4', 10, DEFAULT_PARAMS, source)).toThrow()
  })
})

it('scales after normalized crop only for preview, and extracts alpha before rgba', () => {
  const params = { ...DEFAULT_PARAMS, crop: { x: 11, y: 21, w: 1001, h: 701 } }
  const args = buildPreviewArgs('in.mp4', 1, params, source, 'alpha')
  const filter = args[args.indexOf('-vf') + 1]
  expect(filter).toContain('crop=1000:700:10:20,scale=960:672,setsar=1,chromakey=')
  expect(filter).toMatch(/despill=type=green,alphaextract,format=rgba$/)
  expect(buildFilter(params, source)).not.toContain('scale=')
  expect(
    buildPreviewArgs('in.mp4', 0, DEFAULT_PARAMS, { width: 320, height: 180 }).join(',')
  ).toContain('scale=320:180')
})
