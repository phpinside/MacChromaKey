import type { KeyParams } from '../../../shared/types'

export type Crop = NonNullable<KeyParams['crop']>
export type Bounds = { width: number; height: number }
export type Handle = 'move' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'
export type Aspect = 'free' | '16:9' | '1:1' | '9:16'
export const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value))
export const aspectValue = (aspect: Aspect): number | null => {
  if (aspect === 'free') return null
  const [w, h] = aspect.split(':').map(Number)
  return w / h
}
export const fullCrop = (source: Bounds): Crop => ({
  x: 0,
  y: 0,
  w: source.width,
  h: source.height
})

// object-fit: contain inside a padding-free video surface; offsets include letterboxing.
export function fitVideo(container: Bounds, source: Bounds): Crop & { scale: number } {
  const scale = Math.min(container.width / source.width, container.height / source.height)
  const w = source.width * scale
  const h = source.height * scale
  return { x: (container.width - w) / 2, y: (container.height - h) / 2, w, h, scale }
}

export function boundedCrop(crop: Crop, source: Bounds): Crop {
  const w = clamp(Math.round(crop.w), Math.min(2, source.width), source.width)
  const h = clamp(Math.round(crop.h), Math.min(2, source.height), source.height)
  return {
    w,
    h,
    x: clamp(Math.round(crop.x), 0, source.width - w),
    y: clamp(Math.round(crop.y), 0, source.height - h)
  }
}

export function fitAspect(crop: Crop, source: Bounds, ratio: number): Crop {
  const cx = crop.x + crop.w / 2
  const cy = crop.y + crop.h / 2
  let w = Math.sqrt(crop.w * crop.h * ratio)
  let h = w / ratio
  const scale = Math.min(
    1,
    (2 * Math.min(cx, source.width - cx)) / w,
    (2 * Math.min(cy, source.height - cy)) / h
  )
  w *= scale
  h *= scale
  return boundedCrop({ x: cx - w / 2, y: cy - h / 2, w, h }, source)
}

export function dragCrop(
  initial: Crop,
  handle: Handle,
  dx: number,
  dy: number,
  source: Bounds,
  ratio: number | null
): Crop {
  if (handle === 'move')
    return boundedCrop({ ...initial, x: initial.x + dx, y: initial.y + dy }, source)
  const west = handle.includes('w'),
    east = handle.includes('e')
  const north = handle.includes('n'),
    south = handle.includes('s')
  if (!ratio) {
    const l = west ? clamp(initial.x + dx, 0, initial.x + initial.w - 2) : initial.x
    const r = east
      ? clamp(initial.x + initial.w + dx, initial.x + 2, source.width)
      : initial.x + initial.w
    const t = north ? clamp(initial.y + dy, 0, initial.y + initial.h - 2) : initial.y
    const b = south
      ? clamp(initial.y + initial.h + dy, initial.y + 2, source.height)
      : initial.y + initial.h
    return boundedCrop({ x: l, y: t, w: r - l, h: b - t }, source)
  }
  const sx = west ? -1 : 1,
    sy = north ? -1 : 1
  if ((west || east) && (north || south)) {
    const ax = west ? initial.x + initial.w : initial.x
    const ay = north ? initial.y + initial.h : initial.y
    const desired =
      Math.abs(dx) / initial.w >= Math.abs(dy) / initial.h
        ? initial.w + sx * dx
        : (initial.h + sy * dy) * ratio
    const maxW = Math.min(west ? ax : source.width - ax, (north ? ay : source.height - ay) * ratio)
    const w = clamp(desired, Math.min(maxW, Math.max(2, 2 * ratio)), maxW),
      h = w / ratio
    return boundedCrop({ x: west ? ax - w : ax, y: north ? ay - h : ay, w, h }, source)
  }
  if (west || east) {
    const ax = west ? initial.x + initial.w : initial.x,
      cy = initial.y + initial.h / 2
    const maxW = Math.min(
      west ? ax : source.width - ax,
      2 * Math.min(cy, source.height - cy) * ratio
    )
    const w = clamp(initial.w + sx * dx, Math.min(maxW, Math.max(2, 2 * ratio)), maxW),
      h = w / ratio
    return boundedCrop({ x: west ? ax - w : ax, y: cy - h / 2, w, h }, source)
  }
  const ay = north ? initial.y + initial.h : initial.y,
    cx = initial.x + initial.w / 2
  const maxH = Math.min(
    north ? ay : source.height - ay,
    (2 * Math.min(cx, source.width - cx)) / ratio
  )
  const h = clamp(initial.h + sy * dy, Math.min(maxH, Math.max(2, 2 / ratio)), maxH),
    w = h * ratio
  return boundedCrop({ x: cx - w / 2, y: north ? ay - h : ay, w, h }, source)
}

export function frameTime(time: number, fps: number, duration: number): number {
  return clamp(Math.round(time * fps) / fps, 0, duration)
}

export function lastFrameTime(fps: number, duration: number): number {
  return Math.max(0, (Math.ceil(duration * fps - 1e-6) - 1) / fps)
}

export function stepFrame(time: number, direction: number, fps: number, duration: number): number {
  // Chromium rounds seek timestamps to microseconds, slightly below an exact frame boundary.
  return clamp((Math.floor(time * fps + 1e-3) + direction) / fps, 0, lastFrameTime(fps, duration))
}

export function formatTime(time: number): string {
  const value = Math.round(Math.max(0, Number.isFinite(time) ? time : 0) * 100)
  const minutes = Math.floor(value / 6000)
  return `${String(minutes).padStart(2, '0')}:${((value % 6000) / 100).toFixed(2).padStart(5, '0')}`
}
