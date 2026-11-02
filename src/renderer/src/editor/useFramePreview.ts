import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { useEditorStore } from '../store/editorStore'
import { previewImage } from './previewImage'
import { lastFrameTime } from './geometry'
import type { PreviewFrameRequest } from '../../../shared/types'

export function useFramePreview(): {
  image: string | null
  pending: boolean
  error: string | null
} {
  const mode = useAppStore((s) => s.previewMode)
  const params = useAppStore((s) => s.params)
  const file = useEditorStore((s) => s.currentFile)
  const info = useEditorStore((s) => s.probeInfo)
  const crop = useEditorStore((s) => s.crop)
  const time = useEditorStore((s) => s.currentTime)
  // trim/audio/fps don't change a single frame; color/crop/size/time/mode do.
  const key =
    mode === 'original' || !file || !info
      ? ''
      : JSON.stringify({
          url: file.url,
          time: Math.min(time, lastFrameTime(info.fps, info.duration)),
          mode,
          params: { ...params, crop, trim: null, keepAudio: false, exportFps: 0 }
        })
  const [result, setResult] = useState({
    key: '',
    image: null as string | null,
    error: null as string | null
  })
  useEffect(() => {
    if (!key) return
    let disposed = false
    let started = false
    let release: (() => void) | undefined
    const id = crypto.randomUUID()
    const timer = setTimeout(() => {
      started = true
      const request = { ...JSON.parse(key), id } as PreviewFrameRequest
      void window.api.preview
        .frame(request)
        .then((frame) => {
          if (!disposed && frame.id === id && frame.dataUrl) {
            const owned = previewImage(frame.dataUrl)
            release = owned.release
            setResult({ key, image: owned.url, error: null })
          }
        })
        .catch((error) => {
          if (!disposed) setResult({ key, image: null, error: String(error) })
        })
    }, 250)
    return () => {
      disposed = true
      clearTimeout(timer)
      release?.()
      if (started) void window.api.preview.cancel(id).catch(() => {})
    }
  }, [key])
  return {
    image: key && result.key === key ? result.image : null,
    pending: Boolean(key && result.key !== key),
    error: key && result.key === key ? result.error : null
  }
}
