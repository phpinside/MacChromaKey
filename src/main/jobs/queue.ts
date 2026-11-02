import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AddJobRequest, ExportProgress, Job, JobQueueSnapshot } from '../../shared/types'
import { ProcessError } from '../ffmpeg/run'
import { runExport } from '../ffmpeg/pipeline'
import { parseAddJob, parseSavedJobs } from './validation'

export interface JobQueueOptions {
  filePath: string
  concurrency?: number
  run?: typeof runExport
  onDone?: (job: Job) => void
  getThumbnail?: (input: string) => Promise<string | undefined>
}

const finished = (job: Job): boolean => ['done', 'failed', 'canceled'].includes(job.status)

export class JobQueue {
  private jobs: Job[] = []
  private concurrency: number
  private revision = 0
  private persistenceError?: string
  private running = new Map<string, { controller: AbortController; completion: Promise<void> }>()
  private listeners = new Set<(snapshot: JobQueueSnapshot) => void>()
  private eventTimer?: ReturnType<typeof setTimeout>
  private saveTimer?: ReturnType<typeof setTimeout>
  private writing: Promise<void> = Promise.resolve()
  private mutations: Promise<unknown> = Promise.resolve()
  private stopping = false
  private shutdownPromise?: Promise<void>

  private constructor(private options: JobQueueOptions) {
    this.concurrency = options.concurrency ?? 1
    this.validateConcurrency(this.concurrency)
  }

