import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IPC_CHANNELS,
  type DesktopAPI,
  type JobQueueSnapshot,
  type FFmpegInstallState
} from '../shared/types'

const api: DesktopAPI = {
  detectTools: () => ipcRenderer.invoke(IPC_CHANNELS.detectTools),
  ffmpegInstall: {
    start: () => ipcRenderer.invoke(IPC_CHANNELS.installFFmpeg),
    cancel: () => ipcRenderer.invoke(IPC_CHANNELS.cancelFFmpegInstall),
    state: () => ipcRenderer.invoke(IPC_CHANNELS.ffmpegInstallState),
    onChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: FFmpegInstallState): void =>
        listener(state)
      ipcRenderer.on(IPC_CHANNELS.ffmpegInstallChanged, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.ffmpegInstallChanged, handler)
    }
  },
  openVideo: () => ipcRenderer.invoke(IPC_CHANNELS.openVideo),
  importVideo: (file) => {
    const path = webUtils.getPathForFile(file)
    if (!path) return Promise.reject(new Error('请拖入磁盘上的视频文件'))
    return ipcRenderer.invoke(IPC_CHANNELS.importVideo, path)
  },
  probeVideo: (url) => ipcRenderer.invoke(IPC_CHANNELS.probeVideo, url),
  preview: {
    frame: (request) => ipcRenderer.invoke(IPC_CHANNELS.previewFrame, request),
    cancel: (id) => ipcRenderer.invoke(IPC_CHANNELS.previewCancel, id)
  },
  presets: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.presetsList),
    save: (name, params) => ipcRenderer.invoke(IPC_CHANNELS.presetsSave, name, params),
    delete: (id) => ipcRenderer.invoke(IPC_CHANNELS.presetsDelete, id)
  },
  chooseExportPaths: (urls) => ipcRenderer.invoke(IPC_CHANNELS.chooseExportPaths, urls),
  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGet),
    save: (settings) => ipcRenderer.invoke(IPC_CHANNELS.settingsSave, settings),
    chooseDirectory: (kind) => ipcRenderer.invoke(IPC_CHANNELS.settingsChooseDirectory, kind)
  },
  jobs: {
    edit: (id) => ipcRenderer.invoke(IPC_CHANNELS.jobsEdit, id),
    copyLog: (id) => ipcRenderer.invoke(IPC_CHANNELS.jobsCopyLog, id),
    list: () => ipcRenderer.invoke(IPC_CHANNELS.jobsList),
    add: (request) => ipcRenderer.invoke(IPC_CHANNELS.jobsAdd, request),
    cancel: (id) => ipcRenderer.invoke(IPC_CHANNELS.jobsCancel, id),
    retry: (id) => ipcRenderer.invoke(IPC_CHANNELS.jobsRetry, id),
    remove: (id) => ipcRenderer.invoke(IPC_CHANNELS.jobsRemove, id),
    clearFinished: () => ipcRenderer.invoke(IPC_CHANNELS.jobsClearFinished),
    setConcurrency: (concurrency) =>
      ipcRenderer.invoke(IPC_CHANNELS.jobsSetConcurrency, concurrency),
    showOutput: (id) => ipcRenderer.invoke(IPC_CHANNELS.jobsShowOutput, id),
    onChanged: (listener) => {
      // Never expose IpcRendererEvent or its sender through contextBridge.
      const handler = (_event: Electron.IpcRendererEvent, snapshot: JobQueueSnapshot): void =>
        listener(snapshot)
      ipcRenderer.on(IPC_CHANNELS.jobsChanged, handler)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.jobsChanged, handler)
      }
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
