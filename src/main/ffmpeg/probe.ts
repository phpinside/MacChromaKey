import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { VideoInfo } from '../../shared/types'
import { resolveToolPath } from './detectTools'
import { runProcess, throwIfAborted } from './run'

export interface ProbeStream {
  index: number
  codec_type?: string
  codec_name?: string
  codec_tag_string?: string
  pix_fmt?: string
  width?: number
  height?: number
  duration?: string
  duration_ts?: number
  time_base?: string
  avg_frame_rate?: string
  r_frame_rate?: string
  extradata?: string
  disposition?: { attached_pic?: number }
}

export interface ProbeDocument {
  streams: ProbeStream[]
  format?: { duration?: string }
  packets?: { data?: string }[]
}

export interface ProbeOptions {
  ffprobePath?: string
  signal?: AbortSignal
}

export function rational(value: string | undefined): number {
  if (!value) return 0
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value)
  const match = /^(\d+)\/(\d+)$/.exec(value)
  if (!match || Number(match[2]) === 0) return 0
  return Number(match[1]) / Number(match[2])
}

export async function probeDocument(
  input: string,
  options: ProbeOptions = {},
  extraArgs: string[] = []
): Promise<ProbeDocument> {
  throwIfAborted(options.signal)
  const path = options.ffprobePath ?? (await resolveToolPath('ffprobe'))
  const result = await runProcess(
    path,
    [
      '-protocol_whitelist',
      'file,pipe',
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_streams',
      '-show_format',
      ...extraArgs,
      resolve(input)
    ],
    { signal: options.signal, timeoutMs: 30_000, maxStdoutBytes: 32 * 1024 * 1024 }
  )
  let document: ProbeDocument
  try {
    document = JSON.parse(result.stdout.toString('utf8'))
  } catch {
    throw new Error('ffprobe 未返回有效 JSON')
  }
  if (!document || !Array.isArray(document.streams)) throw new Error('ffprobe 未返回流信息')
  return document
}

export function primaryVideo(document: ProbeDocument): ProbeStream {
  const video = document.streams.find(
    (stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1
  )
  if (!video) throw new Error('文件中没有可用的视频流')
  return video
}

export function videoInfo(document: ProbeDocument): VideoInfo {
  const video = primaryVideo(document)
  const width = video.width ?? 0
  const height = video.height ?? 0
  const duration =
    Number(video.duration) ||
    Number(document.format?.duration) ||
    (video.duration_ts ?? 0) * rational(video.time_base)
  const fps = rational(video.avg_frame_rate) || rational(video.r_frame_rate)
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('无法读取视频尺寸')
  }
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取视频时长')
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('无法读取视频帧率')
  return {
    width,
    height,
    duration,
    fps,
    hasAudio: document.streams.some((stream) => stream.codec_type === 'audio')
  }
}

export async function probe(input: string, options: ProbeOptions = {}): Promise<VideoInfo> {
  return videoInfo(await probeDocument(input, options))
}

const previewSources = new Map<string, { stamp: string; info: VideoInfo }>()
// Preview only; exports always probe freshly. Detect source changes and bound metadata memory.
export async function probeCached(input: string, options: ProbeOptions = {}): Promise<VideoInfo> {
  throwIfAborted(options.signal)
  const path = resolve(input)
  const file = await stat(path)
  const stamp = `${file.dev}:${file.ino}:${file.size}:${file.mtimeMs}`
  const cached = previewSources.get(path)
  if (cached?.stamp === stamp) {
    throwIfAborted(options.signal)
    previewSources.delete(path)
    previewSources.set(path, cached)
    return cached.info
  }
  const info = await probe(path, options)
  previewSources.delete(path)
  previewSources.set(path, { stamp, info })
  if (previewSources.size > 32) previewSources.delete(previewSources.keys().next().value!)
  return info
}
