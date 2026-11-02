import { resolve } from 'node:path'
import { DEFAULT_PARAMS, type ExportProgress } from '../src/shared/types'
import { runExport } from '../src/main/ffmpeg/pipeline'

async function main(): Promise<void> {
  const [input, output, ...flags] = process.argv.slice(2)
  const params = { ...DEFAULT_PARAMS }
  let valid = flags.length % 2 === 0
  const seen = new Set<string>()
  for (let i = 0; i < flags.length; i += 2) {
    const flag = flags[i]
    const value = Number(flags[i + 1])
    if (seen.has(flag)) valid = false
    seen.add(flag)
    if (flag === '--max-edge' && [0, 720, 960, 1280, 1920].includes(value))
      params.exportMaxEdge = value as typeof params.exportMaxEdge
    else if (flag === '--fps' && [0, 15, 24, 30, 60].includes(value))
      params.exportFps = value as typeof params.exportFps
    else valid = false
  }
  if (!input || !output || !valid) {
    console.error(
      '用法：tsx scripts/test-pipeline.ts input.mp4 output.mov [--max-edge 720|960|1280|1920|0] [--fps 15|24|30|60|0]'
    )
    process.exitCode = 1
    return
  }
  const controller = new AbortController()
  const cancel = (): void => controller.abort()
  process.once('SIGINT', cancel)
  process.once('SIGTERM', cancel)
  let previous = ''
  const onProgress = (event: ExportProgress): void => {
    const text = `${(event.progress * 100).toFixed(1).padStart(5)}%  ${event.message}`
    if (text === previous) return
    previous = text
    console.log(text)
  }
  try {
    const result = await runExport(
      resolve(input),
      resolve(output),
      params,
      onProgress,
      controller.signal
    )
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    const cancelled = error instanceof Error && error.name === 'AbortError'
    console.error(
      cancelled
        ? '已取消，临时文件已清理。'
        : error instanceof Error
          ? error.message
          : String(error)
    )
    process.exitCode = cancelled ? 130 : 1
  } finally {
    process.removeListener('SIGINT', cancel)
    process.removeListener('SIGTERM', cancel)
  }
}

void main()
