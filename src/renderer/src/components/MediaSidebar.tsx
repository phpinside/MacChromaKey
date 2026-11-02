import { memo, useEffect, useState } from 'react'
import type { Job } from '../../../shared/types'
import { useEditorStore } from '../store/editorStore'
import { useJobsStore } from '../store/jobsStore'
import { formatTime } from '../editor/geometry'

const statusName = {
  queued: '排队中',
  running: '处理中',
  done: '已完成',
  failed: '失败',
  canceled: '已取消'
}
const stageName = { keying: '抠像中', 'apple-transcode': 'Apple 转码中', verifying: '校验中' }
function elapsed(job: Job, now: number): string {
  if (!job.startedAt) return '等待开始'
  const seconds = Math.max(
    0,
    Math.floor(
      ((job.finishedAt ? Date.parse(job.finishedAt) : now) - Date.parse(job.startedAt)) / 1000
    )
  )
  if (seconds < 60) return `${seconds} 秒`
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}
function Thumbnail({ src, name }: { src?: string; name: string }): React.JSX.Element {
  return src ? (
    <img className="media-thumbnail" src={src} alt={`${name} 缩略图`} loading="lazy" />
  ) : (
    <span className="media-thumbnail thumbnail-placeholder" aria-hidden="true">
      ▧
    </span>
  )
}
const JobCard = memo(function JobCard({ job, now }: { job: Job; now: number }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const editing = useEditorStore((s) => s.loading)
  const name = job.inputPath.split('/').pop()!
  const active = job.status === 'running' || job.status === 'queued'
  const act = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (error) {
      setError(String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <article
      className={`job-card job-${job.status}`}
      data-job-id={job.id}
      aria-label={`任务 ${name}`}
    >
      <div className="flex min-w-0 gap-2">
        <Thumbnail src={job.thumbnail} name={name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] text-zinc-700" title={job.inputPath}>
            {name}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="job-stage">
              {job.status === 'running' ? stageName[job.stage] : statusName[job.status]}
            </span>
            <span className="font-mono text-[9px] text-zinc-600">{job.progress.toFixed(0)}%</span>
          </div>
        </div>
      </div>
      <progress
        className="job-progress"
        max={100}
        value={job.progress}
        aria-label={`${name} 处理进度`}
      />
      <div className="flex justify-between text-[9px] text-zinc-600">
        <span>耗时 {elapsed(job, now)}</span>
        <span>{statusName[job.status]}</span>
      </div>
      <p className="mt-2 truncate text-[9px] text-zinc-500" title={job.outputPath}>
        → {job.outputPath.split('/').pop()}
      </p>
      <div className="job-actions">
        {active && (
          <button disabled={busy} onClick={() => void act(() => window.api.jobs.cancel(job.id))}>
            取消
          </button>
        )}
        {['failed', 'canceled'].includes(job.status) && (
          <button disabled={busy} onClick={() => void act(() => window.api.jobs.retry(job.id))}>
            重试
          </button>
        )}
        {job.status === 'done' && (
          <button
            disabled={busy}
            onClick={() => void act(() => window.api.jobs.showOutput(job.id))}
          >
            在 Finder 中显示
          </button>
        )}
        <button
          disabled={busy || editing}
          onClick={() => void act(() => useEditorStore.getState().editJob(job.id))}
        >
          重新编辑
        </button>
        <button
          disabled={busy || job.status === 'running'}
          onClick={() => void act(() => window.api.jobs.remove(job.id))}
        >
          删除
        </button>
      </div>
      {job.status === 'failed' && (
        <details className="job-log">
          <summary title={job.error}>失败详情：{job.error?.split('\n')[0] ?? '未知错误'}</summary>
          <pre>
            {job.stderrTail?.length ? job.stderrTail.join('\n') : (job.error ?? '无可用日志')}
          </pre>
          <button
            className="quiet-button"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await window.api.jobs.copyLog(job.id)
                setCopied(true)
              })
            }
          >
            {copied ? '已复制日志' : '复制日志'}
          </button>
        </details>
      )}
      {error && (
        <p className="panel-error" role="alert">
          {error}
        </p>
      )}
    </article>
  )
})

export function MediaSidebar(): React.JSX.Element {
  const files = useEditorStore((s) => s.files)
  const current = useEditorStore((s) => s.currentFile)
  const select = useEditorStore((s) => s.selectFile)
  const importVideo = useEditorStore((s) => s.importVideo)
  const loading = useEditorStore((s) => s.loading)
  const snapshot = useJobsStore((s) => s.snapshot)
  const jobsError = useJobsStore((s) => s.error)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now)
  const running = snapshot?.jobs.some((job) => job.status === 'running') ?? false
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  return (
    <aside className="media-sidebar" aria-label="文件与任务列表">
      <div className="side-heading">
        <span>
          素材{' '}
          <span className="ml-1 text-zinc-500">{files.length.toString().padStart(2, '0')}</span>
        </span>
        <button
          aria-label="导入视频"
          title="导入视频"
          className="text-[10px] text-zinc-600 hover:text-emerald-700"
          onClick={() => void importVideo()}
          disabled={loading}
        >
          ＋ 导入视频
        </button>
      </div>
      <div className="media-list">
        {files.length ? (
          files.map(({ file, info }) => (
            <button
              key={file.path}
              onClick={() => select(file.path)}
              className={`media-item ${current?.path === file.path ? 'is-selected' : ''}`}
              aria-pressed={current?.path === file.path}
            >
              <Thumbnail src={file.thumbnail} name={file.name} />
              <span className="min-w-0">
                <span className="block truncate text-[11px] text-zinc-700" title={file.name}>
                  {file.name}
                </span>
                <span className="mt-1.5 block font-mono text-[9px] text-zinc-500">
                  {info.width}×{info.height} · {formatTime(info.duration)}
                </span>
              </span>
            </button>
          ))
        ) : (
          <p className="px-2 py-5 text-[11px] leading-6 text-zinc-500">
            导入本地视频后，素材会显示在这里。
          </p>
        )}
      </div>
      <div className="side-heading border-t border-zinc-200">
        <span>任务 · {snapshot?.jobs.length ?? 0}</span>
        <button
          className="quiet-button"
          disabled={
            !snapshot?.jobs.some((job) => ['done', 'failed', 'canceled'].includes(job.status))
          }
          onClick={() => {
            setError(null)
            void window.api.jobs.clearFinished().catch((error) => setError(String(error)))
          }}
        >
          清除已结束
        </button>
      </div>
      <div className="job-list">
        {(jobsError || error) && (
          <p role="alert" className="panel-error">
            {jobsError || error}
          </p>
        )}
        {snapshot?.jobs.length ? (
          snapshot.jobs.map((job) => (
            <JobCard key={job.id} job={job} now={job.status === 'running' ? now : 0} />
          ))
        ) : (
          <p className="px-2 text-[11px] leading-6 text-zinc-500">暂无处理任务</p>
        )}
      </div>
      <p className="border-t border-zinc-200 px-4 py-3 text-[10px] text-zinc-500">
        本地处理 · 支持 MP4 / MOV / MKV
      </p>
    </aside>
  )
}
