import { realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, resolve } from 'node:path'

export function trustedRendererUrl(actual: string | undefined, expected: string): boolean {
  if (!actual) return false
  try {
    return new URL(actual).href === new URL(expected).href
  } catch {
    return false
  }
}
async function canonicalOutput(path: string): Promise<string> {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0'))
    throw new Error('输出路径无效')
  return resolve(await realpath(dirname(path)), basename(path))
}
export class OutputAuthorizations {
  private grants = new Map<string, string>()
  async grant(input: string, output: string): Promise<void> {
    const normalized = await canonicalOutput(output)
    const key = `${input}\0${resolve(output)}`
    this.grants.delete(key)
    this.grants.set(key, normalized)
    if (this.grants.size > 1000) this.grants.delete(this.grants.keys().next().value!)
  }
  async consume(input: string, output: string): Promise<string> {
    if (typeof input !== 'string' || typeof output !== 'string') throw new Error('任务路径无效')
    const key = `${input}\0${resolve(output)}`
    const approved = this.grants.get(key)
    if (!approved || approved !== (await canonicalOutput(output)))
      throw new Error('输出路径未经授权或目录已变化，请重新选择输出位置')
    // One selection authorizes one new job; retries use its main-process persisted record.
    if (!this.grants.delete(key)) throw new Error('输出位置授权已使用，请重新选择')
    return approved
  }
  clear(): void {
    this.grants.clear()
  }
}
