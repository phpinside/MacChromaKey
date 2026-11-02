import type { KeyParams, VideoInfo } from '../../../shared/types'

export function batchParams(
  params: KeyParams,
  source: VideoInfo,
  target: VideoInfo,
  cropMode: 'scale' | 'ignore'
): KeyParams {
  const crop =
    params.crop && cropMode === 'scale'
      ? {
          x: Math.floor((params.crop.x * target.width) / source.width / 2) * 2,
          y: Math.floor((params.crop.y * target.height) / source.height / 2) * 2,
          w: Math.max(2, Math.floor((params.crop.w * target.width) / source.width / 2) * 2),
          h: Math.max(2, Math.floor((params.crop.h * target.height) / source.height / 2) * 2)
        }
      : null
  if (crop) {
    crop.x = Math.min(crop.x, Math.max(0, target.width - 2))
    crop.y = Math.min(crop.y, Math.max(0, target.height - 2))
    crop.w = Math.min(crop.w, Math.floor((target.width - crop.x) / 2) * 2)
    crop.h = Math.min(crop.h, Math.floor((target.height - crop.y) / 2) * 2)
  }
  const trim = params.trim
    ? { start: params.trim.start, end: Math.min(params.trim.end, target.duration) }
    : null
  if (trim && trim.end <= trim.start)
    throw new Error('时间区间超出该素材时长，请重设入点或使用全时长')
  return { ...params, crop, trim }
}
