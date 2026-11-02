import { constants } from 'node:fs'
import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/types'

function parseSettings(value: unknown): AppSettings {
  if (!value || typeof value !== 'object') throw new Error('设置无效')
  const settings = value as AppSettings
  if (
    !Number.isInteger(settings.concurrency) ||
    settings.concurrency < 1 ||
    settings.concurrency > 8
  )
    throw new Error('并发数必须是 1–8 的整数')
  for (const path of [settings.outputDirectory, settings.tempDirectory]) {
    if (path !== null && (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')))
      throw new Error('目录必须是本地绝对路径')
  }
  return {
    concurrency: settings.concurrency,
    outputDirectory: settings.outputDirectory,
    tempDirectory: settings.tempDirectory
  }
}

export class SettingsStore {
  private value: AppSettings = { ...DEFAULT_SETTINGS }
  private writing: Promise<unknown> = Promise.resolve()
  private constructor(private path: string) {}

  static async open(path: string): Promise<SettingsStore> {
    const store = new SettingsStore(path)
    try {
      store.value = parseSettings(JSON.parse(await readFile(path, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error(`读取 settings.json 失败：${String(error)}`)
    }
    // Stored external drives may be offline. Validate availability when saving/using them.
    return store
  }
  get(): AppSettings {
    return { ...this.value }
  }

  save(value: unknown): Promise<AppSettings> {
    const operation = this.writing
      .catch(() => {})
      .then(async () => {
        const clean = parseSettings(value)
        for (const path of [clean.outputDirectory, clean.tempDirectory]) {
          if (!path) continue
          try {
            if (!(await stat(path)).isDirectory()) throw new Error('不是目录')
            await access(path, constants.W_OK)
          } catch {
            throw new Error(`目录不存在或不可写：${path}`)
          }
        }
        const temporary = `${this.path}.${randomUUID()}.tmp`
        try {
          await mkdir(dirname(this.path), { recursive: true })
          await writeFile(temporary, JSON.stringify(clean, null, 2) + '\n', { mode: 0o600 })
          await rename(temporary, this.path)
          this.value = clean
        } finally {
          await rm(temporary, { force: true })
        }
        return this.get()
      })
    this.writing = operation
    return operation
  }
}
