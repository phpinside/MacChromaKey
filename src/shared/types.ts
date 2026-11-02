export interface ChromaKeyParams {
  keyColor: string
  similarity: number
  blend: number
  alphaLow: number
  alphaHigh: number
  despill: boolean
  despillType: 'green' | 'blue'
  crop: { x: number; y: number; w: number; h: number } | null
  trim: { start: number; end: number } | null
  keepAudio: boolean
  exportMaxEdge: 0 | 720 | 960 | 1280 | 1920 // 0 keeps the source size; never upscale.
  exportFps: 0 | 15 | 24 | 30 | 60 // 0 keeps source timing; otherwise cap, never increase fps.
}

export type KeyParams = ChromaKeyParams

export interface VideoInfo {
  width: number
  height: number
  duration: number
  fps: number
  hasAudio: boolean
}

export interface ExportProgress {
  stage: 'probing' | 'keying' | 'converting' | 'validating' | 'done'
  progress: number // 0–1; Apple conversion holds at 0.9 until validation completes.
  message: string
}

export const DEFAULT_PARAMS: ChromaKeyParams = {
  keyColor: '0x00FF00',
  similarity: 0.3,
  blend: 0.05,
  alphaLow: 100,
  alphaHigh: 200,
  despill: true,
  despillType: 'green',
  crop: null,
  trim: null,
  keepAudio: false,
  exportMaxEdge: 0,
  exportFps: 0
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled'
export type JobStage = 'keying' | 'apple-transcode' | 'verifying'
export interface Job {
  id: string
  inputPath: string
  outputPath: string
  params: ChromaKeyParams
  status: JobStatus
  stage: JobStage
  progress: number // 0–100
  startedAt: string | null
  finishedAt: string | null
  error?: string
  stderrTail?: string[]
  thumbnail?: string
}

export interface AddJobRequest {
  inputPath: string
  outputPath: string
  params: KeyParams
}

export interface JobQueueSnapshot {
  jobs: Job[]
  concurrency: number
  revision: number
  persistenceError?: string
}

export type ToolName = 'ffmpeg' | 'ffprobe' | 'avconvert'
export interface ToolStatus {
  name: ToolName
  available: boolean
  path: string | null
  version: string | null
  error?: string
  supportsAlpha?: boolean
}

export interface ToolReport {
  tools: Record<ToolName, ToolStatus>
  checkedAt: string
}

export interface FFmpegInstallState {
  stage:
    | 'idle'
    | 'checking'
    | 'downloading'
    | 'verifying'
    | 'installing'
    | 'done'
    | 'failed'
    | 'canceled'
  progress: number
  message: string
  version?: string
  error?: string
}

export interface LocalVideo {
  name: string
  path: string
  url: string
  size: number
  thumbnail?: string
}

export type PreviewMode = 'original' | 'keyed' | 'alpha'
export interface PreviewFrameRequest {
  id: string
  url: string
  time: number
  params: KeyParams
  mode: Exclude<PreviewMode, 'original'>
}
export interface PreviewFrameResult {
  id: string
  dataUrl: string | null // null means canceled/superseded
}
export interface ParameterPreset {
  id: string
  name: string
  params: KeyParams // presets contain keying/audio/export settings; crop and trim are always null
  builtin?: boolean
}
export interface ExportDestination {
  url: string
  outputPath: string
}

export interface AppSettings {
  concurrency: number
  outputDirectory: string | null
  tempDirectory: string | null
}
export const DEFAULT_SETTINGS: AppSettings = {
  concurrency: 1,
  outputDirectory: null,
  tempDirectory: null
}
export interface EditJobResult {
  video: LocalVideo
  info: VideoInfo
  params: KeyParams
}

export const IPC_CHANNELS = {
  previewFrame: 'preview:frame',
  previewCancel: 'preview:cancel',
  presetsList: 'presets:list',
  presetsSave: 'presets:save',
  presetsDelete: 'presets:delete',
  chooseExportPaths: 'export:choose-paths',
  detectTools: 'system:detect-tools',
  installFFmpeg: 'system:install-ffmpeg',
  cancelFFmpegInstall: 'system:cancel-ffmpeg-install',
  ffmpegInstallState: 'system:ffmpeg-install-state',
  ffmpegInstallChanged: 'system:ffmpeg-install-changed',
  openVideo: 'video:open',
  importVideo: 'video:import',
  probeVideo: 'video:probe',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  settingsChooseDirectory: 'settings:choose-directory',
  jobsEdit: 'jobs:edit',
  jobsCopyLog: 'jobs:copy-log',
  jobsList: 'jobs:list',
  jobsAdd: 'jobs:add',
  jobsCancel: 'jobs:cancel',
  jobsRetry: 'jobs:retry',
  jobsRemove: 'jobs:remove',
  jobsClearFinished: 'jobs:clear-finished',
  jobsSetConcurrency: 'jobs:set-concurrency',
  jobsShowOutput: 'jobs:show-output',
  jobsChanged: 'jobs:changed'
} as const

// Each method uses one fixed channel; never expose raw ipcRenderer to the renderer.
export interface DesktopAPI {
  detectTools: () => Promise<ToolReport>
  ffmpegInstall: {
    start: () => Promise<FFmpegInstallState>
    cancel: () => Promise<void>
    state: () => Promise<FFmpegInstallState>
    onChanged: (listener: (state: FFmpegInstallState) => void) => () => void
  }
  openVideo: () => Promise<LocalVideo | null>
  importVideo: (file: File) => Promise<LocalVideo>
  probeVideo: (url: string) => Promise<VideoInfo>
  preview: {
    frame: (request: PreviewFrameRequest) => Promise<PreviewFrameResult>
    cancel: (id: string) => Promise<void>
  }
  presets: {
    list: () => Promise<ParameterPreset[]>
    save: (name: string, params: KeyParams) => Promise<ParameterPreset[]>
    delete: (id: string) => Promise<ParameterPreset[]>
  }
  chooseExportPaths: (urls: string[]) => Promise<ExportDestination[] | null>
  settings: {
    get: () => Promise<AppSettings>
    save: (settings: AppSettings) => Promise<AppSettings>
    chooseDirectory: (kind: 'output' | 'temp') => Promise<string | null>
  }
  jobs: {
    edit: (id: string) => Promise<EditJobResult | null>
    copyLog: (id: string) => Promise<void>
    list: () => Promise<JobQueueSnapshot>
    add: (request: AddJobRequest) => Promise<Job>
    cancel: (id: string) => Promise<Job>
    retry: (id: string) => Promise<Job>
    remove: (id: string) => Promise<void>
    clearFinished: () => Promise<void>
    setConcurrency: (concurrency: number) => Promise<void>
    showOutput: (id: string) => Promise<void>
    onChanged: (listener: (snapshot: JobQueueSnapshot) => void) => () => void
  }
}
