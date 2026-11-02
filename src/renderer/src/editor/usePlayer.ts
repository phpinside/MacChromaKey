import { useCallback, useEffect, type RefObject } from 'react'
import type { VideoInfo } from '../../../shared/types'
import { useAppStore } from '../store/appStore'
import { useEditorStore } from '../store/editorStore'
import { clamp, lastFrameTime, stepFrame } from './geometry'

export interface PlayerControls {
  seek: (time: number) => void
  toggle: () => void
  step: (direction: number) => void
}

export function usePlayer(
  videoRef: RefObject<HTMLVideoElement | null>,
  info: VideoInfo
): PlayerControls {
  const seek = useCallback(
    (time: number): void => {
      const video = videoRef.current
      if (!video || video.readyState < 1) return
      const lastFrame = lastFrameTime(info.fps, info.duration)
      const next = clamp(time, 0, lastFrame)
      video.currentTime = next
      useEditorStore.getState().setTime(next)
    },
    [videoRef, info]
  )
  const toggle = useCallback((): void => {
    const video = videoRef.current
    if (!video || video.readyState < 1) return
    if (video.paused) {
      useAppStore.getState().setPreviewMode('original')
      if (video.ended || video.currentTime >= info.duration - 0.001) seek(0)
      void video.play().catch((error) => {
        if (error.name !== 'AbortError')
          useEditorStore.setState({ error: `无法播放：${error.message}` })
      })
    } else video.pause()
  }, [videoRef, info, seek])
  const step = useCallback(
    (direction: number): void => {
      const video = videoRef.current
      if (!video) return
      video.pause()
      seek(stepFrame(video.currentTime, direction, info.fps, info.duration))
    },
    [videoRef, info, seek]
  )

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const source = useEditorStore.getState().currentFile?.url
    if (source && !video.hasAttribute('src')) video.src = source // StrictMode setup after cleanup
    let id = 0
    const update = (): void => {
      if (!video.paused) useEditorStore.getState().setTime(video.currentTime)
      id = video.requestVideoFrameCallback(update)
    }
    id = video.requestVideoFrameCallback(update)
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.closest('dialog, textarea, select, [contenteditable="true"]')) return
      const input = target?.closest('input')
      if (input && (input.type !== 'range' || input.id.startsWith('slider-'))) return
      if (target?.closest('[role="slider"]') && ['ArrowLeft', 'ArrowRight'].includes(event.key))
        return
      if (event.code === 'Space') {
        if (target?.closest('button')) return
        event.preventDefault()
        if (!event.repeat) toggle()
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        step(event.key === 'ArrowLeft' ? -1 : 1)
      } else if (event.key.toLowerCase() === 'i' || event.key.toLowerCase() === 'o') {
        event.preventDefault()
        useEditorStore
          .getState()
          .setTrimPoint(event.key.toLowerCase() === 'i' ? 'start' : 'end', video.currentTime)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      video.cancelVideoFrameCallback(id)
      window.removeEventListener('keydown', onKey)
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [videoRef, toggle, step])
  return { seek, toggle, step }
}
