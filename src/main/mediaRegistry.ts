import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute } from 'node:path'
import type { LocalVideo } from '../shared/types'

export interface FileIdentity {
  dev: number
  ino: number
  size: number
  mtimeMs: number
}
export const sameFile = (a: FileIdentity, b: FileIdentity): boolean =>
  a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs
export class MediaRegistry {
  private entries = new Map<string, { path: string; identity: FileIdentity }>()
  private tokens = new Map<string, string>()
  async authorize(filePath: string): Promise<LocalVideo> {
    if (
      typeof filePath !== 'string' ||
      filePath.includes('\0') ||
      !isAbsolute(filePath) ||
      !['.mp4', '.mov', '.mkv', '.m4v', '.webm', '.avi'].includes(extname(filePath).toLowerCase())
    )
      throw new Error('请选择本地视频文件（MP4 / MOV / MKV）')
    const path = await realpath(filePath)
    const info = await stat(path)
    if (!info.isFile()) throw new Error('请选择一个视频文件')
    const old = this.tokens.get(path)
    let id = old
    if (!id || !sameFile(this.entries.get(id)!.identity, info)) {
      if (old) this.entries.delete(old)
      id = randomUUID()
      this.tokens.set(path, id)
      this.entries.set(id, {
        path,
        identity: { dev: info.dev, ino: info.ino, size: info.size, mtimeMs: info.mtimeMs }
      })
    }
    return { name: basename(path), path, url: `localfile://media/${id}`, size: info.size }
  }
  get(value: string): { path: string; identity: FileIdentity } | undefined {
    try {
      const url = new URL(value)
      if (
        url.protocol !== 'localfile:' ||
        url.hostname !== 'media' ||
        url.search ||
        url.hash ||
        url.username ||
        url.password ||
        url.port ||
        !/^\/[0-9a-f-]{36}$/.test(url.pathname)
      )
        return undefined
      return this.entries.get(url.pathname.slice(1))
    } catch {
      return undefined
    }
  }
  async assertPath(path: unknown): Promise<string> {
    const token = typeof path === 'string' ? this.tokens.get(path) : undefined
    const entry = token && this.entries.get(token)
    if (!entry) throw new Error('输入视频未经授权，请先导入视频')
    const info = await stat(entry.path).catch(() => null)
    if (!info?.isFile() || !sameFile(entry.identity, info))
      throw new Error('源视频已移动或修改，请重新导入')
    return entry.path
  }
  clear(): void {
    this.entries.clear()
    this.tokens.clear()
  }
}
