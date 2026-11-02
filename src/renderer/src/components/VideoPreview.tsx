import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useEditorStore } from '../store/editorStore'
import { useAppStore } from '../store/appStore'
import { useFramePreview } from '../editor/useFramePreview'
import { fitVideo, formatTime } from '../editor/geometry'
import { usePlayer } from '../editor/usePlayer'
import { CropOverlay } from './CropOverlay'
import { CropControls } from './CropControls'
import { TransportControls } from './TransportControls'
import { TrimControls } from './TrimControls'
import { PRODUCT } from '../../../shared/product'

function Player(): React.JSX.Element {
  const file = useEditorStore((s) => s.currentFile)!
  const info = useEditorStore((s) => s.probeInfo)!
  const videoRef = useRef<HTMLVideoElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const controls = usePlayer(videoRef, info)
  const mode = useAppStore((s) => s.previewMode)
  const picking = useAppStore((s) => s.picking)
  const background = useAppStore((s) => s.background)
  const backgroundColor = useAppStore((s) => s.backgroundColor)
  const preview = useFramePreview()
  useEffect(() => {
    if (mode !== 'original' || picking) videoRef.current?.pause()
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') useAppStore.getState().setPicking(false)
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [mode, picking])
  useEffect(() => {
    const surface = surfaceRef.current!
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    )
    observer.observe(surface)
    return () => observer.disconnect()
  }, [])
  return (
    <>
      <div
        ref={surfaceRef}
        className={`video-surface ${mode === 'keyed' && background === 'solid' ? '' : 'checkerboard'}`}
        style={{
          backgroundColor: mode === 'keyed' && background === 'solid' ? backgroundColor : undefined
        }}
        data-testid="video-surface"
      >
        <video
          ref={videoRef}
          crossOrigin="anonymous"
          src={file.url}
          playsInline
          preload="auto"
          aria-label="源视频"
          className="source-video"
          style={{ opacity: mode === 'original' ? 1 : 0 }}
          onLoadedMetadata={() => setReady(true)}
          onError={() => {
            setFailed(true)
            setReady(false)
            useEditorStore.getState().setPlaying(false)
          }}
          onPlay={() => useEditorStore.getState().setPlaying(true)}
          onPause={() => {
            useEditorStore.getState().setPlaying(false)
            useEditorStore.getState().setTime(videoRef.current?.currentTime ?? 0)
          }}
          onTimeUpdate={() => useEditorStore.getState().setTime(videoRef.current?.currentTime ?? 0)}
          onSeeked={() => useEditorStore.getState().setTime(videoRef.current?.currentTime ?? 0)}
          onEnded={() => useEditorStore.getState().setPlaying(false)}
        />
        {mode === 'original' && !picking && !failed && (
          <CropOverlay width={size.width} height={size.height} />
        )}
        {mode !== 'original' && preview.image && (
          <img
            className="processed-frame"
            src={preview.image}
            alt={mode === 'alpha' ? 'Alpha 蒙版' : '抠像结果'}
            data-testid="processed-frame"
          />
        )}
        {mode !== 'original' && preview.pending && (
          <span className="preview-message" role="status">
            正在生成单帧预览…
          </span>
        )}
        {mode !== 'original' && preview.error && (
          <p className="video-error" role="alert">
            {preview.error}
          </p>
        )}
        {picking && (
          <div
            className="color-pick-overlay"
            data-testid="color-pick-overlay"
            onPointerDown={(event) => {
              if (event.button !== 0) return
              const video = videoRef.current
              if (!video || video.readyState < 2 || video.seeking) return
              const rect = event.currentTarget.getBoundingClientRect()
              const fitted = fitVideo({ width: rect.width, height: rect.height }, info)
              const x = (event.clientX - rect.left - fitted.x) / fitted.scale
              const y = (event.clientY - rect.top - fitted.y) / fitted.scale
              if (x < 0 || y < 0 || x >= info.width || y >= info.height) return
              try {
                const canvas = document.createElement('canvas')
                canvas.width = canvas.height = 1
                const context = canvas.getContext('2d', { willReadFrequently: true })!
                context.drawImage(video, Math.floor(x), Math.floor(y), 1, 1, 0, 0, 1, 1)
                const pixel = context.getImageData(0, 0, 1, 1).data
                const keyColor =
                  '0x' +
                  Array.from(pixel.subarray(0, 3), (v) => v.toString(16).padStart(2, '0'))
                    .join('')
                    .toUpperCase()
                useAppStore.getState().updateParams({ keyColor })
                useAppStore.getState().setPicking(false)
              } catch (error) {
                useEditorStore.setState({ error: `无法读取当前帧颜色：${String(error)}` })
              }
            }}
          />
        )}
        {failed && mode === 'original' && (
          <p role="alert" className="video-error">
            当前编码无法在播放器中解码。请尝试 H.264 MP4；文件信息和裁剪设置仍保留。
          </p>
        )}
      </div>
      <CropControls />
      <TransportControls controls={controls} disabled={!ready || failed} />
      <TrimControls />
    </>
  )
}

