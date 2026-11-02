import { useEffect, useState } from 'react'
import { ToolStatusBar } from './components/ToolStatusBar'
import { VideoPreview } from './components/VideoPreview'
import { ParameterSidebar } from './components/ParameterSidebar'
import { subscribeTools } from './store/appStore'
import { useSettingsStore } from './store/settingsStore'
import { MediaSidebar } from './components/MediaSidebar'
import { QueueStatus } from './components/QueueStatus'
import { SettingsDialog } from './components/SettingsDialog'
import { subscribeJobs } from './store/jobsStore'
import { GuideDialog } from './components/GuideDialog'
import { needsFirstRunGuide, rememberGuide } from './editor/guide'
import { PRODUCT } from '../../shared/product'
import appIcon from './assets/app-icon.png'

function App(): React.JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [guide, setGuide] = useState<'first-run' | 'help' | null>(() =>
    needsFirstRunGuide() ? 'first-run' : null
  )
  const closeGuide = (): void => {
    rememberGuide()
    setGuide(null)
  }
  const settings = useSettingsStore((s) => s.settings)
  const settingsError = useSettingsStore((s) => s.error)
  useEffect(() => {
    void useSettingsStore.getState().refresh()
  }, [])
  useEffect(subscribeTools, [])
  useEffect(subscribeJobs, [])
  return (
    <div className="flex h-screen min-h-0 flex-col bg-[#f3f6f4] text-zinc-700">
      <header className="titlebar flex h-12 shrink-0 items-center gap-3 border-b border-zinc-200 pr-5 pl-24">
        <img src={appIcon} alt="" aria-hidden="true" className="h-8 w-8 shrink-0 object-contain" />
        <h1 className="truncate text-[13px] font-semibold tracking-tight text-zinc-900">
          {PRODUCT.name}
        </h1>
        <span className="preview-badge shrink-0">{PRODUCT.version}</span>
        <span className="ml-auto">
          <QueueStatus />
        </span>
        <button className="quiet-button shrink-0" onClick={() => setGuide('help')}>
          使用说明
        </button>
        <button
          className="quiet-button"
          aria-label="打开设置"
          disabled={!settings}
          onClick={() => setSettingsOpen(true)}
        >
          设置
        </button>
      </header>
      <ToolStatusBar />
      {settingsError && (
        <p role="alert" className="import-error">
          {settingsError}
        </p>
      )}
      <main className="editor-layout">
        <MediaSidebar />
        <VideoPreview />
        <ParameterSidebar />
      </main>
      {settingsOpen && settings && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {guide && <GuideDialog firstRun={guide === 'first-run'} onClose={closeGuide} />}
      <footer className="flex h-8 shrink-0 items-center justify-between border-t border-zinc-200 px-5 text-[10px] text-zinc-500">
        <span className="flex items-center gap-2">
          <span className="status-dot bg-emerald-400/60" /> 本地处理 · 媒体无需上传
        </span>
        <span>I / O 设置入点与出点</span>
      </footer>
    </div>
  )
}

export default App
