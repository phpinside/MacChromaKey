import { expect, it, vi } from 'vitest'
import { createQuitHandler } from './quit'
it('continues processing when confirmation is canceled, then waits for shutdown before quitting', async () => {
  let response = false
  const confirm = vi.fn(async () => response)
  const shutdown = vi.fn(async () => {})
  const quit = vi.fn()
  const handler = createQuitHandler({
    unfinished: () => ({ running: 1, queued: 2 }),
    confirm,
    shutdown,
    quit
  })
  const event = { preventDefault: vi.fn() }
  handler(event)
  await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
  expect(shutdown).not.toHaveBeenCalled()
  response = true
  handler(event)
  await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1))
  expect(shutdown).toHaveBeenCalledTimes(1)
  const finalEvent = { preventDefault: vi.fn() }
  handler(finalEvent)
  expect(finalEvent.preventDefault).not.toHaveBeenCalled()
})
it('coalesces repeated quit requests and skips confirmation for an idle queue', async () => {
  let finish!: () => void
  const shutdown = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  const confirm = vi.fn()
  const quit = vi.fn()
  const handler = createQuitHandler({
    unfinished: () => ({ running: 0, queued: 0 }),
    confirm,
    shutdown,
    quit
  })
  handler({ preventDefault: vi.fn() })
  handler({ preventDefault: vi.fn() })
  expect(confirm).not.toHaveBeenCalled()
  expect(shutdown).toHaveBeenCalledTimes(1)
  expect(quit).not.toHaveBeenCalled()
  finish()
  await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1))
})

it('still quits after cleanup settles if the final state cannot be persisted on a full disk', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const quit = vi.fn()
    const handler = createQuitHandler({
      unfinished: () => ({ running: 0, queued: 0 }),
      confirm: vi.fn(),
      shutdown: async () => {
        throw new Error('ENOSPC')
      },
      quit
    })
    handler({ preventDefault: vi.fn() })
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1))
    expect(log).toHaveBeenCalled()
  } finally {
    log.mockRestore()
  }
})
