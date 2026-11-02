import { create } from 'zustand'
import { useAppStore } from './appStore'
import type { KeyParams, LocalVideo, VideoInfo } from '../../../shared/types'
import {
  aspectValue,
  boundedCrop,
  clamp,
  dragCrop,
  fitAspect,
  frameTime,
  fullCrop,
  type Aspect,
  type Crop
} from '../editor/geometry'

interface Document {
  file: LocalVideo
  info: VideoInfo
  crop: Crop | null
  trim: KeyParams['trim']
  aspect: Aspect
}
interface EditorState {
  sourceRevision: number
  editingJobId: string | null
  editJob: (id: string) => Promise<void>
  files: Document[]
  currentFile: LocalVideo | null
  probeInfo: VideoInfo | null
  crop: Crop | null
  trim: KeyParams['trim']
  aspect: Aspect
  currentTime: number
  playing: boolean
  loading: boolean
  error: string | null
  importVideo: (file?: File) => Promise<void>
  selectFile: (path: string) => void
  setCrop: (crop: Crop) => void
  setCropField: (field: keyof Crop, value: number) => void
  setAspect: (aspect: Aspect) => void
  resetCrop: () => void
  setTrimPoint: (point: 'start' | 'end', time: number) => void
  resetTrim: () => void
  setTime: (time: number) => void
  setPlaying: (playing: boolean) => void
}

export const useEditorStore = create<EditorState>((set, get) => {
  const edit = (patch: Partial<Pick<Document, 'crop' | 'trim' | 'aspect'>>): void => {
    set((state) => ({
      ...patch,
      files: state.files.map((doc) =>
        doc.file.path === state.currentFile?.path ? { ...doc, ...patch } : doc
      )
    }))
  }
  const activate = (doc: Document): void =>
    set((state) => ({
      sourceRevision: state.sourceRevision + 1,
      editingJobId: null,
      currentFile: doc.file,
      probeInfo: doc.info,
      crop: doc.crop,
      trim: doc.trim,
      aspect: doc.aspect,
      currentTime: 0,
      playing: false,
      error: null
    }))
  return {
    sourceRevision: 0,
    editingJobId: null,
    editJob: async (id) => {
      if (get().loading) return
      set({ loading: true, error: null })
      try {
        const result = await window.api.jobs.edit(id)
        if (!result) return
        const { video, info, params } = result
        const trim =
          params.trim && params.trim.start < info.duration
            ? { start: params.trim.start, end: Math.min(params.trim.end, info.duration) }
            : null
        const doc: Document = {
          file: video,
          info,
          crop: params.crop ? boundedCrop(params.crop, info) : null,
          trim,
          aspect: 'free'
        }
        set((state) => ({
          files: [...state.files.filter((item) => item.file.path !== video.path), doc]
        }))
        activate(doc)
        set({ editingJobId: id })
        useAppStore.getState().updateParams(params)
        useAppStore.getState().setPreviewMode('keyed')
      } finally {
        set({ loading: false })
      }
    },
    files: [],
    currentFile: null,
    probeInfo: null,
    crop: null,
    trim: null,
    aspect: 'free',
    currentTime: 0,
    playing: false,
    loading: false,
    error: null,
    importVideo: async (file) => {
      if (get().loading) return
      set({ loading: true, error: null })
      try {
        if (!window.api) throw new Error('请在 Electron 桌面窗口中导入视频')
        const video = file ? await window.api.importVideo(file) : await window.api.openVideo()
        if (!video) return
        const info = await window.api.probeVideo(video.url)
        const previous = get().files.find((doc) => doc.file.path === video.path)
        const reusable =
          previous &&
          previous.info.width === info.width &&
          previous.info.height === info.height &&
          previous.info.duration === info.duration
        const doc: Document = {
          file: video,
          info,
          crop: reusable ? previous.crop : null,
          trim: reusable ? previous.trim : null,
          aspect: reusable ? previous.aspect : 'free'
        }
        set((state) => ({
          files: [...state.files.filter((item) => item.file.path !== video.path), doc]
        }))
        activate(doc)
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
      } finally {
        set({ loading: false })
      }
    },
    selectFile: (path) => {
      if (path === get().currentFile?.path) return
      const doc = get().files.find((item) => item.file.path === path)
      if (doc) activate(doc)
    },
    setCrop: (crop) => {
      const info = get().probeInfo
      if (info) edit({ crop: boundedCrop(crop, info) })
    },
    setCropField: (field, value) => {
      const { probeInfo: info, crop, aspect } = get()
      if (!info || !Number.isFinite(value)) return
      const current = crop ?? fullCrop(info)
      if (field === 'x' || field === 'y') {
        edit({ crop: boundedCrop({ ...current, [field]: value }, info) })
      } else {
        edit({
          crop: dragCrop(
            current,
            field === 'w' ? 'e' : 's',
            field === 'w' ? value - current.w : 0,
            field === 'h' ? value - current.h : 0,
            info,
            aspectValue(aspect)
          )
        })
      }
    },
    setAspect: (aspect) => {
      const { probeInfo: info, crop } = get()
      if (!info) return
      const ratio = aspectValue(aspect)
      edit({ aspect, ...(ratio && { crop: fitAspect(crop ?? fullCrop(info), info, ratio) }) })
    },
    resetCrop: () => edit({ crop: null, aspect: 'free' }),
    setTrimPoint: (point, time) => {
      const { probeInfo: info, trim } = get()
      if (!info || !Number.isFinite(time)) return
      const next = { ...(trim ?? { start: 0, end: info.duration }) }
      const gap = Math.min(1 / info.fps, info.duration)
      const target = frameTime(time, info.fps, info.duration)
      next[point] =
        point === 'start'
          ? clamp(target, 0, next.end - gap)
          : clamp(target, next.start + gap, info.duration)
      edit({ trim: next })
    },
    resetTrim: () => edit({ trim: null }),
    setTime: (time) => set({ currentTime: clamp(time, 0, get().probeInfo?.duration ?? 0) }),
    setPlaying: (playing) => set({ playing })
  }
})
