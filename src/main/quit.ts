interface QuitOptions {
  unfinished: () => { running: number; queued: number }
  confirm: (counts: { running: number; queued: number }) => Promise<boolean>
  shutdown: () => Promise<void>
  quit: () => void
}

// Repeated Cmd-Q shares one confirmation. Continue leaves the queue entirely untouched.
export function createQuitHandler(
  options: QuitOptions
): (event: { preventDefault: () => void }) => void {
  let complete = false
  let pending = false
  return (event) => {
    if (complete) return
    event.preventDefault()
    if (pending) return
    pending = true
    void (async () => {
      try {
        const counts = options.unfinished()
        if ((counts.running || counts.queued) && !(await options.confirm(counts))) return
        try {
          await options.shutdown()
        } catch (error) {
          console.error('清理或保存退出状态失败，保留上次有效任务记录', error)
        }
        complete = true
        options.quit()
      } catch (error) {
        console.error('退出应用失败', error)
      } finally {
        pending = false
      }
    })()
  }
}
