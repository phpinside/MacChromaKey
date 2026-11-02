import { useAppStore } from '../store/appStore'

export function ToolStatusBar(): React.JSX.Element {
  const report = useAppStore((s) => s.report)
  const checking = useAppStore((s) => s.checking)
  const error = useAppStore((s) => s.detectionError)
  const refresh = useAppStore((s) => s.refreshTools)
  const installation = useAppStore((s) => s.installation)
  const install = useAppStore((s) => s.installFFmpeg)
  const cancel = useAppStore((s) => s.cancelInstall)
  const installing = ['checking', 'downloading', 'verifying', 'installing'].includes(
    installation.stage
  )
  const tools = report ? Object.values(report.tools) : []
  const missing = tools.filter((tool) => !tool.available)
  const failed = Boolean(error || missing.length)

  return (
    <section
      aria-label="本机工具状态"
      aria-live="polite"
      className={`border-b px-7 py-3 text-xs ${failed ? 'border-red-400/20 bg-red-400/8' : 'border-zinc-200 bg-white'}`}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <span
          className={`flex items-center gap-2 font-medium ${failed ? 'text-red-700' : 'text-zinc-700'}`}
        >
          <span
            className={`status-dot ${failed ? 'bg-red-400' : checking || !report ? 'bg-amber-300' : 'bg-emerald-400'}`}
          />
          {checking
            ? '正在检测本机环境…'
            : failed
              ? installing
                ? '正在自动安装运行环境…'
                : '环境需要处理'
              : report
                ? '本机环境就绪'
                : '等待检测'}
        </span>
        {tools.map((tool) => (
          <span
            key={tool.name}
            title={`${tool.path ?? '未找到'}\n${tool.version ?? tool.error ?? ''}`}
            className={`flex items-center gap-2 ${tool.available ? 'text-zinc-600' : 'text-red-700'}`}
          >
            <span className={`status-dot ${tool.available ? 'bg-emerald-400/80' : 'bg-red-400'}`} />
            {tool.name}
            <span className="font-mono text-[10px] opacity-80">
              {tool.available ? (tool.name === 'avconvert' ? 'HEVC α' : tool.version) : '不可用'}
            </span>
          </span>
        ))}
        <button
          className="ml-auto text-zinc-600 transition hover:text-emerald-700 disabled:opacity-40"
          onClick={() => void refresh()}
          disabled={checking}
        >
          {checking ? '检测中' : '重新检测'}
        </button>
      </div>
      {installation.stage !== 'idle' && (
        <div className="mt-3" aria-label="FFmpeg 安装状态">
          <div className="flex items-center gap-3">
            <span className={installation.stage === 'failed' ? 'text-red-700' : 'text-zinc-700'}>
              {installation.message}
            </span>
            {installing && (
              <button className="quiet-button ml-auto shrink-0" onClick={() => void cancel()}>
                取消安装
              </button>
            )}
            {['failed', 'canceled'].includes(installation.stage) && (
              <button className="quiet-button ml-auto shrink-0" onClick={() => void install()}>
                重试安装
              </button>
            )}
          </div>
          {installing && (
            <progress
              aria-label="FFmpeg 安装进度"
              className="mt-2 h-1.5 w-full accent-emerald-600"
              max={100}
              value={installation.progress}
            />
          )}
          {installation.stage !== 'done' && (
            <p className="mt-2 text-zinc-500">
              按 Mac 架构选择最新稳定版，安装 FFmpeg 与
              ffprobe；仅首次安装需要联网，无需管理员权限。下载源：Martin Riedl。
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-red-700">
          {error}
        </p>
      )}
      {missing.length > 0 && (
        <div role="alert" className="mt-3 space-y-2 text-red-700">
          {missing.map((tool) => (
            <p key={tool.name}>
              {tool.name}：{tool.error}
            </p>
          ))}
          {missing.some((tool) => tool.name !== 'avconvert') && (
            <p>
              {installing ? '正在自动安装，也可取消后在终端运行 ' : '也可在终端运行 '}
              <code className="rounded bg-black/5 px-2 py-1 select-text">brew install ffmpeg</code>
              ，安装后点击「重新检测」。
            </p>
          )}
          {missing.some((tool) => tool.name === 'avconvert') && (
            <p>avconvert 随 macOS 提供，请检查系统是否支持 HEVC Alpha 预设。</p>
          )}
        </div>
      )}
      {report && (
        <details className="mt-2 text-zinc-600">
          <summary className="w-fit cursor-pointer text-[11px] hover:text-zinc-700">
            路径与版本
          </summary>
          <dl className="mt-3 grid grid-cols-[70px_1fr] gap-x-4 gap-y-2 font-mono text-[11px] select-text">
            {tools.map((tool) => (
              <div key={tool.name} className="contents">
                <dt>{tool.name}</dt>
                <dd className="break-all">
                  {tool.path ?? '未找到'} <span className="text-zinc-500">·</span>{' '}
                  {tool.version ?? '无版本信息'}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </section>
  )
}
