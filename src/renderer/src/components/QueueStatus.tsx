import { useJobsStore } from '../store/jobsStore'
export function QueueStatus(): React.JSX.Element {
  const snapshot = useJobsStore((s) => s.snapshot)
  const running = snapshot?.jobs.filter((job) => job.status === 'running').length ?? 0
  const queued = snapshot?.jobs.filter((job) => job.status === 'queued').length ?? 0
  return (
    <span className="queue-status" role="status" data-testid="queue-status">
      <span className={`status-dot ${running ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
      运行中 {running} / 排队 {queued}
    </span>
  )
}
