import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, open, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FFmpegInstallState } from '../../shared/types'
import { runProcess, throwIfAborted } from './run'
import type { ToolReport } from '../../shared/types'

export const FFMPEG_PROVIDER = 'https://ffmpeg.martin-riedl.de'
const MAX_ARCHIVE = 256 * 1024 ** 2
const MAX_BINARY = 512 * 1024 ** 2
type Progress = (state: FFmpegInstallState) => void
type Fetcher = (url: string, options?: RequestInit) => Promise<Response>

export function trustedDownloadUrl(value: string): URL {
  const url = new URL(value, FFMPEG_PROVIDER)
  if (url.origin !== FFMPEG_PROVIDER || url.username || url.password || url.hash || url.search)
    throw new Error('下载地址不属于指定的 FFmpeg 发行源')
  return url
}

export function releaseFromUrl(
  value: string,
  arch: string
): { directory: string; version: string } {
  const url = trustedDownloadUrl(value)
  const platform = arch === 'arm64' ? 'arm64' : arch === 'x64' ? 'amd64' : ''
  const match = url.pathname.match(
    /^\/download\/macos\/(arm64|amd64)\/(\d+_(\d+\.\d+(?:\.\d+)?))\/ffmpeg\.zip$/
  )
  if (!platform || !match || match[1] !== platform)
    throw new Error('未找到当前架构的最新稳定版 FFmpeg')
  return { directory: new URL('./', url).href, version: match[3] }
}

async function request(url: string, signal: AbortSignal, fetcher: Fetcher, timeout = 30_000): Promise<Response> {
  const response = await fetcher(trustedDownloadUrl(url).href, {
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)])
  })
  return response
}

async function smallText(response: Response, limit: number): Promise<string> {
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {})
    throw new Error(`发行源请求失败（HTTP ${response.status}）`)
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes > limit) throw new Error('发行源响应超出大小限制')
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8').trim()
  } finally {
    await reader.cancel().catch(() => {})
  }
}

export async function latestRelease(
  arch: string,
  signal: AbortSignal,
  fetcher: Fetcher = fetch
): Promise<{ directory: string; version: string }> {
  if (!['arm64', 'x64'].includes(arch)) throw new Error('仅支持 Apple 芯片和 Intel Mac')
  const platform = arch === 'arm64' ? 'arm64' : 'amd64'
  const url = `${FFMPEG_PROVIDER}/redirect/latest/macos/${platform}/release/ffmpeg.zip`
  const response = await fetcher(url, {
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)])
  })
  try {
    const location = response.headers.get('location')
    if (![301, 302, 303, 307, 308].includes(response.status) || !location)
      throw new Error(`无法获取最新稳定版（HTTP ${response.status}），请稍后重试`)
    return releaseFromUrl(location, arch)
  } finally {
    await response.body?.cancel().catch(() => {})
  }
}

async function download(
  url: string,
  file: string,
  expected: string,
  signal: AbortSignal,
  fetcher: Fetcher,
  progress: (ratio: number, bytes: number) => void
): Promise<void> {
  const response = await request(url, signal, fetcher, 30 * 60_000)
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {})
    throw new Error(`下载失败（HTTP ${response.status}）`)
  }
  const total = Number(response.headers.get('content-length'))
  if (total > MAX_ARCHIVE) {
    await response.body.cancel()
    throw new Error('下载文件过大，已停止安装')
  }
  const reader = response.body.getReader()
  let output: Awaited<ReturnType<typeof open>> | undefined
  const hash = createHash('sha256')
  let bytes = 0
  try {
    output = await open(file, 'wx', 0o600)
    for (;;) {
      throwIfAborted(signal)
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes > MAX_ARCHIVE) throw new Error('下载文件过大，已停止安装')
      hash.update(value)
      await output.writeFile(value)
      progress(total > 0 ? Math.min(1, bytes / total) : 0, bytes)
    }
    if (hash.digest('hex') !== expected) throw new Error('SHA-256 校验失败，未安装下载文件，请重试')
  } finally {
    await output?.close()
    await reader.cancel().catch(() => {})
  }
}