  static async open(options: JobQueueOptions): Promise<JobQueue> {
    const queue = new JobQueue(options)
    try {
      queue.jobs = parseSavedJobs(JSON.parse(await readFile(options.filePath, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const now = new Date().toISOString()
    for (const job of queue.jobs) {
      if (!finished(job)) {
        job.status = 'failed'
        job.error = '应用中断'
        job.finishedAt = now
      }
    }
    // Persist recovery before any caller can retry jobs or subscribe.
    await queue.persist()
    return queue
  }

  snapshot(): JobQueueSnapshot {
    return {
      jobs: structuredClone(this.jobs),
      concurrency: this.concurrency,
      revision: this.revision,
      ...(this.persistenceError && { persistenceError: this.persistenceError })
    }
  }

  get(id: string): Job {
    return structuredClone(this.require(id))
  }

  subscribe(listener: (snapshot: JobQueueSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  add(request: AddJobRequest): Promise<Job> {
    return this.mutate(async () => {
      const input = parseAddJob(request)
      this.assertOutputFree(input.outputPath)
      const job: Job = {
        ...input,
        id: randomUUID(),
        status: 'queued',
        stage: 'keying',
        progress: 0,
        startedAt: null,
        finishedAt: null
      }
      const thumbnail = await this.options.getThumbnail?.(input.inputPath).catch(() => undefined)
      if (thumbnail) job.thumbnail = thumbnail
      this.jobs.push(job)
      this.changed()
      await this.persist()
      this.pump()
      return this.get(job.id)
    })
  }

  cancel(id: string): Promise<Job> {
    return this.mutate(async () => {
      const job = this.require(id)
      if (job.status === 'queued') {
        job.status = 'canceled'
        job.finishedAt = new Date().toISOString()
        this.changed()
        await this.persist()
      } else if (job.status === 'running') {
        const active = this.running.get(id)!
        active.controller.abort()
        // Do not release concurrency, allow retry, or remove the row before the writer stops.
        await active.completion
      }
      return this.get(id)
    })
  }

  retry(id: string): Promise<Job> {
    return this.mutate(async () => {
      const job = this.require(id)
      if (!['failed', 'canceled'].includes(job.status)) throw new Error('只能重试失败或取消的任务')
      if (this.running.has(id)) throw new Error('任务尚未退出')
      this.assertOutputFree(job.outputPath)
      job.status = 'queued'
      job.stage = 'keying'
      job.progress = 0
      job.startedAt = null
      job.finishedAt = null
      delete job.error
      delete job.stderrTail
      this.jobs = [...this.jobs.filter((item) => item.id !== id), job]
      this.changed()
      await this.persist()
      this.pump()
      return this.get(id)
    })
  }

  remove(id: string): Promise<void> {
    return this.mutate(async () => {
      const job = this.require(id)
      if (job.status === 'running' || this.running.has(id)) throw new Error('请先取消运行中的任务')
      this.jobs = this.jobs.filter((item) => item.id !== id)
      this.changed()
      await this.persist()
    })
  }

  clearFinished(): Promise<void> {
    return this.mutate(async () => {
      this.jobs = this.jobs.filter((job) => !finished(job) || this.running.has(job.id))
      this.changed()
      await this.persist()
    })
  }

  setConcurrency(concurrency: number): Promise<void> {
    return this.mutate(async () => {
      this.validateConcurrency(concurrency)
      this.concurrency = concurrency
      this.changed()
      await this.persist()
      this.pump()
    })
  }

  shutdown(): Promise<void> {
    return (this.shutdownPromise ??= this.performShutdown())
  }

  private async performShutdown(): Promise<void> {
    this.stopping = true
    for (const active of this.running.values()) active.controller.abort()
    await this.mutations.catch(() => {})
    await Promise.all([...this.running.values()].map((active) => active.completion))
    clearTimeout(this.eventTimer)
    clearTimeout(this.saveTimer)
    this.eventTimer = undefined
    this.saveTimer = undefined
    await this.persist()
    this.listeners.clear()
  }

  private assertOutputFree(output: string): void {
    if (
      this.jobs.some(
        (job) =>
          ['queued', 'running'].includes(job.status) &&
          job.outputPath.toLowerCase() === output.toLowerCase()
      )
    )
      throw new Error('此输出路径已有未完成任务，请选择其他文件名')
  }
  private require(id: string): Job {
    if (typeof id !== 'string') throw new Error('任务 ID 无效')
    const job = this.jobs.find((item) => item.id === id)
    if (!job) throw new Error('任务不存在')
    return job
  }

  private validateConcurrency(value: number): void {
    if (!Number.isInteger(value) || value < 1) throw new Error('任务并发数必须为正整数')
  }

  private mutate<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.mutations.then(() => {
      if (this.stopping) throw new Error('任务队列正在关闭')
      return action()
    })
    this.mutations = operation.catch(() => {})
    return operation
  }

  private changed(saveProgress = false): void {
    this.revision++
    if (this.stopping) return
    // Trailing snapshots coalesce all changes, including a final state, within 200 ms.
    this.eventTimer ??= setTimeout(() => {
      this.eventTimer = undefined
      const snapshot = this.snapshot()
      for (const listener of this.listeners) {
        try {
          listener(snapshot)
        } catch (error) {
          console.error('任务状态订阅失败', error)
        }
      }
    }, 200)
    if (saveProgress) {
      this.saveTimer ??= setTimeout(() => {
        this.saveTimer = undefined
        void this.persist().catch(() => {})
      }, 2000)
    }
  }

  private persist(): Promise<void> {
    clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    const contents = JSON.stringify(this.jobs, null, 2) + '\n'
    const write = this.writing
      .catch(() => {})
      .then(async () => {
        const temporary = `${this.options.filePath}.${randomUUID()}.tmp`
        try {
          await mkdir(dirname(this.options.filePath), { recursive: true })
          await writeFile(temporary, contents, { encoding: 'utf8', mode: 0o600 })
          await rename(temporary, this.options.filePath)
          if (this.persistenceError) {
            this.persistenceError = undefined
            this.changed()
          }
        } catch (error) {
          this.persistenceError = `任务保存失败：${error instanceof Error ? error.message : String(error)}`
          this.changed()
          throw error
        } finally {
          await rm(temporary, { force: true })
        }
      })
    this.writing = write
    return write
  }

  private pump(): void {
    if (this.stopping || this.persistenceError) return
    while (this.running.size < this.concurrency) {
      const job = this.jobs.find((item) => item.status === 'queued')
      if (!job) break
      job.status = 'running'
      job.startedAt = new Date().toISOString()
      const controller = new AbortController()
      this.changed()
      const completion = this.execute(job, controller)
      this.running.set(job.id, { controller, completion })
    }
  }

  private progress(job: Job, event: ExportProgress): void {
    if (
      this.stopping ||
      job.status !== 'running' ||
      this.running.get(job.id)?.controller.signal.aborted
    )
      return
    job.stage =
      event.stage === 'converting'
        ? 'apple-transcode'
        : ['validating', 'done'].includes(event.stage)
          ? 'verifying'
          : 'keying'
    const progress = Number.isFinite(event.progress) ? event.progress * 100 : job.progress
    job.progress = Math.min(99, Math.max(job.progress, progress))
    this.changed(true)
  }

  private async execute(job: Job, controller: AbortController): Promise<void> {
    let succeeded = false
    try {
      // Running state must reach disk before starting an external writer.
      await this.persist()
      if (controller.signal.aborted) throw new DOMException('任务已取消', 'AbortError')
      await (this.options.run ?? runExport)(
        job.inputPath,
        job.outputPath,
        structuredClone(job.params),
        (event) => this.progress(job, event),
        controller.signal
      )
      // If cancellation races with publication, a successfully published output wins.
      job.status = 'done'
      job.stage = 'verifying'
      job.progress = 100
      succeeded = true
    } catch (error) {
      if (!this.stopping) {
        job.status = controller.signal.aborted ? 'canceled' : 'failed'
        if (job.status === 'failed') {
          job.error = error instanceof Error ? error.message : String(error)
          if (error instanceof ProcessError) job.stderrTail = [...error.stderrLines]
        }
      }
    } finally {
      if (!this.stopping || succeeded) job.finishedAt = new Date().toISOString()
      this.changed()
      try {
        await this.persist()
      } catch (error) {
        console.error('任务持久化失败', error)
      }
      if (succeeded) {
        try {
          this.options.onDone?.(structuredClone(job))
        } catch (error) {
          console.error('任务通知失败', error)
        }
      }
      this.running.delete(job.id)
      this.pump()
    }
  }
}
