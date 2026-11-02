import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DEFAULT_PARAMS, type KeyParams, type ParameterPreset } from '../shared/types'
import { parseKeyParams } from './jobs/validation'

export const DEFAULT_PRESET: ParameterPreset = {
  id: 'default-green',
  name: '默认绿幕',
  params: DEFAULT_PARAMS,
  builtin: true
}

function settings(value: KeyParams): KeyParams {
  return parseKeyParams({ ...value, crop: null, trim: null })
}

export class PresetStore {
  private writing: Promise<unknown> = Promise.resolve()
  constructor(private filePath: string) {}

  async list(): Promise<ParameterPreset[]> {
    await this.writing.catch(() => {})
    return [structuredClone(DEFAULT_PRESET), ...(await this.read())]
  }

  save(name: string, params: KeyParams): Promise<ParameterPreset[]> {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 60)
      return Promise.reject(new Error('预设名称请输入 1–60 个字符'))
    name = name.trim()
    if (name === DEFAULT_PRESET.name)
      return Promise.reject(new Error('请使用其他名称保存自定义预设'))
    const clean = settings(params)
    return this.mutate(async (items) => {
      const existing = items.find((item) => item.name === name)
      const preset = { id: existing?.id ?? randomUUID(), name, params: clean }
      return [...items.filter((item) => item.id !== preset.id), preset]
    })
  }

  delete(id: string): Promise<ParameterPreset[]> {
    if (typeof id !== 'string' || id === DEFAULT_PRESET.id)
      return Promise.reject(new Error('内置预设不能删除'))
    return this.mutate(async (items) => items.filter((item) => item.id !== id))
  }

  private async read(): Promise<ParameterPreset[]> {
    try {
      const data: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
      if (!Array.isArray(data)) throw new Error('预设文件必须是数组')
      const ids = new Set<string>()
      return data.map((item: ParameterPreset) => {
        if (
          !item ||
          typeof item.id !== 'string' ||
          !item.id ||
          item.id === DEFAULT_PRESET.id ||
          ids.has(item.id) ||
          typeof item.name !== 'string' ||
          !item.name.trim() ||
          item.name.length > 60
        )
          throw new Error('预设记录无效')
        ids.add(item.id)
        return { id: item.id, name: item.name, params: settings(item.params) }
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new Error(
        `读取 presets.json 失败：${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  private mutate(
    action: (items: ParameterPreset[]) => Promise<ParameterPreset[]>
  ): Promise<ParameterPreset[]> {
    const operation = this.writing
      .catch(() => {})
      .then(async () => {
        const items = await action(await this.read())
        const temporary = `${this.filePath}.${randomUUID()}.tmp`
        try {
          await mkdir(dirname(this.filePath), { recursive: true })
          await writeFile(temporary, JSON.stringify(items, null, 2) + '\n', { mode: 0o600 })
          await rename(temporary, this.filePath)
        } finally {
          await rm(temporary, { force: true })
        }
        return [structuredClone(DEFAULT_PRESET), ...items]
      })
    this.writing = operation
    return operation
  }
}