export async function validateInstalledBinary(
  path: string,
  name: 'ffmpeg' | 'ffprobe',
  arch: string,
  version: string,
  signal: AbortSignal
): Promise<void> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BINARY)
    throw new Error('下载的工具不是有效可执行文件')
  const options = { signal, timeoutMs: 30_000, maxStdoutBytes: 128 * 1024 }
  const cpu = await runProcess('/usr/bin/lipo', ['-archs', path], options)
  if (
    !cpu.stdout
      .toString()
      .split(/\s+/)
      .includes(arch === 'arm64' ? 'arm64' : 'x86_64')
  )
    throw new Error('下载的工具架构不匹配')
  // Verify an Apple-issued Developer ID signature before running any downloaded code.
  await runProcess(
    '/usr/bin/codesign',
    ['--verify', '--strict', '-R', 'anchor apple generic', path],
    options
  )
  const signature = await runProcess('/usr/bin/codesign', ['-d', '--verbose=4', path], options)
  if (
    !signature.stderrLines.includes(
      'Authority=Developer ID Application: Martin Riedl (KU3N25YGLU)'
    ) ||
    !signature.stderrLines.includes('TeamIdentifier=KU3N25YGLU')
  )
    throw new Error('FFmpeg 发行者签名不匹配，已停止安装')
  await chmod(path, 0o700)
  const result = await runProcess(path, ['-version'], options)
  const found = result.stdout.toString().match(new RegExp(`^${name} version ([^\\s]+)`, 'm'))?.[1]
  if (found !== version && !found?.startsWith(`${version}-`))
    throw new Error('工具版本与下载的稳定发行版不一致')
  if (name === 'ffmpeg') {
    const filters = await runProcess(path, ['-hide_banner', '-filters'], options)
    const encoders = await runProcess(path, ['-hide_banner', '-encoders'], options)
    for (const filter of ['chromakey', 'lutyuv', 'despill', 'alphaextract', 'scale', 'fps'])
      if (!new RegExp(`\\s${filter}\\s`).test(filters.stdout.toString()))
        throw new Error(`FFmpeg 缺少 ${filter} 滤镜`)
    for (const encoder of ['prores_ks', 'pcm_s16le', 'png', 'mjpeg'])
      if (!new RegExp(`\\s${encoder}\\s`).test(encoders.stdout.toString()))
        throw new Error(`FFmpeg 缺少 ${encoder} 编码器`)
  }
}

