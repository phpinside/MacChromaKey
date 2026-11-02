import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PARAMS, type ExportProgress, type Job } from '../../shared/types'
import type { ExportResult, runExport } from '../ffmpeg/pipeline'
import { JobQueue } from './queue'

const directories: string[] = []
const queues: JobQueue[] = []
const result: ExportResult = {
  outputPath: '/tmp/output.mov',
  width: 160,
  height: 120,
  duration: 2,
  fps: 24,
  hasAudio: false,
  codecName: 'hevc',
  pixelFormat: 'yuv420p',
  alphaLayerId: 1
}

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'macchromakey-queue-test-'))
  directories.push(directory)
  return directory
}

function controlled(): {
  run: typeof runExport
  active: { finish: () => void; progress: (event: ExportProgress) => void }[]
} {
  const active: { finish: () => void; progress: (event: ExportProgress) => void }[] = []
  const run: typeof runExport = (_input, output, _params, onProgress, signal) =>
    new Promise((resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('已取消', 'AbortError')), {
        once: true
      })
      if (signal?.aborted) {
        reject(new DOMException('已取消', 'AbortError'))
        return
      }
      active.push({
        finish: () => resolve({ ...result, outputPath: output }),
        progress: onProgress ?? (() => {})
      })
    })
  return { run, active }
}

async function open(directory: string, run?: typeof runExport): Promise<JobQueue> {
  const queue = await JobQueue.open({ filePath: join(directory, 'jobs.json'), run })
  queues.push(queue)
  return queue
}

