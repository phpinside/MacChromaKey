import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  clipboard,
  type IpcMainInvokeEvent
} from 'electron'
import { basename, dirname, join } from 'node:path'
import { stat } from 'node:fs/promises'
import { IPC_CHANNELS, type DesktopAPI } from '../shared/types'
import { detectTools } from './ffmpeg/detectTools'
import { authorizeVideo, authorizedVideoPath, mediaRegistry } from './localfile'
import { probeCached } from './ffmpeg/probe'
import { FramePreview } from './ffmpeg/preview'
import { PresetStore } from './presets'
import { batchExportPaths, defaultExportPath } from './exportPaths'
import type { PreviewFrameRequest } from '../shared/types'
import { OutputAuthorizations, trustedRendererUrl } from './ipcSecurity'
import type { SettingsStore } from './settings'
import type { ThumbnailCache } from './ffmpeg/thumbnail'
import type { AppSettings } from '../shared/types'
import type { JobQueue } from './jobs/queue'
import type { FFmpegInstaller } from './ffmpeg/install'

export function registerIpcHandlers(
  getWindow: () => BrowserWindow | null,
  jobs: JobQueue,
  settings: SettingsStore,
  thumbnails: ThumbnailCache,
  rendererUrl: string,
  installer: FFmpegInstaller
): () => Promise<void> {
  const preview = new FramePreview()
  const outputs = new OutputAuthorizations()
  const selectedDirectories = new Set<string>()
  const presets = new PresetStore(join(app.getPath('userData'), 'presets.json'))
  let observedContents: Electron.WebContents | undefined
  const videoPath = (url: unknown): string => {
    const path = typeof url === 'string' ? authorizedVideoPath(url) : undefined
    if (!path) throw new Error('视频尚未授权，请重新导入')
    return path
  }
  const importMedia = async (
    path: string
  ): Promise<Awaited<ReturnType<DesktopAPI['openVideo']>>> => {
    const video = await authorizeVideo(path)
    const thumbnail = await thumbnails.get(video.path)
    return { ...video, ...(thumbnail && { thumbnail }) }
  }
  const saveSettings = async (value: AppSettings): Promise<AppSettings> => {
    if (!value || typeof value !== 'object') throw new Error('设置无效')
    const current = settings.get()
    for (const directory of [value.outputDirectory, value.tempDirectory]) {
      if (
        directory !== null &&
        directory !== current.outputDirectory &&
        directory !== current.tempDirectory &&
        !selectedDirectories.has(directory)
      )
        throw new Error('目录未经授权，请通过目录选择器选择')
    }
    const result = await settings.save(value)
    await jobs.setConcurrency(result.concurrency)
    return result
  }
  function trustedWindow(event: IpcMainInvokeEvent): BrowserWindow {
    const window = getWindow()
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      !trustedRendererUrl(event.senderFrame?.url, rendererUrl)
    ) {
      throw new Error('不允许的 IPC 来源')
    }
    if (observedContents !== window.webContents) {
      observedContents = window.webContents
      observedContents.once('destroyed', () => {
        void preview.cancel()
        mediaRegistry.clear()
        outputs.clear()
        selectedDirectories.clear()
      })
      observedContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
        if (isMainFrame) void preview.cancel()
      })
    }
    return window
  }

  ipcMain.handle(IPC_CHANNELS.detectTools, async (event): ReturnType<DesktopAPI['detectTools']> => {
    trustedWindow(event)
    const report = await detectTools()
    installer.ensureMissing(report)
    return report
  })

  ipcMain.handle(IPC_CHANNELS.openVideo, async (event): ReturnType<DesktopAPI['openVideo']> => {
    const window = trustedWindow(event)
    const result = await dialog.showOpenDialog(window, {
      title: '导入绿幕视频',
      buttonLabel: '导入视频',
      properties: ['openFile'],
      filters: [{ name: '视频文件', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    return importMedia(result.filePaths[0])
  })

  ipcMain.handle(IPC_CHANNELS.importVideo, (event, path: string) => {
    trustedWindow(event)
    return importMedia(path)
  })
  ipcMain.handle(IPC_CHANNELS.probeVideo, (event, url: string) => {
    trustedWindow(event)
    return mediaRegistry.assertPath(videoPath(url)).then((path) => probeCached(path))
  })

  ipcMain.handle(IPC_CHANNELS.previewFrame, async (event, request: PreviewFrameRequest) => {
    trustedWindow(event)
    return preview.frame(await mediaRegistry.assertPath(videoPath(request?.url)), request)
  })
  ipcMain.handle(IPC_CHANNELS.previewCancel, (event, id: string) => {
    trustedWindow(event)
    if (typeof id !== 'string' || !id) throw new Error('预览请求 ID 无效')
    return preview.cancel(id)
  })
  ipcMain.handle(IPC_CHANNELS.chooseExportPaths, async (event, urls: string[]) => {
    const window = trustedWindow(event)
    if (
      !Array.isArray(urls) ||
      !urls.length ||
      urls.length > 1000 ||
      new Set(urls).size !== urls.length
    )
      throw new Error('导出素材列表无效')
    const inputs = urls.map(videoPath)
    if (inputs.length === 1) {
      const result = await dialog.showSaveDialog(window, {
        title: '导出 HEVC with Alpha',
        defaultPath: settings.get().outputDirectory
          ? join(settings.get().outputDirectory!, basename(defaultExportPath(inputs[0])))
          : defaultExportPath(inputs[0]),
        filters: [{ name: 'HEVC with Alpha', extensions: ['mov'] }]
      })
      if (result.canceled || !result.filePath) return null
      await outputs.grant(inputs[0], result.filePath)
      return [{ url: urls[0], outputPath: result.filePath }]
    }
    const result = await dialog.showOpenDialog(window, {
      title: '选择批量导出目录',
      defaultPath: settings.get().outputDirectory ?? dirname(inputs[0]),
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const paths = await batchExportPaths(inputs, result.filePaths[0])
    for (let index = 0; index < paths.length; index++)
      await outputs.grant(inputs[index], paths[index])
    return urls.map((url, index) => ({ url, outputPath: paths[index] }))
  })

  ipcMain.handle(IPC_CHANNELS.settingsChooseDirectory, async (event, kind: 'output' | 'temp') => {
    const window = trustedWindow(event)
    if (!['output', 'temp'].includes(kind)) throw new Error('目录类型无效')
    const result = await dialog.showOpenDialog(window, {
      title: kind === 'temp' ? '选择临时文件目录' : '选择默认输出目录',
      defaultPath:
        (kind === 'temp' ? settings.get().tempDirectory : settings.get().outputDirectory) ??
        undefined,
      properties: ['openDirectory', 'createDirectory']
    })
    const path = result.canceled ? null : (result.filePaths[0] ?? null)
    if (path) {
      selectedDirectories.add(path)
      if (selectedDirectories.size > 128)
        selectedDirectories.delete(selectedDirectories.values().next().value!)
    }
    return path
  })
  ipcMain.handle(IPC_CHANNELS.jobsEdit, async (event, id: string) => {
    const window = trustedWindow(event)
    const job = jobs.get(id)
    let path = job.inputPath
    try {
      await stat(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const result = await dialog.showOpenDialog(window, {
        title: '源文件已移动，请定位原视频',
        buttonLabel: '使用此视频',
        properties: ['openFile'],
        filters: [{ name: '视频', extensions: ['mp4', 'mov', 'mkv', 'm4v', 'webm', 'avi'] }]
      })
      if (result.canceled || !result.filePaths[0]) return null
      path = result.filePaths[0]
    }
    const video = await importMedia(path)
    if (!video) return null
    return { video, info: await probeCached(video.path), params: job.params }
  })
  const handlers = {
    [IPC_CHANNELS.installFFmpeg]: () => installer.start(),
    [IPC_CHANNELS.cancelFFmpegInstall]: () => installer.cancel(),
    [IPC_CHANNELS.ffmpegInstallState]: () => installer.state(),
    [IPC_CHANNELS.settingsGet]: () => settings.get(),
    [IPC_CHANNELS.settingsSave]: (value: AppSettings) => saveSettings(value),
    [IPC_CHANNELS.jobsCopyLog]: (id: string) => {
      const job = jobs.get(id)
      clipboard.writeText(
        [
          (job.stderrTail?.length ? job.error?.split('\n')[0] : job.error) ?? '',
          ...(job.stderrTail?.length
            ? ['\nFFmpeg / 转码日志（末尾 50 行）：', ...job.stderrTail]
            : [])
        ].join('\n')
      )
    },
    [IPC_CHANNELS.presetsList]: () => presets.list(),
    [IPC_CHANNELS.presetsSave]: (
      name: string,
      params: Parameters<DesktopAPI['presets']['save']>[1]
    ) => presets.save(name, params),
    [IPC_CHANNELS.presetsDelete]: (id: string) => presets.delete(id),
    [IPC_CHANNELS.jobsList]: () => jobs.snapshot(),
    [IPC_CHANNELS.jobsAdd]: async (request: Parameters<DesktopAPI['jobs']['add']>[0]) => {
      const input = await mediaRegistry.assertPath(request?.inputPath)
      const outputPath = await outputs.consume(input, request?.outputPath)
      return jobs.add({ ...request, inputPath: input, outputPath })
    },
    [IPC_CHANNELS.jobsCancel]: (id: string) => jobs.cancel(id),
    [IPC_CHANNELS.jobsRetry]: (id: string) => jobs.retry(id),
    [IPC_CHANNELS.jobsRemove]: (id: string) => jobs.remove(id),
    [IPC_CHANNELS.jobsClearFinished]: () => jobs.clearFinished(),
    [IPC_CHANNELS.jobsSetConcurrency]: async (concurrency: number) => {
      await saveSettings({ ...settings.get(), concurrency })
    },
    [IPC_CHANNELS.jobsShowOutput]: async (id: string) => {
      const job = jobs.get(id)
      if (job.status !== 'done') throw new Error('任务尚未完成')
      if (!(await stat(job.outputPath)).isFile()) throw new Error('输出文件不存在')
      shell.showItemInFolder(job.outputPath)
    }
  }
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event, ...args) => {
      trustedWindow(event)
      // Every argument is validated by the queue, including data loaded from disk.
      return (handler as (...values: unknown[]) => unknown)(...args)
    })
  }
  const unsubscribeJobs = jobs.subscribe((snapshot) => {
    const window = getWindow()
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.jobsChanged, snapshot)
    }
  })
  const unsubscribeInstall = installer.subscribe((state) => {
    const window = getWindow()
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed())
      window.webContents.send(IPC_CHANNELS.ffmpegInstallChanged, state)
  })
  return async () => {
    unsubscribeJobs()
    unsubscribeInstall()
    await preview.cancel()
  }
}
