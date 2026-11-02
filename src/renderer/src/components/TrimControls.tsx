import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { formatTime, clamp } from '../editor/geometry'
import { useEditorStore } from '../store/editorStore'

type Point = 'start' | 'end'
export function TrimControls(): React.JSX.Element {
  const info = useEditorStore((s) => s.probeInfo)!
  const trim = useEditorStore((s) => s.trim)
  const setPoint = useEditorStore((s) => s.setTrimPoint)
  const reset = useEditorStore((s) => s.resetTrim)
  const area = trim ?? { start: 0, end: info.duration }
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef<{ id: number; point: Point } | null>(null)
  const timeAt = (x: number): number => {
    const rect = trackRef.current!.getBoundingClientRect()
    return clamp((x - rect.left) / rect.width, 0, 1) * info.duration
  }
  const begin = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || dragging.current) return
    event.preventDefault()
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-trim-point]')
    const time = timeAt(event.clientX)
    const point: Point =
      (target?.dataset.trimPoint as Point) ??
      (Math.abs(time - area.start) <= Math.abs(time - area.end) ? 'start' : 'end')
    dragging.current = { id: event.pointerId, point }
    event.currentTarget.querySelector<HTMLElement>(`[data-trim-point="${point}"]`)?.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    setPoint(point, time)
  }
  const end = (event: PointerEvent<HTMLDivElement>): void => {
    if (dragging.current?.id !== event.pointerId) return
    dragging.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const keyboard = (event: KeyboardEvent<HTMLDivElement>, point: Point): void => {
    let next: number
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
      next =
        area[point] + ((event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1)) / info.fps
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = info.duration
    else return
    event.preventDefault()
    event.stopPropagation()
    setPoint(point, next)
  }
  return (
    <section className="trim-controls" aria-label="时间区间">
      <div className="flex items-center gap-3 text-[10px]">
        <span className="font-medium text-zinc-600">时间区间</span>
        <button
          className="quiet-button"
          title="设为当前时间（I）"
          onClick={() => setPoint('start', useEditorStore.getState().currentTime)}
        >
          入点 <kbd>I</kbd> <span className="font-mono">{formatTime(area.start)}</span>
        </button>
        <button
          className="quiet-button"
          title="设为当前时间（O）"
          onClick={() => setPoint('end', useEditorStore.getState().currentTime)}
        >
          出点 <kbd>O</kbd> <span className="font-mono">{formatTime(area.end)}</span>
        </button>
        <span className="ml-auto font-mono text-zinc-600">
          选中 {formatTime(area.end - area.start)}
        </span>
        <button className="quiet-button" onClick={reset}>
          全时长
        </button>
      </div>
      <div
        ref={trackRef}
        className="trim-track"
        data-testid="trim-track"
        onPointerDown={begin}
        onPointerMove={(event) => {
          if (dragging.current?.id === event.pointerId)
            setPoint(dragging.current.point, timeAt(event.clientX))
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={() => {
          dragging.current = null
        }}
      >
        <div className="trim-rail" />
        <div
          className="trim-selection"
          style={{
            left: `${(area.start / info.duration) * 100}%`,
            width: `${((area.end - area.start) / info.duration) * 100}%`
          }}
        />
        {(['start', 'end'] as const).map((point) => (
          <div
            key={point}
            role="slider"
            tabIndex={0}
            className="trim-thumb"
            aria-label={point === 'start' ? '入点' : '出点'}
            aria-valuemin={point === 'start' ? 0 : area.start + 1 / info.fps}
            aria-valuemax={point === 'end' ? info.duration : area.end - 1 / info.fps}
            aria-valuenow={area[point]}
            aria-valuetext={formatTime(area[point])}
            data-trim-point={point}
            style={{ left: `${(area[point] / info.duration) * 100}%` }}
            onKeyDown={(event) => keyboard(event, point)}
          />
        ))}
      </div>
    </section>
  )
}
