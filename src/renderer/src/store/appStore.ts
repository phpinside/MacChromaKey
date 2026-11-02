import { create } from 'zustand'
import {
  DEFAULT_PARAMS,
  type ChromaKeyParams,
  type PreviewMode,
  type FFmpegInstallState,
  type ToolReport
} from '../../../shared/types'

interface AppState {
  params: ChromaKeyParams
  previewMode: PreviewMode
  picking: boolean
  background: 'checker' | 'solid'
  backgroundColor: string
  updateParams: (patch: Partial<ChromaKeyParams>) => void
  setPreviewMode: (mode: PreviewMode) => void
  setPicking: (picking: boolean) => void
  report: ToolReport | null
  checking: boolean
  detectionError: string | null
  refreshTools: () => Promise<void>
  installation: FFmpegInstallState
  installFFmpeg: () => Promise<void>
  cancelInstall: () => Promise<void>
}

export const useAppStore = create<AppState>((set, get) => ({
  params: { ...DEFAULT_PARAMS },
  previewMode: 'original',
  picking: false,
  background: 'checker',
  backgroundColor: '#ffffff',
  updateParams: (patch) =>
    set((state) => ({ params: { ...state.params, ...patch, crop: null, trim: null } })),
  setPreviewMode: (previewMode) => set({ previewMode, picking: false }),
  setPicking: (picking) => set({ picking, ...(picking && { previewMode: 'original' }) }),
  report: null,
  checking: false,
  detectionError: null,
  installation: { stage: 'idle', progress: 0, message: '' },
  installFFmpeg: async () => {
    try {
      const installation = await window.api.ffmpegInstall.start()
      set({ installation })
      if (installation.stage === 'done') await get().refreshTools()
    } catch (error) {
      set({ detectionError: error instanceof Error ? error.message : String(error) })
    }
  },
  cancelInstall: async () => {
    try {
      await window.api.ffmpegInstall.cancel()
    } catch (error) {
      set({ detectionError: error instanceof Error ? error.message : String(error) })
    }
  },
  refreshTools: async () => {
    if (get().checking) return
    set({ checking: true, detectionError: null })
    try {
      if (!window.api) throw new Error('桌面桥接未加载，请使用 npm run dev 启动 Electron 应用')
      set({ report: await window.api.detectTools() })
    } catch (error) {
      set({ detectionError: error instanceof Error ? error.message : String(error) })
    } finally {
      set({ checking: false })
    }
  }
}))

export function subscribeTools(): () => void {
  let active = true
  let observed = false
  const update = (installation: FFmpegInstallState): void => {
    if (!active) return
    useAppStore.setState({ installation })
    if (installation.stage === 'done') void useAppStore.getState().refreshTools()
  }
  const unsubscribe = window.api.ffmpegInstall.onChanged((state) => {
    observed = true
    update(state)
  })
  void useAppStore
    .getState()
    .refreshTools()
    .then(async () => {
      const state = await window.api.ffmpegInstall.state()
      if (!observed) update(state)
    })
    .catch((error) => {
      if (active) useAppStore.setState({ detectionError: String(error) })
    })
  return () => {
    active = false
    unsubscribe()
  }
}
