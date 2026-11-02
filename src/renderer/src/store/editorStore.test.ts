import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppStore } from './appStore'
import { useEditorStore } from './editorStore'

const info = { width: 320, height: 180, fps: 24, duration: 4, hasAudio: false }
const video = { name: 'video.mp4', path: '/video.mp4', url: 'localfile://media/one', size: 1024 }

beforeEach(() => {
  useEditorStore.setState({
    editingJobId: null,
    files: [],
    currentFile: null,
    probeInfo: null,
    crop: null,
    trim: null,
    aspect: 'free',
    currentTime: 0,
    playing: false,
    loading: false,
    error: null
  })
  vi.stubGlobal('window', {
    api: {
      openVideo: vi.fn().mockResolvedValue(video),
      importVideo: vi.fn().mockResolvedValue(video),
      probeVideo: vi.fn().mockResolvedValue(info)
    }
  })
})
afterEach(() => vi.unstubAllGlobals())

it('imports and probes through IPC and keeps edits for each selected source', async () => {
  await useEditorStore.getState().importVideo()
  expect(window.api.probeVideo).toHaveBeenCalledWith(video.url)
  useEditorStore.getState().setCrop({ x: 20, y: 20, w: 100, h: 100 })
  useEditorStore.getState().setTrimPoint('start', 1)
  vi.mocked(window.api.openVideo).mockResolvedValue({
    ...video,
    path: '/second.mov',
    url: 'localfile://media/two'
  })
  await useEditorStore.getState().importVideo()
  expect(useEditorStore.getState().crop).toBeNull()
  useEditorStore.getState().selectFile('/video.mp4')
  expect(useEditorStore.getState().crop).toEqual({ x: 20, y: 20, w: 100, h: 100 })
  expect(useEditorStore.getState().trim?.start).toBe(1)
})

it('keeps trim points ordered with at least one frame between them', async () => {
  await useEditorStore.getState().importVideo()
  useEditorStore.getState().setTrimPoint('end', 1)
  useEditorStore.getState().setTrimPoint('start', 4)
  const trim = useEditorStore.getState().trim!
  expect(trim.end).toBe(1)
  expect(trim.start).toBeCloseTo(1 - 1 / 24)
  useEditorStore.getState().setTrimPoint('end', 0)
  expect(useEditorStore.getState().trim!.end - trim.start).toBeCloseTo(1 / 24)
  useEditorStore.getState().resetTrim()
  expect(useEditorStore.getState().trim).toBeNull()
})

it('clamps numeric crop fields and applies/resets the aspect lock', async () => {
  await useEditorStore.getState().importVideo()
  useEditorStore.getState().setAspect('1:1')
  expect(useEditorStore.getState().crop?.w).toBe(useEditorStore.getState().crop?.h)
  useEditorStore.getState().setCropField('w', 80)
  expect(useEditorStore.getState().crop?.h).toBe(80)
  useEditorStore.getState().setCropField('x', 99999)
  expect(useEditorStore.getState().crop?.x).toBe(240)
  useEditorStore.getState().resetCrop()
  expect(useEditorStore.getState().crop).toBeNull()
  expect(useEditorStore.getState().aspect).toBe('free')
})

it('retains the selected document and reports a failed import', async () => {
  await useEditorStore.getState().importVideo()
  vi.mocked(window.api.probeVideo).mockRejectedValue(new Error('broken media'))
  await useEditorStore.getState().importVideo()
  expect(useEditorStore.getState().currentFile).toEqual(video)
  expect(useEditorStore.getState().loading).toBe(false)
  expect(useEditorStore.getState().error).toContain('broken media')
})

it('restores a job snapshot for editing and clears edit context on ordinary import', async () => {
  const params = {
    ...useAppStore.getState().params,
    similarity: 0.46,
    crop: { x: 10, y: 20, w: 100, h: 80 },
    trim: { start: 1, end: 3 }
  }
  Object.assign(window.api, { jobs: { edit: vi.fn().mockResolvedValue({ video, info, params }) } })
  await useEditorStore.getState().editJob('old-job')
  expect(useEditorStore.getState().editingJobId).toBe('old-job')
  expect(useEditorStore.getState().crop).toEqual(params.crop)
  expect(useEditorStore.getState().trim).toEqual(params.trim)
  expect(useAppStore.getState().params.similarity).toBe(0.46)
  expect(useAppStore.getState().previewMode).toBe('keyed')
  await useEditorStore.getState().importVideo()
  expect(useEditorStore.getState().editingJobId).toBeNull()
})
