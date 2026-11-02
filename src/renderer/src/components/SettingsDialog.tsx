import { useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '../store/settingsStore'

export function SettingsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)!
  const [draft, setDraft] = useState(settings)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = dialog.current!
    node.showModal()
    return () => node.close()
  }, [])
  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      useSettingsStore.setState({ settings: await window.api.settings.save(draft), error: null })
      onClose()
    } catch (error) {
      setError(String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      aria-labelledby="settings-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 pb-4">
          <h2 id="settings-title" className="text-sm font-semibold">
            设置
          </h2>
          <button
            type="button"
            className="quiet-button"
            aria-label="关闭设置"
            disabled={busy}
            onClick={onClose}
          >
            关闭
          </button>
        </div>
        <label className="mt-5 flex items-center justify-between text-xs text-zinc-600">
          任务并发数
          <input
            aria-label="任务并发数"
            type="number"
            min={1}
            max={8}
            step={1}
            className="settings-number"
            required
            value={draft.concurrency}
            onChange={(event) => setDraft({ ...draft, concurrency: Number(event.target.value) })}
          />
        </label>
        <p className="mt-2 text-[11px] leading-5 text-zinc-600">
          默认 1。提高并发会增加内存、磁盘占用；降低并发不会中断已运行任务。
        </p>
        {(['outputDirectory', 'tempDirectory'] as const).map((field) => (
          <section className="mt-6" key={field}>
            <p className="panel-label">
              {field === 'outputDirectory' ? '默认输出目录' : '临时文件目录'}
            </p>
            <p className="settings-path" title={draft[field] ?? ''}>
              {draft[field] ?? (field === 'outputDirectory' ? '与源视频相同目录' : '系统临时目录')}
            </p>
            <div className="mt-2 flex gap-3">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  setError(null)
                  try {
                    const path = await window.api.settings.chooseDirectory(
                      field === 'outputDirectory' ? 'output' : 'temp'
                    )
                    if (path) setDraft((state) => ({ ...state, [field]: path }))
                  } catch (error) {
                    setError(String(error))
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                {field === 'outputDirectory' ? '选择输出目录' : '选择临时目录'}
              </button>
              <button
                type="button"
                className="quiet-button"
                disabled={busy || !draft[field]}
                onClick={() => setDraft({ ...draft, [field]: null })}
              >
                恢复默认
              </button>
            </div>
          </section>
        ))}
        <p className="mt-5 text-[11px] leading-5 text-zinc-600">
          目录更改用于随后启动的任务。ProRes 4444
          中间文件可能很大，开始前会检查临时目录和输出目录的可用空间。
        </p>
        {error && (
          <p role="alert" className="panel-error">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? '正在保存…' : '保存设置'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