export async function installFFmpeg(
  root: string,
  arch: string,
  progress: Progress,
  signal: AbortSignal,
  fetcher: Fetcher = fetch,
  validate = validateInstalledBinary
): Promise<string> {
  throwIfAborted(signal)
  progress({ stage: 'checking', progress: 0, message: '正在查找适用的最新稳定版 FFmpeg…' })
  const release = await latestRelease(arch, signal, fetcher)
  const directory = join(root, arch)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const staging = await mkdtemp(join(directory, '.install-'))
  const selected = `${release.version}-${randomUUID()}`
  const destination = join(directory, selected)
  const manifest = join(directory, `current-${randomUUID()}.json`)
  let published = false
  try {
    for (const [index, name] of (['ffmpeg', 'ffprobe'] as const).entries()) {
      throwIfAborted(signal)
      const url = new URL(`${name}.zip`, release.directory).href
      const checksum = await smallText(await request(`${url}.sha256`, signal, fetcher), 4096)
      const match = checksum.match(new RegExp(`^([a-f0-9]{64})\\s+\\*?${name}\\.zip$`, 'i'))
      if (!match) throw new Error('发行源没有提供有效的 SHA-256 校验值')
      const zip = join(staging, `${name}.zip`)
      progress({
        stage: 'downloading',
        progress: 5 + index * 40,
        version: release.version,
        message: `正在下载 ${name} ${release.version}…`
      })
      await download(url, zip, match[1].toLowerCase(), signal, fetcher, (ratio, bytes) =>
        progress({
          stage: 'downloading',
          progress: 5 + index * 40 + ratio * 30,
          version: release.version,
          message: `正在下载 ${name} ${release.version} · ${(bytes / 1024 ** 2).toFixed(1)} MB`
        })
      )
      const options = { signal, timeoutMs: 120_000, maxStdoutBytes: 64 * 1024 }
      const summary = await runProcess('/usr/bin/unzip', ['-Z', '-t', zip], options)
      const uncompressed = Number(summary.stdout.toString().match(/(\d+) bytes uncompressed/)?.[1])
      if (!uncompressed || uncompressed > MAX_BINARY) throw new Error('工具压缩包大小无效')
      // Extract only this literal root entry; no archive paths are used as destinations.
      await runProcess('/usr/bin/unzip', ['-qq', zip, name, '-d', staging], options)
      progress({
        stage: 'verifying',
        progress: 38 + index * 40,
        version: release.version,
        message: `正在验证 ${name} 的架构、发行者签名和功能…`
      })
      await validate(join(staging, name), name, arch, release.version, signal)
      await rm(zip)
    }
    throwIfAborted(signal)
    progress({
      stage: 'installing',
      progress: 95,
      version: release.version,
      message: '正在启用 FFmpeg 与 ffprobe…'
    })
    await rename(staging, destination)
    await writeFile(
      manifest,
      JSON.stringify({ directory: selected, version: release.version, source: FFMPEG_PROVIDER }) +
        '\n',
      { mode: 0o600 }
    )
    throwIfAborted(signal)
    await rename(manifest, join(directory, 'current.json'))
    published = true
    return release.version
  } finally {
    await Promise.all([
      rm(staging, { recursive: true, force: true }),
      rm(manifest, { force: true }),
      published ? Promise.resolve() : rm(destination, { recursive: true, force: true })
    ])
  }
}

export class FFmpegInstaller {
  private value: FFmpegInstallState = { stage: 'idle', progress: 0, message: '' }
  private pending?: Promise<FFmpegInstallState>
  private controller?: AbortController
  private listeners = new Set<Progress>()
  private timer?: ReturnType<typeof setTimeout>
  constructor(private run: (progress: Progress, signal: AbortSignal) => Promise<string>) {}
  state(): FFmpegInstallState {
    return { ...this.value }
  }
  subscribe(listener: Progress): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private update = (value: FFmpegInstallState): void => {
    this.value = value
    this.timer ??= setTimeout(() => {
      this.timer = undefined
      for (const listener of this.listeners) listener(this.state())
    }, 200)
  }
  start(): Promise<FFmpegInstallState> {
    if (this.pending) return this.pending
    const controller = new AbortController()
    this.controller = controller
    this.update({ stage: 'checking', progress: 0, message: '正在检查 FFmpeg 安装环境…' })
    this.pending = (async () => {
      try {
        // Defer even a synchronously throwing runner until pending is assigned.
        await Promise.resolve()
        const version = await this.run(this.update, controller.signal)
        this.update({
          stage: 'done',
          progress: 100,
          version,
          message: `FFmpeg ${version} 与 ffprobe 已安装`
        })
      } catch (error) {
        const canceled = controller.signal.aborted || (error as Error).name === 'AbortError'
        const message = canceled
          ? '已取消安装，可点击重试'
          : `自动安装失败：${(error as Error).message}`
        this.update({
          stage: canceled ? 'canceled' : 'failed',
          progress: 0,
          message,
          ...(!canceled && { error: message })
        })
      } finally {
        this.pending = undefined
        this.controller = undefined
      }
      return this.state()
    })()
    return this.pending
  }
  ensureMissing(report: ToolReport): void {
    if (
      this.value.stage === 'idle' &&
      (!report.tools.ffmpeg.available || !report.tools.ffprobe.available)
    )
      void this.start()
  }
  async cancel(): Promise<void> {
    this.controller?.abort()
    await this.pending
  }
  async shutdown(): Promise<void> {
    await this.cancel()
    clearTimeout(this.timer)
    this.listeners.clear()
  }
}
