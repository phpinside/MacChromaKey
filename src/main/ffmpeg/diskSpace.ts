import { stat, statfs } from 'node:fs/promises'
import type { KeyParams, VideoInfo } from '../../shared/types'
import { exportDuration } from './run'
import { exportDimensions } from './buildFilter'

const MiB = 1024 ** 2
export function estimateExportBytes(
  source: VideoInfo,
  params: KeyParams
): { intermediate: number; encoded: number } {
  const duration = exportDuration(source.duration, params.trim)
  const size = exportDimensions(source, params)
  const fps = params.exportFps ? Math.min(source.fps, params.exportFps) : source.fps
  const factor = ((size.width * size.height) / (1920 * 1080)) * (fps / 30)
  // Budget, not a codec guarantee: 500 Mbps ProRes 4444 at 1080p30, 30% headroom.
  const intermediate = Math.ceil(
    ((duration *
      (Math.max(32_000_000, 500_000_000 * factor) + (params.keepAudio ? 2_000_000 : 0))) /
      8) *
      1.3
  )
  const encoded = Math.ceil(((duration * Math.max(16_000_000, 100_000_000 * factor)) / 8) * 1.3)
  return { intermediate, encoded }
}
interface Volume {
  id: string
  available: number
}
async function volume(path: string): Promise<Volume> {
  const [info, space] = await Promise.all([stat(path), statfs(path)])
  if (!info.isDirectory()) throw new Error(`不是目录：${path}`)
  return { id: String(info.dev), available: space.bavail * space.bsize }
}
const gb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(2)} GB`

export class DiskSpaceBudget {
  private reserved = new Map<string, number>()
  constructor(private inspect: (path: string) => Promise<Volume> = volume) {}

  async reserve(
    temp: string,
    output: string,
    source: VideoInfo,
    params: KeyParams
  ): Promise<() => void> {
    const [temporary, destination] = await Promise.all([this.inspect(temp), this.inspect(output)])
    const bytes = estimateExportBytes(source, params)
    const needs = [
      { ...temporary, path: temp, bytes: bytes.intermediate + bytes.encoded + 256 * MiB }
    ]
    if (temporary.id !== destination.id)
      needs.push({ ...destination, path: output, bytes: bytes.encoded + 128 * MiB })
    // No awaits in check+reserve: concurrent jobs cannot both spend the same free budget.
    for (const need of needs) {
      const available = Math.max(0, need.available - (this.reserved.get(need.id) ?? 0))
      if (available < need.bytes)
        throw new Error(
          `磁盘空间不足：${need.path}\n预估需要 ${gb(need.bytes)}，扣除其他运行任务预留后可用 ${gb(available)}。ProRes 4444 中间文件较大，请释放空间或在设置中更换临时 / 输出目录。`
        )
    }
    for (const need of needs)
      this.reserved.set(need.id, (this.reserved.get(need.id) ?? 0) + need.bytes)
    let released = false
    return () => {
      if (released) return
      released = true
      for (const need of needs) {
        const remaining = (this.reserved.get(need.id) ?? 0) - need.bytes
        if (remaining > 0) this.reserved.set(need.id, remaining)
        else this.reserved.delete(need.id)
      }
    }
  }
}
export const exportDiskBudget = new DiskSpaceBudget()
