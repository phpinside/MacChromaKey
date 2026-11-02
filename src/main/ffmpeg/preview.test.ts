import { expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type PreviewFrameRequest } from '../../shared/types'
import { FramePreview } from './preview'
const request = (id: string): PreviewFrameRequest => ({
  id,
  url: 'localfile://media/test',
  time: 0,
  params: DEFAULT_PARAMS,
  mode: 'keyed'
})

it('waits for canceled preview exit, skips superseded requests and never runs more than one renderer', async () => {
  const starts: string[] = []
  let exit!: () => void
  const render = vi.fn(async (_path: string, req: PreviewFrameRequest, signal: AbortSignal) => {
    starts.push(req.id)
    if (req.id === 'first') {
      await new Promise<void>((resolve) => {
        exit = resolve
      })
      expect(signal.aborted).toBe(true)
    }
    return 'png:' + req.id
  })
  const preview = new FramePreview(render)
  const first = preview.frame('/input.mp4', request('first'))
  await vi.waitFor(() => expect(starts).toEqual(['first']))
  const second = preview.frame('/input.mp4', request('second'))
  const last = preview.frame('/input.mp4', request('last'))
  expect(starts).toEqual(['first'])
  exit()
  expect(await first).toEqual({ id: 'first', dataUrl: null })
  expect(await second).toEqual({ id: 'second', dataUrl: null })
  expect(await last).toEqual({ id: 'last', dataUrl: 'png:last' })
  expect(starts).toEqual(['first', 'last'])
})

it('ignores stale cancellation IDs and cancels only the matching active request', async () => {
  const preview = new FramePreview(async (_path, _request, signal) => {
    await new Promise<void>((resolve) =>
      signal.addEventListener('abort', () => resolve(), { once: true })
    )
    return 'unused'
  })
  const pending = preview.frame('/in.mp4', request('one'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  await preview.cancel('stale')
  await preview.cancel('one')
  expect((await pending).dataUrl).toBeNull()
})

it('rejects invalid mode, filter injection, alpha bounds and propagates rendering errors', async () => {
  const preview = new FramePreview(async () => {
    throw new Error('ffmpeg failed')
  })
  expect(() =>
    preview.frame('/in.mp4', { ...request('bad'), mode: 'original' as 'keyed' })
  ).toThrow('模式')
  expect(() =>
    preview.frame('/in.mp4', {
      ...request('bad'),
      params: { ...DEFAULT_PARAMS, keyColor: '0x00FF00,null' }
    })
  ).toThrow()
  expect(() =>
    preview.frame('/in.mp4', {
      ...request('bad'),
      params: { ...DEFAULT_PARAMS, alphaLow: 200, alphaHigh: 100 }
    })
  ).toThrow('alphaHigh')
  await expect(preview.frame('/in.mp4', request('fail'))).rejects.toThrow('ffmpeg failed')
})
