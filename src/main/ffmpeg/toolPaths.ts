import { join, resolve } from 'node:path'
import type { ToolName } from '../../shared/types'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'

export function toolCandidates(
  name: ToolName,
  resources: string,
  arch: string,
  managed?: string
): string[] {
  if (name === 'avconvert') return ['/usr/bin/avconvert']
  return [
    join(resources, 'bin', arch, name),
    join(resources, 'bin', name),
    ...(managed ? [join(managed, name)] : []),
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`
  ]
}

export async function managedToolsRoot(): Promise<string> {
  if (process.versions.electron && process.type === 'browser') {
    const { app } = await import('electron')
    return join(app.getPath('userData'), 'tools')
  }
  return join(homedir(), 'Library/Application Support/MacChromaKey/tools')
}

export async function managedBinDirectory(root: string, arch: string): Promise<string | undefined> {
  try {
    const content = await readFile(join(root, arch, 'current.json'), 'utf8')
    if (content.length > 1024) return undefined
    const { directory } = JSON.parse(content)
    if (typeof directory !== 'string' || !/^\d+\.\d+(?:\.\d+)?-[0-9a-f-]{36}$/.test(directory))
      return undefined
    return join(root, arch, directory)
  } catch {
    return undefined
  }
}
export async function runtimeResources(): Promise<string> {
  if (process.versions.electron && process.type === 'browser') {
    const { app } = await import('electron')
    return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  }
  return resolve('resources')
}
