import type { PreviewFrameRequest, PreviewFrameResult } from '../../shared/types'
import { parseKeyParams } from '../jobs/validation'
import { buildPreviewArgs } from './buildFilter'
import { resolveToolPath } from './detectTools'
import { probeCached } from './probe'
import { abortError, runProcess, throwIfAborted } from './run'

export async function renderPreview(
  path: string,
  request: PreviewFrameRequest,
  signal: AbortSignal
): Promise<string> {
  const source = await probeCached(path, { signal })
  const ffmpeg = await resolveToolPath('ffmpeg')
  throwIfAborted(signal)
  const { stdout } = await runProcess(
    ffmpeg,
    buildPreviewArgs(path, request.time, request.params, source, request.mode),
    { signal, timeoutMs: 20_000, maxStdoutBytes: 8 * 1024 * 1024 }
  )
  if (stdout.length < 24 || !stdout.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    throw new Error('FFmpeg 没有返回有效预览帧，请向前移动一帧后重试')
  }
  return `data:image/png;base64,${stdout.toString('base64')}`
}

// One active process for the window. Wait for close before starting the successor.
export class FramePreview {
  private active?: { id: string; controller: AbortController; done: Promise<PreviewFrameResult> }

  constructor(private render = renderPreview) {}

  frame(path: string, value: PreviewFrameRequest): Promise<PreviewFrameResult> {
    if (!value || typeof value.id !== 'string' || !value.id || value.id.length > 128)
      throw new Error('预览请求 ID 无效')
    if (!['keyed', 'alpha'].includes(value.mode)) throw new Error('预览模式无效')
    if (!Number.isFinite(value.time) || value.time < 0) throw new Error('预览时间无效')
    const request = { ...value, params: parseKeyParams(value.params) }
    const previous = this.active
    previous?.controller.abort()
    const controller = new AbortController()
    const done = (async (): Promise<PreviewFrameResult> => {
      try {
        await previous?.done.catch(() => {})
        if (controller.signal.aborted) throw abortError()
        const dataUrl = await this.render(path, request, controller.signal)
        return { id: request.id, dataUrl: controller.signal.aborted ? null : dataUrl }
      } catch (error) {
        if (controller.signal.aborted) return { id: request.id, dataUrl: null }
        throw error
      } finally {
        if (this.active?.controller === controller) this.active = undefined
      }
    })()
    this.active = { id: request.id, controller, done }
    return done
  }

  async cancel(id?: string): Promise<void> {
    const active = this.active
    if (!active || (id !== undefined && active.id !== id)) return
    active.controller.abort()
    await active.done.catch(() => {})
  }
}
