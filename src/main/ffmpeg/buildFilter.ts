import { resolve } from 'node:path'
import type { KeyParams, PreviewMode, VideoInfo } from '../../shared/types'
import { exportDuration } from './run'

type VideoBounds = Pick<VideoInfo, 'width' | 'height'>
type SourceInfo = VideoBounds & Partial<Pick<VideoInfo, 'duration' | 'fps'>>

function inRange(value: number, low: number, high: number, name: string): void {
  if (!Number.isFinite(value) || value < low || value > high) {
    throw new Error(`${name} 必须在 ${low}–${high} 之间`)
  }
}

function exportSettings(params: KeyParams): { maxEdge: number; fps: number } {
  // Older persisted jobs/presets predate export size controls.
  const maxEdge = params.exportMaxEdge === undefined ? 0 : params.exportMaxEdge
  const fps = params.exportFps === undefined ? 0 : params.exportFps
  if (![0, 720, 960, 1280, 1920].includes(maxEdge)) throw new Error('导出尺寸无效')
  if (![0, 15, 24, 30, 60].includes(fps)) throw new Error('导出帧率无效')
  return { maxEdge, fps }
}

function scaledSize(width: number, height: number, maxEdge: number): VideoBounds {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  const even = (value: number): number => Math.max(2, Math.floor((value * scale) / 2) * 2)
  return { width: even(width), height: even(height) }
}

export function exportDimensions(source: VideoBounds, params: KeyParams): VideoBounds {
  const { maxEdge } = exportSettings(params)
  const crop = params.crop && normalizeCrop(params.crop, source)
  const width = crop ? crop.w : source.width
  const height = crop ? crop.h : source.height
  return maxEdge ? scaledSize(width, height, maxEdge) : { width, height }
}

export function normalizeCrop(
  crop: NonNullable<KeyParams['crop']>,
  source: VideoBounds
): NonNullable<KeyParams['crop']> {
  const { x, y, w, h } = crop
  if (![x, y, w, h].every(Number.isFinite) || x < 0 || y < 0 || w < 2 || h < 2) {
    throw new Error('裁剪区域无效')
  }
  if (
    !Number.isInteger(source.width) ||
    !Number.isInteger(source.height) ||
    source.width <= 0 ||
    source.height <= 0
  )
    throw new Error('源视频尺寸无效')
  const even = (value: number): number => Math.floor(value / 2) * 2
  const normalized = { x: even(x), y: even(y), w: even(w), h: even(h) }
  if (normalized.x + normalized.w > source.width || normalized.y + normalized.h > source.height) {
    throw new Error(`裁剪区域超出源视频边界（${source.width}×${source.height}）`)
  }
  return normalized
}

// Crop requires probed dimensions: never silently skip the source-boundary check.
export function buildFilter(
  params: KeyParams,
  source?: VideoBounds,
  preview?: Exclude<PreviewMode, 'original'>
): string {
  const { maxEdge } = exportSettings(params)
  if (!/^0x[0-9a-f]{6}$/i.test(params.keyColor)) throw new Error('键控颜色必须为 0xRRGGBB')
  inRange(params.similarity, 0.01, 1, 'similarity')
  inRange(params.blend, 0, 1, 'blend')
  inRange(params.alphaLow, 0, 255, 'alphaLow')
  inRange(params.alphaHigh, 0, 255, 'alphaHigh')
  if (params.alphaHigh <= params.alphaLow) throw new Error('alphaHigh 必须大于 alphaLow')

  const filters: string[] = []
  if (params.crop) {
    if (!source) throw new Error('设置 crop 时必须传入 probe 得到的源视频尺寸')
    const { x, y, w, h } = normalizeCrop(params.crop, source)
    filters.push(`crop=${w}:${h}:${x}:${y}`)
  }
  if (preview || maxEdge) {
    if (!source) throw new Error('缩放 / 预览需要源视频尺寸')
    const output = exportDimensions(source, params)
    const size = preview ? scaledSize(output.width, output.height, 960) : output
    // Even rounding changes DAR slightly. Square pixels keep avconvert from resizing again.
    filters.push(`scale=${size.width}:${size.height}`, 'setsar=1')
  }
  filters.push(
    `chromakey=${params.keyColor}:${params.similarity}:${params.blend}`,
    'format=yuva420p',
    `lutyuv=a='clip((val-${params.alphaLow})*255/(${params.alphaHigh}-${params.alphaLow}),0,255)'`
  )
  if (params.despill) {
    if (params.despillType !== 'green' && params.despillType !== 'blue') {
      throw new Error('去溢色类型无效')
    }
    filters.push(`despill=type=${params.despillType}`)
  }
  if (preview === 'alpha') filters.push('alphaextract')
  filters.push(preview ? 'format=rgba' : 'format=yuva444p10le')
  return filters.join(',')
}

