import { app, BrowserWindow, dialog, nativeTheme, net } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { optimizer } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc'
import { registerLocalFileHandler, registerLocalFileScheme } from './localfile'
import { JobQueue } from './jobs/queue'
import { notifyJobDone } from './jobs/notifications'
import { SettingsStore } from './settings'
import { ThumbnailCache } from './ffmpeg/thumbnail'
import { runExport } from './ffmpeg/pipeline'
import { createQuitHandler } from './quit'
import { PRODUCT } from '../shared/product'
import { userDataDirectory } from './userData'
import { FFmpegInstaller, installFFmpeg } from './ffmpeg/install'
import { managedToolsRoot } from './ffmpeg/toolPaths'
import { detectTools } from './ffmpeg/detectTools'
import appIcon from '../../build/chroma-icon.png?asset'

registerLocalFileScheme()
// Keep app JSON state aligned with Chromium's explicit isolated-profile switch.
const profile = app.commandLine.getSwitchValue('user-data-dir')
// Preserve existing jobs/settings/profiles when changing the visible product name.
const userData = userDataDirectory(
  app.getPath('userData'),
  app.getPath('appData'),
  app.getName(),
  profile
)
app.setName(PRODUCT.name)
app.setPath('userData', userData)

let mainWindow: BrowserWindow | null = null

function rendererEntry(): string {
  return !app.isPackaged && process.env.ELECTRON_RENDERER_URL
    ? process.env.ELECTRON_RENDERER_URL
    : pathToFileURL(join(__dirname, '../renderer/index.html')).href
}
function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: `${PRODUCT.name} ${PRODUCT.version}`,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f3f6f4',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false)
  )
  window.webContents.session.setPermissionCheckHandler(() => false)
  mainWindow = window
  const rendererUrl = rendererEntry()

  window.once('ready-to-show', () => window.show())
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).href !== new URL(rendererUrl).href) event.preventDefault()
  })
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  optimizer.watchWindowShortcuts(window)
  void window.loadURL(rendererUrl)
}

void app
  .whenReady()
  .then(async () => {
    nativeTheme.themeSource = 'light'
    app.dock?.setIcon(appIcon)
    const settings = await SettingsStore.open(join(app.getPath('userData'), 'settings.json'))
    const thumbnails = new ThumbnailCache()
    const installer = new FFmpegInstaller(async (progress, signal) => {
      const current = await detectTools()
      if (current.tools.ffmpeg.available && current.tools.ffprobe.available)
        return current.tools.ffmpeg.version!
      const version = await installFFmpeg(
        await managedToolsRoot(),
        process.arch,
        progress,
        signal,
        net.fetch.bind(net)
      )
      const report = await detectTools()
      if (!report.tools.ffmpeg.available || !report.tools.ffprobe.available)
        throw new Error('安装后工具仍不可用，请重新检测或重试')
      return version
    })
    const jobs = await JobQueue.open({
      filePath: join(app.getPath('userData'), 'jobs.json'),
      onDone: notifyJobDone,
      concurrency: settings.get().concurrency,
      getThumbnail: (input) => thumbnails.get(input),
      run: (input, output, params, progress, signal) =>
        runExport(input, output, params, progress, signal, {
          tempDirectory: settings.get().tempDirectory
        })
    })
    registerLocalFileHandler(rendererEntry())
    const stopPreview = registerIpcHandlers(
      () => mainWindow,
      jobs,
      settings,
      thumbnails,
      rendererEntry(),
      installer
    )
    app.on(
      'before-quit',
      createQuitHandler({
        unfinished: () => {
          const { jobs: list } = jobs.snapshot()
          return {
            running: list.filter((job) => job.status === 'running').length,
            queued: list.filter((job) => job.status === 'queued').length
          }
        },
        confirm: async ({ running, queued }) => {
          const options: Electron.MessageBoxOptions = {
            type: 'warning',
            title: `退出${PRODUCT.name}？`,
            message: `仍有 ${running} 个运行中任务、${queued} 个排队任务`,
            detail:
              '退出会中断运行任务并清理临时文件。未完成任务将在下次启动时标记为“应用中断”，可重新提交。',
            buttons: ['继续处理', '退出并中断任务'],
            defaultId: 0,
            cancelId: 0,
            noLink: true
          }
          const result =
            mainWindow && !mainWindow.isDestroyed()
              ? await dialog.showMessageBox(mainWindow, options)
              : await dialog.showMessageBox(options)
          return result.response === 1
        },
        shutdown: async () => {
          const results = await Promise.allSettled([
            jobs.shutdown(),
            stopPreview(),
            thumbnails.shutdown(),
            installer.shutdown()
          ])
          const failed = results.find((result) => result.status === 'rejected')
          if (failed?.status === 'rejected') throw failed.reason
        },
        quit: () => app.quit()
      })
    )
    createWindow()
    void detectTools()
      .then((report) => installer.ensureMissing(report))
      .catch(console.error)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((error) => {
    console.error(error)
    dialog.showErrorBox(
      `无法启动${PRODUCT.name}`,
      error instanceof Error ? error.message : String(error)
    )
    app.quit()
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