const request = (
  directory: string,
  name = 'output'
): { inputPath: string; outputPath: string; params: typeof DEFAULT_PARAMS } => ({
  inputPath: join(directory, 'input.mp4'),
  outputPath: join(directory, `${name}.mov`),
  params: DEFAULT_PARAMS
})

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(queues.splice(0).map((queue) => queue.shutdown()))
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('persistent job queue', () => {
  it('serializes work, cancels queued/running jobs, retries and clears terminal rows', async () => {
    const directory = await fixture()
    const runner = controlled()
    const queue = await open(directory, runner.run)
    const first = await queue.add(request(directory, 'first'))
    const second = await queue.add(request(directory, 'second'))
    await vi.waitFor(() => expect(runner.active).toHaveLength(1))
    expect(queue.get(second.id).status).toBe('queued')
    await expect(queue.remove(first.id)).rejects.toThrow('取消')
    expect((await queue.cancel(second.id)).status).toBe('canceled')
    await queue.retry(second.id)
    expect(queue.get(second.id).startedAt).toBeNull()
    runner.active[0].finish()
    await vi.waitFor(() => expect(runner.active).toHaveLength(2))
    expect(queue.get(first.id).status).toBe('done')
    expect((await queue.cancel(second.id)).status).toBe('canceled')
    expect(queue.get(second.id).finishedAt).not.toBeNull()
    await queue.remove(second.id)
    await queue.clearFinished()
    expect(queue.snapshot().jobs).toEqual([])
    expect(JSON.parse(await readFile(join(directory, 'jobs.json'), 'utf8'))).toEqual([])
  })

  it('honors configured concurrency and rejects invalid limits', async () => {
    const directory = await fixture()
    const runner = controlled()
    const queue = await open(directory, runner.run)
    await queue.setConcurrency(2)
    await queue.add(request(directory, 'one'))
    await queue.add(request(directory, 'two'))
    const third = await queue.add(request(directory, 'three'))
    await vi.waitFor(() => expect(runner.active).toHaveLength(2))
    expect(queue.get(third.id).status).toBe('queued')
    await queue.setConcurrency(1)
    await expect(queue.setConcurrency(0)).rejects.toThrow('正整数')
    runner.active[0].finish()
    await vi.waitFor(() => expect(queue.snapshot().jobs[0].status).toBe('done'))
    expect(runner.active).toHaveLength(2)
    runner.active[1].finish()
    await vi.waitFor(() => expect(runner.active).toHaveLength(3))
    runner.active[2].finish()
  })

  it('marks both queued and running rows interrupted while preserving completed jobs', async () => {
    const directory = await fixture()
    const base: Job = {
      ...request(directory),
      id: 'done',
      status: 'done',
      stage: 'verifying',
      progress: 100,
      startedAt: '2026-11-02T00:00:00.000Z',
      finishedAt: '2026-11-02T00:00:01.000Z'
    }
    await writeFile(
      join(directory, 'jobs.json'),
      JSON.stringify([
        base,
        { ...base, id: 'running', status: 'running', progress: 50, finishedAt: null },
        { ...base, id: 'queued', status: 'queued', progress: 0, startedAt: null, finishedAt: null }
      ])
    )
    const queue = await open(directory)
    expect(queue.get('done')).toEqual(base)
    for (const id of ['queued', 'running']) {
      expect(queue.get(id)).toMatchObject({ status: 'failed', error: '应用中断' })
      expect(queue.get(id).finishedAt).not.toBeNull()
    }
    expect(JSON.parse(await readFile(join(directory, 'jobs.json'), 'utf8'))).toEqual(
      queue.snapshot().jobs
    )
  })

  it('keeps interrupted work recoverable when shutting down', async () => {
    const directory = await fixture()
    const runner = controlled()
    const queue = await open(directory, runner.run)
    const job = await queue.add(request(directory))
    await vi.waitFor(() => expect(runner.active).toHaveLength(1))
    await queue.shutdown()
    const reopened = await open(directory)
    expect(reopened.get(job.id)).toMatchObject({ status: 'failed', error: '应用中断' })
  })

  it('coalesces progress and final state to one notification per 200 ms', async () => {
    const directory = await fixture()
    const runner = controlled()
    const queue = await open(directory, runner.run)
    vi.useFakeTimers()
    const events = vi.fn()
    const unsubscribe = queue.subscribe(events)
    const job = await queue.add(request(directory))
    await vi.waitFor(() => expect(runner.active).toHaveLength(1))
    events.mockClear()
    await vi.advanceTimersByTimeAsync(200)
    events.mockClear()
    for (let i = 0; i < 50; i++)
      runner.active[0].progress({ stage: 'keying', progress: i / 100, message: '' })
    await vi.advanceTimersByTimeAsync(199)
    expect(events).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(events).toHaveBeenCalledTimes(1)
    expect(events.mock.calls[0][0].jobs[0].progress).toBe(49)
    runner.active[0].finish()
    await vi.waitFor(() => expect(queue.get(job.id).status).toBe('done'))
    await vi.advanceTimersByTimeAsync(200)
    expect(events.mock.calls.at(-1)![0].jobs[0]).toMatchObject({ status: 'done', progress: 100 })
    unsubscribe()
  })

  it('does not overwrite malformed history or accept invalid IPC payloads', async () => {
    const directory = await fixture()
    const filePath = join(directory, 'corrupt.json')
    await writeFile(filePath, '{invalid')
    await expect(JobQueue.open({ filePath })).rejects.toThrow()
    expect(await readFile(filePath, 'utf8')).toBe('{invalid')
    const queue = await open(directory)
    await expect(
      queue.add({
        ...request(directory),
        params: { ...DEFAULT_PARAMS, keepAudio: 'false' }
      } as never)
    ).rejects.toThrow('参数')
    expect(queue.snapshot().jobs).toEqual([])
  })
})

it('rejects concurrent writers to the same output, including retrying an old record', async () => {
  const directory = await fixture(),
    runner = controlled(),
    queue = await open(directory, runner.run)
  const first = await queue.add(request(directory))
  await expect(queue.add(request(directory))).rejects.toThrow('未完成任务')
  await queue.cancel(first.id)
  await queue.add(request(directory))
  await expect(queue.retry(first.id)).rejects.toThrow('未完成任务')
})
