import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { LineTail } from './lineTail'
import type { KeyParams } from '../../shared/types'

export interface RunOptions {
  signal?: AbortSignal
  captureStdout?: boolean
  maxStdoutBytes?: number
  onStdoutLine?: (line: string) => void
  cleanupOnAbort?: string[]
  timeoutMs?: number
}

export interface RunResult {
  stdout: Buffer
  stderrLines: string[]
}

export class ProcessError extends Error {
  constructor(
    message: string,
    public readonly stderrLines: string[],
    public readonly exitCode: number | null
  ) {
    super(`${message}${stderrLines.length ? `\n${stderrLines.join('\n')}` : ''}`)
    this.name = 'ProcessError'
  }
}

export function abortError(): Error {
  const error = new Error('任务已取消')
  error.name = 'AbortError'
  return error
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

// Resolve/reject only after close: cancellation must not race file cleanup with a live writer.
export async function runProcess(
  command: string,
  args: string[],
  options: RunOptions = {}
): Promise<RunResult> {
  const { signal } = options
  try {
    throwIfAborted(signal)
    return await new Promise<RunResult>((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      const stdout: Buffer[] = []
      const stderrTail = new LineTail()
      const stderrLines = stderrTail.lines
      let stdoutBytes = 0
      let failure: Error | undefined
      let killTimer: ReturnType<typeof setTimeout> | undefined
      let timeout: ReturnType<typeof setTimeout> | undefined
      const stop = (): void => {
        if (child.exitCode !== null || child.signalCode !== null) return
        child.kill('SIGTERM')
        killTimer ??= setTimeout(() => child.kill('SIGKILL'), 3000)
      }
      const onAbort = (): void => stop()
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) stop()

      child.stderr.on('data', (chunk: Buffer) => stderrTail.push(chunk))
      const stdoutReader = options.onStdoutLine
        ? createInterface({ input: child.stdout, crlfDelay: Infinity })
        : undefined
      stdoutReader?.on('line', (line) => {
        try {
          options.onStdoutLine?.(line)
        } catch (error) {
          failure = error instanceof Error ? error : new Error(String(error))
          stop()
        }
      })
      child.stdout.on('data', (chunk: Buffer) => {
        if (options.captureStdout === false || failure) return
        stdoutBytes += chunk.length
        if (stdoutBytes > (options.maxStdoutBytes ?? 8 * 1024 * 1024)) {
          failure = new Error('子进程 stdout 超出大小限制')
          stop()
        } else {
          stdout.push(chunk)
        }
      })
      if (options.timeoutMs) {
        timeout = setTimeout(() => {
          failure = new Error(`命令执行超时（${options.timeoutMs} ms）`)
          stop()
        }, options.timeoutMs)
      }
      child.once('error', (error) => {
        failure = error
      })
      child.once('close', (code, exitSignal) => {
        clearTimeout(killTimer)
        clearTimeout(timeout)
        signal?.removeEventListener('abort', onAbort)
        stderrTail.finish()
        stdoutReader?.close()
        if (signal?.aborted) reject(abortError())
        else if (failure || code !== 0) {
          reject(
            new ProcessError(
              failure?.message ?? `${command} 退出失败（${exitSignal ?? code}）`,
              stderrLines,
              code
            )
          )
        } else resolve({ stdout: Buffer.concat(stdout), stderrLines })
      })
    })
  } finally {
    if (signal?.aborted) {
      await Promise.all((options.cleanupOnAbort ?? []).map((path) => rm(path, { force: true })))
    }
  }
}

export function exportDuration(duration: number, trim: KeyParams['trim'] = null): number {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('视频时长必须大于 0')
  if (!trim) return duration
  if (
    !Number.isFinite(trim.start) ||
    !Number.isFinite(trim.end) ||
    trim.start < 0 ||
    trim.end <= trim.start ||
    trim.end > duration
  ) {
    throw new Error(`trim 必须满足 0 ≤ start < end ≤ ${duration}`)
  }
  return trim.end - trim.start
}

export async function runFFmpeg(
  ffmpegPath: string,
  args: string[],
  options: {
    duration: number
    trim?: KeyParams['trim']
    onProgress?: (progress: number) => void
    signal?: AbortSignal
    cleanupOnAbort?: string[]
  }
): Promise<void> {
  const duration = exportDuration(options.duration, options.trim)
  let progress = 0
  throwIfAborted(options.signal)
  options.onProgress?.(0)
  await runProcess(ffmpegPath, ['-progress', 'pipe:1', '-nostats', ...args], {
    signal: options.signal,
    cleanupOnAbort: options.cleanupOnAbort,
    captureStdout: false,
    onStdoutLine: (line) => {
      const match = /^out_time_us=(-?\d+)$/.exec(line)
      if (!match) return
      const next = Math.min(1, Math.max(0, Number(match[1]) / 1_000_000 / duration))
      if (next > progress) {
        progress = next
        options.onProgress?.(progress)
      }
    }
  })
  if (progress < 1) options.onProgress?.(1)
}