function PreviewModes(): React.JSX.Element {
  const mode = useAppStore((s) => s.previewMode)
  const background = useAppStore((s) => s.background)
  const color = useAppStore((s) => s.backgroundColor)
  return (
    <div className="preview-modes">
      <div role="group" aria-label="预览显示模式" className="mode-switch">
        {(['original', 'keyed', 'alpha'] as const).map((value, index) => (
          <button
            key={value}
            aria-pressed={value === mode}
            onClick={() => useAppStore.getState().setPreviewMode(value)}
          >
            {['原图', '抠像结果', 'Alpha 蒙版'][index]}
          </button>
        ))}
      </div>
      {mode === 'keyed' ? (
        <div className="ml-auto flex items-center gap-2">
          <select
            className="editor-select"
            aria-label="预览背景"
            value={background}
            onChange={(e) =>
              useAppStore.setState({ background: e.target.value as 'checker' | 'solid' })
            }
          >
            <option value="checker">棋盘格</option>
            <option value="solid">纯色背景</option>
          </select>
          {background === 'solid' && (
            <input
              type="color"
              aria-label="预览背景颜色"
              value={color}
              onChange={(e) => useAppStore.setState({ backgroundColor: e.target.value })}
            />
          )}
        </div>
      ) : (
        <span className="ml-auto text-[9px] text-zinc-500">
          {mode === 'alpha' ? '白色保留 · 黑色透明' : '原始画面'}
        </span>
      )}
    </div>
  )
}

export function VideoPreview(): React.JSX.Element {
  const file = useEditorStore((s) => s.currentFile)
  const sourceRevision = useEditorStore((s) => s.sourceRevision)
  const info = useEditorStore((s) => s.probeInfo)
  const loading = useEditorStore((s) => s.loading)
  const error = useEditorStore((s) => s.error)
  const importVideo = useEditorStore((s) => s.importVideo)
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)
  const drop = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault()
    depth.current = 0
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) void importVideo(file)
  }
  return (
    <section
      className={`preview-panel ${dragging ? 'is-dragging' : ''}`}
      aria-label="视频预览工作区"
      onDragEnter={(event) => {
        event.preventDefault()
        depth.current++
        setDragging(true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(event) => {
        event.preventDefault()
        depth.current = Math.max(0, depth.current - 1)
        if (!depth.current) setDragging(false)
      }}
      onDrop={drop}
    >
      <div className="preview-heading">
        <span className="text-xs font-medium text-zinc-800">画面预览</span>
        <span className="preview-badge">透明动画工作台</span>
        {info && (
          <span className="ml-auto font-mono text-[10px] text-zinc-600" data-testid="probe-info">
            {info.width} × {info.height} · {formatTime(info.duration)} ·{' '}
            {Number(info.fps.toFixed(3))} fps
          </span>
        )}
      </div>
      {file && <PreviewModes />}
      {error && (
        <p role="alert" className="import-error">
          {error}
        </p>
      )}
      {file && info ? (
        <Player key={`${file.url}:${sourceRevision}`} />
      ) : (
        <div className="empty-preview checkerboard">
          <span className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-300/15 bg-[#e9f6ef] text-3xl text-emerald-700">
            ▧
          </span>
          <h2 className="text-lg font-medium text-zinc-800">{PRODUCT.tagline}</h2>
          <p className="mt-3 text-xs leading-6 text-zinc-600">
            将绿幕视频拖到这里，或选择本地文件。裁剪画面、去除背景，导出透明 MOV。
          </p>
          <button
            className="primary-button mt-6"
            onClick={() => void importVideo()}
            disabled={loading}
          >
            {loading ? '正在读取视频…' : '选择视频文件'}
          </button>
          <p className="mt-4 font-mono text-[10px] tracking-wider text-zinc-500">MP4 · MOV · MKV</p>
        </div>
      )}
      <div className="preview-footer">
        <span className="truncate">{file?.name ?? 'NO MEDIA SELECTED'}</span>
        <span className="ml-auto pl-3">
          {loading
            ? '正在读取视频信息…'
            : file
              ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
              : '本地媒体'}
        </span>
      </div>
      {dragging && <div className="drop-overlay">松开以导入视频</div>}
    </section>
  )
}
