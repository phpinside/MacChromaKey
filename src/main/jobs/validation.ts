import { isAbsolute, resolve, extname } from 'node:path'
import type { AddJobRequest, Job, KeyParams } from '../../shared/types'
import { buildFilter, normalizeCrop } from '../ffmpeg/buildFilter'
import { exportDuration } from '../ffmpeg/run'

export function parseAddJob(value: unknown): AddJobRequest {
  if (!value || typeof value !== 'object') throw new Error('任务参数无效')
  const request = value as AddJobRequest
  for (const path of [request.inputPath, request.outputPath]) {
    if (typeof path !== 'string' || !path.trim() || path.includes('\0') || !isAbsolute(path)) {
      throw new Error('输入和输出必须为本地文件的绝对路径')
    }
  }
  if (extname(request.outputPath).toLowerCase() !== '.mov') throw new Error('输出必须为 .mov 文件')
  const clean = parseKeyParams(request.params)
  return {
    inputPath: resolve(request.inputPath),
    outputPath: resolve(request.outputPath),
    params: clean
  }
}

export function parseKeyParams(value: unknown): KeyParams {
  const params = value as KeyParams
  if (
    !params ||
    typeof params !== 'object' ||
    typeof params.keyColor !== 'string' ||
    typeof params.despill !== 'boolean' ||
    typeof params.keepAudio !== 'boolean' ||
    !['green', 'blue'].includes(params.despillType) ||
    ![params.similarity, params.blend, params.alphaLow, params.alphaHigh].every(Number.isFinite)
  ) {
    throw new Error('抠像参数无效')
  }
  // Validate settings independently of the source; actual crop/size use probed bounds later.
  buildFilter({ ...params, crop: null }, { width: 2, height: 2 })
  if (params.crop !== null && (typeof params.crop !== 'object' || !params.crop))
    throw new Error('crop 无效')
  if (params.trim !== null) {
    if (!params.trim || typeof params.trim !== 'object') throw new Error('trim 无效')
    exportDuration(params.trim.end, params.trim)
  }
  return {
    keyColor: params.keyColor,
    similarity: params.similarity,
    blend: params.blend,
    alphaLow: params.alphaLow,
    alphaHigh: params.alphaHigh,
    despill: params.despill,
    despillType: params.despillType,
    keepAudio: params.keepAudio,
    exportMaxEdge: params.exportMaxEdge === undefined ? 0 : params.exportMaxEdge,
    exportFps: params.exportFps === undefined ? 0 : params.exportFps,
    crop: params.crop
      ? normalizeCrop(params.crop, {
          width: Number.MAX_SAFE_INTEGER,
          height: Number.MAX_SAFE_INTEGER
        })
      : null,
    trim: params.trim ? { start: params.trim.start, end: params.trim.end } : null
  }
}

export function parseSavedJobs(value: unknown): Job[] {
  if (!Array.isArray(value)) throw new Error('jobs.json 必须为任务数组')
  const ids = new Set<string>()
  return value.map((item: Job) => {
    const request = parseAddJob(item)
    const validTime = (time: unknown): boolean =>
      time === null || (typeof time === 'string' && Number.isFinite(Date.parse(time)))
    if (
      typeof item.id !== 'string' ||
      !item.id ||
      ids.has(item.id) ||
      !['queued', 'running', 'done', 'failed', 'canceled'].includes(item.status) ||
      !['keying', 'apple-transcode', 'verifying'].includes(item.stage) ||
      !Number.isFinite(item.progress) ||
      item.progress < 0 ||
      item.progress > 100 ||
      !validTime(item.startedAt) ||
      !validTime(item.finishedAt) ||
      (item.error !== undefined && typeof item.error !== 'string') ||
      (item.stderrTail !== undefined &&
        (!Array.isArray(item.stderrTail) ||
          item.stderrTail.length > 50 ||
          !item.stderrTail.every((line) => typeof line === 'string' && line.length <= 8192))) ||
      (item.thumbnail !== undefined &&
        (typeof item.thumbnail !== 'string' ||
          item.thumbnail.length > 360000 ||
          !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(item.thumbnail)))
    ) {
      throw new Error('jobs.json 中的任务记录无效')
    }
    ids.add(item.id)
    return {
      ...request,
      id: item.id,
      status: item.status,
      stage: item.stage,
      progress: item.status === 'done' ? 100 : item.progress,
      startedAt: item.startedAt,
      finishedAt: item.finishedAt,
      ...(item.error !== undefined && { error: item.error }),
      ...(item.stderrTail !== undefined && { stderrTail: [...item.stderrTail] }),
      ...(item.thumbnail !== undefined && { thumbnail: item.thumbnail })
    }
  })
}
