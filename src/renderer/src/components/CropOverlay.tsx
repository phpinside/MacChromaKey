import { useRef, type PointerEvent } from 'react'
import { useEditorStore } from '../store/editorStore'
import {
  aspectValue,
  dragCrop,
  fitVideo,
  fullCrop,
  type Crop,
  type Handle
} from '../editor/geometry'

const handles: { mode: Handle; x: number; y: number; label: string }[] = [
  { mode: 'nw', x: 0, y: 0, label: '左上' },
  { mode: 'n', x: 50, y: 0, label: '上' },
  { mode: 'ne', x: 100, y: 0, label: '右上' },
  { mode: 'e', x: 100, y: 50, label: '右' },
  { mode: 'se', x: 100, y: 100, label: '右下' },
  { mode: 's', x: 50, y: 100, label: '下' },
  { mode: 'sw', x: 0, y: 100, label: '左下' },
  { mode: 'w', x: 0, y: 50, label: '左' }
]

export function CropOverlay({
  width,
  height
}: {
  width: number
  height: number
}): React.JSX.Element | null {
  const info = useEditorStore((s) => s.probeInfo)
  const selected = useEditorStore((s) => s.crop)
  const aspect = useEditorStore((s) => s.aspect)
  const setCrop = useEditorStore((s) => s.setCrop)
  const gesture = useRef<{
    id: number
    mode: Handle
    x: number
    y: number
    initial: Crop
    scale: number
  } | null>(null)
  if (!info || width <= 0 || height <= 0) return null
  const box = fitVideo({ width, height }, info)
  const crop = selected ?? fullCrop(info)
  const x = crop.x * box.scale,
    y = crop.y * box.scale
  const w = crop.w * box.scale,
    h = crop.h * box.scale
  const begin = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || gesture.current) return
    event.preventDefault()
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-handle]')
    gesture.current = {
      id: event.pointerId,
      mode: (target?.dataset.handle as Handle) ?? 'move',
      x: event.clientX,
      y: event.clientY,
      initial: crop,
      scale: box.scale
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const move = (event: PointerEvent<HTMLDivElement>): void => {
    const start = gesture.current
    if (!start || event.pointerId !== start.id) return
    setCrop(
      dragCrop(
        start.initial,
        start.mode,
        (event.clientX - start.x) / start.scale,
        (event.clientY - start.y) / start.scale,
        info,
        aspectValue(aspect)
      )
    )
  }
  const end = (event: PointerEvent<HTMLDivElement>): void => {
    if (gesture.current?.id !== event.pointerId) return
    gesture.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return (
    <div
      className="crop-viewport"
      data-testid="crop-viewport"
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
    >
      <div className="crop-shade" style={{ left: 0, top: 0, width: box.w, height: y }} />
      <div className="crop-shade" style={{ left: 0, top: y, width: x, height: h }} />
      <div
        className="crop-shade"
        style={{ left: x + w, top: y, width: box.w - x - w, height: h }}
      />
      <div
        className="crop-shade"
        style={{ left: 0, top: y + h, width: box.w, height: box.h - y - h }}
      />
      <div
        className="crop-box"
        data-testid="crop-box"
        aria-label="拖动裁剪区域"
        style={{ left: x, top: y, width: w, height: h }}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={() => {
          gesture.current = null
        }}
      >
        <span className="crop-third vertical" style={{ left: '33.333%' }} />
        <span className="crop-third vertical" style={{ left: '66.666%' }} />
        <span className="crop-third horizontal" style={{ top: '33.333%' }} />
        <span className="crop-third horizontal" style={{ top: '66.666%' }} />
        {handles.map(({ mode, x, y, label }) => (
          <button
            key={mode}
            type="button"
            className={`crop-handle handle-${mode}`}
            data-handle={mode}
            aria-label={`调整裁剪${label}`}
            tabIndex={-1}
            style={{ left: `${x}%`, top: `${y}%` }}
          />
        ))}
      </div>
    </div>
  )
}
