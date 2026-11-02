import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import {
  toolCandidates,
  runtimeResources,
  managedToolsRoot,
  managedBinDirectory
} from './toolPaths'
import type { ToolName, ToolReport, ToolStatus } from '../../shared/types'

interface CommandResult {
  code: number | null
  output: string
}

function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const collect = (chunk: Buffer): void => {
      output = (output + chunk.toString()).slice(-64 * 1024)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('命令执行超时（5 秒）'))
    }, 5000)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve({ code, output })
    })
  })
}

async function candidatesFor(name: ToolName): Promise<string[]> {
  const candidates = toolCandidates(
    name,
    await runtimeResources(),
    process.arch,
    name === 'avconvert'
      ? undefined
      : await managedBinDirectory(await managedToolsRoot(), process.arch)
  )
  try {
    if (name === 'avconvert') return candidates
    const result = await runCommand('/usr/bin/which', [name])
    if (result.code === 0) candidates.push(...result.output.trim().split('\n'))
  } catch {
    // Known absolute paths remain usable when GUI PATH/which is unavailable.
  }
  return [...new Set(candidates)]
}

async function inspectTool(name: ToolName): Promise<ToolStatus> {
  let lastPath: string | null = null
  let lastError = '未找到可执行文件'
  for (const path of await candidatesFor(name)) {
    try {
      await access(path, constants.X_OK)
      lastPath = path
      const result = await runCommand(path, [name === 'avconvert' ? '--help' : '-version'])
      if (name === 'avconvert') {
        // Apple's --help returns nonzero even when the tool works.
        if (!result.output.includes('Supported presets:')) throw new Error('无法读取可用预设')
        const os = await runCommand('/usr/bin/sw_vers', ['-productVersion'])
        if (os.code !== 0) throw new Error('无法读取 macOS 版本')
        const supportsAlpha = result.output.includes('PresetHEVCHighestQualityWithAlpha')
        return {
          name,
          available: supportsAlpha,
          path,
          version: `macOS ${os.output.trim()}（系统内置，无独立版本号）`,
          supportsAlpha,
          ...(!supportsAlpha && { error: '系统不支持 HEVC Alpha 转码预设' })
        }
      }
      const version = result.output.match(new RegExp(`^${name} version ([^\\s]+)`, 'm'))?.[1]
      if (result.code !== 0 || !version) throw new Error('无法读取工具版本')
      return { name, available: true, path, version }
    } catch (error) {
      if (lastPath === path) lastError = error instanceof Error ? error.message : String(error)
    }
  }
  return { name, available: false, path: lastPath, version: null, error: lastError }
}

const cachedTools = new Map<ToolName, { expires: number; pending: Promise<ToolStatus> }>()
function detectTool(name: ToolName, refresh = false): Promise<ToolStatus> {
  const cached = cachedTools.get(name)
  if (!refresh && cached && cached.expires > Date.now()) return cached.pending
  const pending = inspectTool(name)
  cachedTools.set(name, { expires: Date.now() + 30_000, pending })
  return pending
}

export async function resolveToolPath(name: ToolName): Promise<string> {
  const tool = await detectTool(name)
  if (!tool.available || !tool.path) {
    throw new Error(
      `${name} 不可用：${tool.error}。${name === 'avconvert' ? '请检查 macOS 系统。' : '请运行 brew install ffmpeg。'}`
    )
  }
  return tool.path
}

// Coalesce concurrent callers; a later explicit refresh rechecks the installation.
let pendingDetection: Promise<ToolReport> | undefined
export function detectTools(): Promise<ToolReport> {
  pendingDetection ??= Promise.all(
    (['ffmpeg', 'ffprobe', 'avconvert'] as const).map((name) => detectTool(name, true))
  )
    .then(([ffmpeg, ffprobe, avconvert]) => ({
      tools: { ffmpeg, ffprobe, avconvert },
      checkedAt: new Date().toISOString()
    }))
    .finally(() => {
      pendingDetection = undefined
    })
  return pendingDetection
}