export function buildExportArgs(
  input: string,
  tempOut: string,
  params: KeyParams,
  source?: SourceInfo
): string[] {
  const args = ['-hide_banner', '-y', '-nostdin']
  const { fps } = exportSettings(params)
  let filter = buildFilter(params, source)
  if (fps) {
    if (!source?.fps || !Number.isFinite(source.fps) || source.fps <= 0)
      throw new Error('导出帧率上限需要 probe 得到的源视频帧率')
    // Drop frames before expensive keying. Avoid output CFR synchronization adding tail frames.
    filter = `fps=${Math.min(source.fps, fps)},${filter}`
  }
  if (params.trim) {
    // Both are input options, using absolute source times; FFmpeg resets output timestamps.
    exportDuration(source?.duration ?? params.trim.end, params.trim)
    args.push('-ss', String(params.trim.start), '-to', String(params.trim.end))
  }
  args.push(
    '-protocol_whitelist',
    'file,pipe',
    '-noautorotate',
    '-i',
    resolve(input),
    '-map',
    '0:V:0',
    '-vf',
    filter,
    '-c:v',
    'prores_ks',
    '-profile:v',
    '4444'
  )
  if (fps) args.push('-fps_mode', 'passthrough')
  if (params.keepAudio) args.push('-map', '0:a:0?', '-c:a', 'pcm_s16le')
  else args.push('-an')
  args.push(resolve(tempOut))
  return args
}

// time is an absolute time in the source video. PNG RGBA bytes go to stdout, with no audio.
export function buildPreviewArgs(
  input: string,
  time: number,
  params: KeyParams,
  source?: SourceInfo,
  mode: Exclude<PreviewMode, 'original'> = 'keyed'
): string[] {
  if (
    !Number.isFinite(time) ||
    time < 0 ||
    (source?.duration !== undefined && time >= source.duration)
  ) {
    throw new Error('预览时间超出源视频范围')
  }
  return [
    '-hide_banner',
    '-nostdin',
    '-threads',
    '2',
    '-filter_threads',
    '1',
    '-ss',
    String(time),
    '-protocol_whitelist',
    'file,pipe',
    '-noautorotate',
    '-i',
    resolve(input),
    '-map',
    '0:V:0',
    '-vf',
    buildFilter(params, source, mode),
    '-frames:v',
    '1',
    '-an',
    '-c:v',
    'png',
    '-pix_fmt',
    'rgba',
    '-f',
    'image2pipe',
    'pipe:1'
  ]
}

export function buildThumbnailArgs(input: string): string[] {
  return [
    '-v',
    'error',
    '-nostdin',
    '-protocol_whitelist',
    'file,pipe',
    '-noautorotate',
    '-i',
    resolve(input),
    '-map',
    '0:V:0',
    '-vf',
    'scale=240:135:force_original_aspect_ratio=decrease',
    '-frames:v',
    '1',
    '-an',
    '-c:v',
    'mjpeg',
    '-q:v',
    '5',
    '-f',
    'image2pipe',
    'pipe:1'
  ]
}
