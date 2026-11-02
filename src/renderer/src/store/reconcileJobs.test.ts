import { expect, it } from 'vitest'
import { DEFAULT_PARAMS, type Job } from '../../../shared/types'
import { reconcileJobs } from './reconcileJobs'
it('reuses finished rows without masking progress/errors on changed rows', () => {
  const row: Job = {
    id: 'one',
    inputPath: '/a.mp4',
    outputPath: '/a.mov',
    params: DEFAULT_PARAMS,
    status: 'done',
    stage: 'verifying',
    progress: 100,
    startedAt: null,
    finishedAt: null
  }
  expect(reconcileJobs([row], [structuredClone(row)])[0]).toBe(row)
  const failed = {
    ...row,
    status: 'failed' as const,
    error: 'encoder crashed',
    stderrTail: ['error detail']
  }
  expect(reconcileJobs([row], [failed])[0]).toBe(failed)
})
