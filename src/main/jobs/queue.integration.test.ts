import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PARAMS } from '../../shared/types'
import { detectTools } from '../ffmpeg/detectTools'
import { DiskSpaceBudget } from '../ffmpeg/diskSpace'
import { runExport } from '../ffmpeg/pipeline'
import { runFFmpeg, runProcess } from '../ffmpeg/run'
import { validateOutput } from '../ffmpeg/validateOutput'
import { JobQueue } from './queue'

// Real macOS ffmpeg + avconvert pipeline; no cloud service or codec mocks.
describe.skipIf(process.platform !== 'darwin')('job queue integration', () => {
  let directory: string
  let inputPath: string
  let ffmpeg: string
  let ffprobe: string
  const queues: JobQueue[] = []

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'macchromakey-jobs-integration-'))
    inputPath = join(directory, 'green screen.mp4')
    const tools = await detectTools()
    for (const tool of Object.values(tools.tools)) {
      if (!tool.available) throw new Error(`集成测试需要 ${tool.name}：${tool.error}`)
    }
    ffmpeg = tools.tools.ffmpeg.path!
    ffprobe = tools.tools.ffprobe.path!
    await runProcess(ffmpeg, [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=green:s=320x180:r=24:d=3,drawbox=x=80:y=30:w=100:h=100:color=red:t=fill',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      inputPath
    ])
  }, 30_000)

  afterEach(async () => {
    await Promise.all(queues.splice(0).map((queue) => queue.shutdown()))
  })
  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  it('normally completes, publishes final events, persists and preserves the completed job after restart', async () => {
    const onDone = vi.fn()
    const filePath = join(directory, 'normal', 'jobs.json')
    const queue = await JobQueue.open({ filePath, onDone })
    queues.push(queue)
    const events: string[] = []
    queue.subscribe((snapshot) => {
      for (const job of snapshot.jobs) events.push(job.status)
    })
    const job = await queue.add({
      inputPath,
      outputPath: join(directory, 'normal', 'output.mov'),
      params: DEFAULT_PARAMS
    })
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1), { timeout: 25_000 })
    expect(queue.get(job.id)).toMatchObject({ status: 'done', stage: 'verifying', progress: 100 })
    expect(queue.get(job.id).startedAt).not.toBeNull()
    expect(queue.get(job.id).finishedAt).not.toBeNull()
    expect(await validateOutput(job.outputPath, { ffprobePath: ffprobe })).toMatchObject({
      codecName: 'hevc',
      alphaLayerId: 1
    })
    await vi.waitFor(() => expect(events).toContain('done'))
    expect(JSON.parse(await readFile(filePath, 'utf8'))[0].status).toBe('done')
    await queue.shutdown()
    const reopened = await JobQueue.open({ filePath })
    queues.push(reopened)
    expect(reopened.get(job.id)).toEqual(queue.get(job.id))
  }, 30_000)

  it('cancels during real ffmpeg progress, waits for process cleanup and keeps an existing output', async () => {
    const before = new Set(
      (await readdir(tmpdir())).filter((name) => name.startsWith('macchromakey-export-'))
    )
    const outputPath = join(directory, 'cancel.mov')
    await writeFile(outputPath, 'existing output')
    const onDone = vi.fn()
    let id = ''
    let cancellation: Promise<unknown> | undefined
    const queue = await JobQueue.open({
      filePath: join(directory, 'cancel-jobs.json'),
      onDone,
      run: (input, output, params, progress, signal) =>
        runExport(
          input,
          output,
          params,
          (event) => {
            progress?.(event)
            if (event.stage === 'keying' && event.progress > 0 && !cancellation)
              cancellation = queue.cancel(id)
          },
          signal
        )
    })
    queues.push(queue)
    id = (await queue.add({ inputPath, outputPath, params: DEFAULT_PARAMS })).id
    await vi.waitFor(() => expect(cancellation).toBeDefined(), { timeout: 25_000 })
    await cancellation
    expect(queue.get(id).status).toBe('canceled')
    expect(queue.get(id).finishedAt).not.toBeNull()
    expect(onDone).not.toHaveBeenCalled()
    expect(await readFile(outputPath, 'utf8')).toBe('existing output')
    expect(
      (await readdir(tmpdir())).filter(
        (name) => name.startsWith('macchromakey-export-') && !before.has(name)
      )
    ).toEqual([])
    expect(JSON.parse(await readFile(join(directory, 'cancel-jobs.json'), 'utf8'))[0].status).toBe(
      'canceled'
    )
  }, 30_000)

  it('exports a smaller even frame at capped fps while preserving the actual Apple Alpha layer', async () => {
    const input = join(directory, 'large.mp4')
    await runProcess(ffmpeg, [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=green:s=960x540:r=30:d=1,drawbox=x=80:y=30:w=100:h=100:color=red:t=fill',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      input
    ])
    const result = await runExport(input, join(directory, 'compact.mov'), {
      ...DEFAULT_PARAMS,
      exportMaxEdge: 720,
      exportFps: 15
    })
    expect(result).toMatchObject({ width: 720, height: 404, codecName: 'hevc', alphaLayerId: 1 })
    expect(result.fps).toBeCloseTo(15, 1)
    expect(result.duration).toBeCloseTo(1, 1)
  }, 30_000)

  it('records a real ffmpeg nonzero exit and stderr as failed, without a completion notification', async () => {
    const onDone = vi.fn()
    const queue = await JobQueue.open({
      filePath: join(directory, 'failed-jobs.json'),
      onDone,
      run: async (_input, output, _params, progress, signal) => {
        progress?.({ stage: 'keying', progress: 0, message: '测试 ffmpeg 失败' })
        await runFFmpeg(ffmpeg, ['-nostdin', '-definitely-invalid-ffmpeg-option', output], {
          duration: 3,
          signal
        })
        throw new Error('无效 ffmpeg 参数意外成功')
      }
    })
    queues.push(queue)
    const job = await queue.add({
      inputPath,
      outputPath: join(directory, 'failed.mov'),
      params: DEFAULT_PARAMS
    })
    await vi.waitFor(() => expect(queue.get(job.id).status).toBe('failed'), { timeout: 10_000 })
    expect(queue.get(job.id).error).toContain('Unrecognized option')
    expect(queue.get(job.id).stderrTail?.join('\n')).toContain('Unrecognized option')
    await vi.waitFor(async () =>
      expect(
        JSON.parse(await readFile(join(directory, 'failed-jobs.json'), 'utf8'))[0].status
      ).toBe('failed')
    )
    expect(queue.get(job.id).finishedAt).not.toBeNull()
    expect(onDone).not.toHaveBeenCalled()
    await expect(readFile(job.outputPath)).rejects.toMatchObject({ code: 'ENOENT' })
  }, 15_000)
  it('reports moved inputs and insufficient disk before starting an encoder', async () => {
    const stages: string[] = []
    const budget = new DiskSpaceBudget(async () => ({ id: 'full-disk', available: 0 }))
    const queue = await JobQueue.open({
      filePath: join(directory, 'preflight-jobs.json'),
      run: (input, output, params, progress, signal) =>
        runExport(
          input,
          output,
          params,
          (event) => {
            stages.push(event.stage)
            progress?.(event)
          },
          signal,
          { diskBudget: budget, tempDirectory: directory }
        )
    })
    queues.push(queue)
    const noSpace = await queue.add({
      inputPath,
      outputPath: join(directory, 'no-space.mov'),
      params: DEFAULT_PARAMS
    })
    await vi.waitFor(() => expect(queue.get(noSpace.id).status).toBe('failed'), { timeout: 10000 })
    expect(queue.get(noSpace.id).error).toContain('磁盘空间不足')
    expect(queue.get(noSpace.id).error).toContain('预估需要')
    expect(stages).not.toContain('keying')
    const moved = await queue.add({
      inputPath: join(directory, 'moved.mp4'),
      outputPath: join(directory, 'moved.mov'),
      params: DEFAULT_PARAMS
    })
    await vi.waitFor(() => expect(queue.get(moved.id).status).toBe('failed'))
    expect(queue.get(moved.id).error).toContain('输入文件已移动或删除')
    expect(
      (await readdir(directory)).filter((name) => name.startsWith('macchromakey-export-'))
    ).toEqual([])
  }, 15000)
})
