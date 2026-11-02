import { stat } from 'node:fs/promises'
import { buildThumbnailArgs } from './buildFilter'
import { resolveToolPath } from './detectTools'
import { runProcess } from './run'

export class ThumbnailCache {
  private work: Promise<unknown> = Promise.resolve()
  private controller = new AbortController()
  private cache = new Map<string, { stamp: string; data: Promise<string | undefined> }>()
  async get(input: string): Promise<string | undefined> {
    try {
      const info = await stat(input)
      const stamp = `${info.size}:${info.mtimeMs}`
      const cached = this.cache.get(input)
      if (cached?.stamp === stamp) {
        this.cache.delete(input)
        this.cache.set(input, cached)
        return cached.data
      }
      const data = this.work
        .catch(() => {})
        .then(async () => {
          if (this.controller.signal.aborted) return undefined
          const ffmpeg = await resolveToolPath('ffmpeg')
          const { stdout } = await runProcess(ffmpeg, buildThumbnailArgs(input), {
            signal: this.controller.signal,
            timeoutMs: 10_000,
            maxStdoutBytes: 256 * 1024
          })
          if (stdout.length < 4 || stdout[0] !== 0xff || stdout[1] !== 0xd8) return undefined
          return `data:image/jpeg;base64,${stdout.toString('base64')}`
        })
        .catch(() => {
          if (this.cache.get(input)?.stamp === stamp) this.cache.delete(input)
          return undefined // A missing thumbnail must not stop editing/importing a valid video.
        })
      this.work = data
      this.cache.set(input, { stamp, data })
      if (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!)
      return data
    } catch {
      return undefined
    }
  }
  async shutdown(): Promise<void> {
    this.controller.abort()
    await this.work.catch(() => {})
    this.cache.clear()
  }
}
