import type { Job } from '../../../shared/types'
// Params are immutable per job ID. Reuse unchanged rows across full IPC snapshots.
export function reconcileJobs(previous: Job[], next: Job[]): Job[] {
  const byId = new Map(previous.map((job) => [job.id, job]))
  return next.map((job) => {
    const old = byId.get(job.id)
    if (
      old &&
      old.status === job.status &&
      old.stage === job.stage &&
      old.progress === job.progress &&
      old.startedAt === job.startedAt &&
      old.finishedAt === job.finishedAt &&
      old.error === job.error &&
      old.inputPath === job.inputPath &&
      old.outputPath === job.outputPath &&
      old.thumbnail === job.thumbnail &&
      (old.stderrTail ?? []).join('\n') === (job.stderrTail ?? []).join('\n')
    )
      return old
    return job
  })
}
