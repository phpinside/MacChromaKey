import { create } from 'zustand'
import { reconcileJobs } from './reconcileJobs'
import type { JobQueueSnapshot } from '../../../shared/types'

interface JobsState {
  snapshot: JobQueueSnapshot | null
  error: string | null
}

export const useJobsStore = create<JobsState>(() => ({ snapshot: null, error: null }))

export function subscribeJobs(): () => void {
  if (!window.api?.jobs) return () => {}
  let disposed = false
  const accept = (snapshot: JobQueueSnapshot): void => {
    const previous = useJobsStore.getState().snapshot
    if (!disposed && (!previous || snapshot.revision >= previous.revision)) {
      useJobsStore.setState({
        snapshot: { ...snapshot, jobs: reconcileJobs(previous?.jobs ?? [], snapshot.jobs) },
        error: snapshot.persistenceError ?? null
      })
    }
  }
  // Subscribe first to avoid losing a change while the initial list request is in flight.
  const unsubscribe = window.api.jobs.onChanged(accept)
  void window.api.jobs
    .list()
    .then(accept)
    .catch((error) => {
      if (!disposed) useJobsStore.setState({ error: String(error) })
    })
  return () => {
    disposed = true
    unsubscribe()
  }
}
