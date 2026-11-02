import { copyFile, mkdtemp, realpath, rename, rm, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import type { ExportProgress, KeyParams } from '../../shared/types'
import { buildExportArgs, buildFilter, normalizeCrop } from './buildFilter'
import { detectTools } from './detectTools'
import { probe } from './probe'
import { ProcessError, runFFmpeg, runProcess, throwIfAborted } from './run'
import { exportDiskBudget, type DiskSpaceBudget } from './diskSpace'
import { validateOutput, type ValidatedVideo } from './validateOutput'

export interface ExportResult extends ValidatedVideo {
  outputPath: string
}

export interface ExportOptions {
  tempDirectory?: string | null
  diskBudget?: DiskSpaceBudget
}

async function tempRoot(): Promise<string> {
  if (process.versions.electron && process.type === 'browser') {
    const { app } = await import('electron')
    await app.whenReady()
    return app.getPath('temp')
  }
  // tsx runs under Node, where Electron's app API does not exist.
  return tmpdir()
}

async function performExport(
  input: string,
  output: string,
  params: KeyParams,
  onProgress: (event: ExportProgress) => void,
  signal?: AbortSignal,
  options: ExportOptions = {}
): Promise<ExportResult> {
  throwIfAborted(signal)
  onProgress({ stage: 'probing', progress: 0, message: '正在读取视频信息' })
  const inputPath = await realpath(resolve(input)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT')
      throw new Error(`输入文件已移动或删除：${input}。请重新编辑并定位源视频。`)
    if (error.code === 'EACCES') throw new Error(`无法读取输入文件，请检查访问权限：${input}`)
    throw error
  })
  const outputPath = resolve(output)
  if (extname(outputPath).toLowerCase() !== '.mov') throw new Error('输出文件必须使用 .mov 扩展名')
  const inputStat = await stat(inputPath)
  if (!inputStat.isFile()) throw new Error('输入路径不是视频文件')
  if (!(await stat(dirname(outputPath))).isDirectory()) throw new Error('输出目录无效')
  const outputStat = await stat(outputPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (outputStat && !outputStat.isFile()) throw new Error('输出路径不是文件')
  if (
    inputPath === outputPath ||
    (outputStat?.dev === inputStat.dev && outputStat?.ino === inputStat.ino)
  ) {
    throw new Error('输出路径不能与输入视频相同')
  }
  const tools = await detectTools()
  throwIfAborted(signal)
  for (const tool of Object.values(tools.tools)) {
    if (!tool.available || !tool.path) throw new Error(`${tool.name} 不可用：${tool.error}`)
  }
  const ffmpeg = tools.tools.ffmpeg.path!
  const ffprobe = tools.tools.ffprobe.path!
  const avconvert = tools.tools.avconvert.path!
  const source = await probe(inputPath, { ffprobePath: ffprobe, signal })
  if (params.crop) params.crop = normalizeCrop(params.crop, source)
  // Validate before allocating large temporary files.
  buildFilter(params, source)
  const temporaryRoot = options.tempDirectory ?? (await tempRoot())
  onProgress({ stage: 'probing', progress: 0, message: '正在预检临时文件与输出磁盘空间' })
  const release = await (options.diskBudget ?? exportDiskBudget).reserve(
    temporaryRoot,
    dirname(outputPath),
    source,
    params
  )
  let directory: string | undefined
  const staging = join(dirname(outputPath), `.${basename(outputPath)}.${randomUUID()}.tmp`)
  try {
    throwIfAborted(signal)
    directory = await mkdtemp(join(temporaryRoot, 'macchromakey-export-'))
    const intermediate = join(directory, 'prores-4444.mov')
    const converted = join(directory, 'hevc-alpha.mov')
    await runFFmpeg(ffmpeg, buildExportArgs(inputPath, intermediate, params, source), {
      duration: source.duration,
      trim: params.trim,
      signal,
      cleanupOnAbort: [intermediate],
      onProgress: (progress) =>
        onProgress({ stage: 'keying', progress: progress * 0.9, message: '绿幕抠像中' })
    })
    throwIfAborted(signal)
    onProgress({ stage: 'converting', progress: 0.9, message: 'Apple 转码中' })
    await runProcess(
      avconvert,
      [
        '--preset',
        'PresetHEVCHighestQualityWithAlpha',
        '--source',
        intermediate,
        '--output',
        converted,
        '--replace'
      ],
      { signal, captureStdout: false, cleanupOnAbort: [converted] }
    )
    throwIfAborted(signal)
    onProgress({ stage: 'validating', progress: 0.9, message: '正在校验 HEVC 和 Apple Alpha 层' })
    const validated = await validateOutput(converted, { ffprobePath: ffprobe, signal })
    throwIfAborted(signal)
    // Publish only validated output. Failed/cancelled encodes leave an existing destination intact.
    try {
      await rename(converted, outputPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
      // Cross-volume copies stage on the destination, preserving an existing output on ENOSPC.
      await copyFile(converted, staging)
      throwIfAborted(signal)
      await rename(staging, outputPath)
    }
    onProgress({ stage: 'done', progress: 1, message: '导出完成' })
    return { outputPath, ...validated }
  } finally {
    try {
      await Promise.all([
        directory ? rm(directory, { recursive: true, force: true }) : Promise.resolve(),
        rm(staging, { force: true })
      ])
    } finally {
      release()
    }
  }
}

export function runExport(
  input: string,
  output: string,
  params: KeyParams,
  onProgress: (event: ExportProgress) => void = () => {},
  signal?: AbortSignal,
  options: ExportOptions = {}
): Promise<ExportResult> {
  const snapshot = {
    ...params,
    crop: params.crop && { ...params.crop },
    trim: params.trim && { ...params.trim }
  }
  // Scheduling belongs to jobs/queue.ts. The CLI invokes one pipeline directly.
  return performExport(input, output, snapshot, onProgress, signal, options).catch(
    (error: Error & { code?: string }) => {
      if (signal?.aborted) throw error
      const stderr = error instanceof ProcessError ? error.stderrLines : []
      if (
        error.code === 'ENOSPC' ||
        /No space left on device|Disk quota exceeded/i.test(error.message)
      )
        throw new ProcessError(
          '磁盘空间不足，写入失败。请释放空间或在设置中更换临时 / 输出目录后重试。',
          stderr,
          error instanceof ProcessError ? error.exitCode : null
        )
      if (
        /Error opening input.*No such file|Error opening input files: No such file/is.test(
          error.message
        )
      )
        throw new ProcessError(
          '输入文件已移动或删除，请重新编辑并定位源视频。',
          stderr,
          error instanceof ProcessError ? error.exitCode : null
        )
      throw error
    }
  )
}
