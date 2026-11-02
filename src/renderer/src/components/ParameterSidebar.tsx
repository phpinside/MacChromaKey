import { useEffect, useRef, useState } from 'react'
import type { KeyParams, ParameterPreset } from '../../../shared/types'
import { useAppStore } from '../store/appStore'
import { useEditorStore } from '../store/editorStore'
import { batchParams } from '../editor/batchExport'

type NumericParam = 'similarity' | 'blend' | 'alphaLow' | 'alphaHigh'
function NumberSlider({
  name,
  label,
  min,
  max,
  step
}: {
  name: NumericParam
  label: string
  min: number
  max: number
  step: number
}): React.JSX.Element {
  const value = useAppStore((s) => s.params[name])
  const update = useAppStore((s) => s.updateParams)
  const [draft, setDraft] = useState({ source: value, text: String(value) })
  const pointer = useRef<number | null>(null)
  const text = draft.source === value ? draft.text : String(value)
  const normalize = (raw: string): number | null => {
    if (!raw.trim() || !Number.isFinite(Number(raw))) return null
    return Number(Math.min(max, Math.max(min, Math.round(Number(raw) / step) * step)).toFixed(3))
  }
  const commit = (raw: string): void => {
    const current = useAppStore.getState().params[name]
    const next = normalize(raw) ?? current
    setDraft({ source: next, text: String(next) })
    if (next !== current) update({ [name]: next })
  }
  return (
    <div className="parameter-field">
      <label htmlFor={`slider-${name}`}>{label}</label>
      <input
        type="number"
        aria-label={`${label}数值`}
        min={min}
        max={max}
        step={step}
        value={text}
        onChange={(e) => setDraft({ source: value, text: e.target.value })}
        onBlur={(e) => {
          if (pointer.current === null) commit(e.currentTarget.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(e.currentTarget.value)
          }
        }}
      />
      <input
        id={`slider-${name}`}
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={normalize(text) ?? value}
        onChange={(e) => setDraft({ source: value, text: e.target.value })}
        onPointerDown={(e) => {
          if (e.button !== 0 || !e.isPrimary) return
          pointer.current = e.pointerId
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerUp={(e) => {
          if (pointer.current !== e.pointerId) return
          pointer.current = null
          commit(e.currentTarget.value)
        }}
        onPointerCancel={(e) => {
          if (pointer.current !== e.pointerId) return
          pointer.current = null
          setDraft({ source: value, text: String(value) })
        }}
        onLostPointerCapture={(e) => {
          // Chromium may transfer capture to the native range thumb while still dragging.
          if (pointer.current !== e.pointerId || e.buttons !== 0) return
          pointer.current = null
          commit(e.currentTarget.value)
        }}
        onKeyUp={(e) => {
          if (pointer.current === null) commit(e.currentTarget.value)
        }}
        onBlur={(e) => {
          pointer.current = null
          commit(e.currentTarget.value)
        }}
      />
    </div>
  )
}

function PresetControls(): React.JSX.Element {
  const update = useAppStore((s) => s.updateParams)
  const [presets, setPresets] = useState<ParameterPreset[]>([])
  const [selected, setSelected] = useState('default-green')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    void window.api.presets
      .list()
      .then((items) => {
        if (active) setPresets(items)
      })
      .catch((error) => {
        if (active) setError(String(error))
      })
    return () => {
      active = false
    }
  }, [])
  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const items = await window.api.presets.save(name, useAppStore.getState().params)
      setPresets(items)
      setSelected(items.find((item) => item.name === name.trim())!.id)
      setName('')
    } catch (error) {
      setError(String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="parameter-section" aria-label="参数预设">
      <p className="panel-label">参数预设</p>
      <div className="mt-3 flex gap-2">
        <select
          aria-label="选择参数预设"
          className="editor-select min-w-0 flex-1"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
        <button
          className="quiet-button"
          disabled={busy || !presets.length}
          onClick={() => {
            const preset = presets.find((item) => item.id === selected)
            if (preset) {
              update(preset.params)
              setError(null)
            }
          }}
        >
          载入
        </button>
        <button
          className="quiet-button"
          disabled={busy || selected === 'default-green'}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              setPresets(await window.api.presets.delete(selected))
              setSelected('default-green')
            } catch (error) {
              setError(String(error))
            } finally {
              setBusy(false)
            }
          }}
        >
          删除
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        <input
          className="preset-name min-w-0 flex-1"
          aria-label="预设名称"
          placeholder="输入名称保存预设"
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim() && !busy) void save()
          }}
        />
        <button
          className="quiet-button"
          disabled={busy || !name.trim()}
          onClick={() => void save()}
        >
          保存
        </button>
      </div>
      {error && (
        <p role="alert" className="panel-error">
          {error}
        </p>
      )}
    </section>
  )
}

function ExportControls(): React.JSX.Element {
  const file = useEditorStore((s) => s.currentFile)
  const count = useEditorStore((s) => s.files.length)
  const editing = useEditorStore((s) => s.editingJobId)
  const [batch, setBatch] = useState(false)
  const [cropMode, setCropMode] = useState<'scale' | 'ignore'>('scale')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = async (): Promise<void> => {
    const state = useEditorStore.getState()
    if (!state.currentFile || !state.probeInfo) return
    const params: KeyParams = {
      ...useAppStore.getState().params,
      crop: state.crop,
      trim: state.trim
    }
    const docs = batch
      ? state.files
      : state.files.filter((doc) => doc.file.path === state.currentFile!.path)
    let submitted = 0
    setBusy(true)
    setError(null)
    setMessage('')
    try {
      // Validate all trim ranges before showing a dialog or submitting any jobs.
      const requests = docs.map((doc) => {
        try {
          return {
            doc,
            params: batch ? batchParams(params, state.probeInfo!, doc.info, cropMode) : params
          }
        } catch (error) {
          throw new Error(`${doc.file.name}：${String(error)}`)
        }
      })
      const destinations = await window.api.chooseExportPaths(docs.map((doc) => doc.file.url))
      if (!destinations) return
      for (const destination of destinations) {
        const request = requests.find((item) => item.doc.file.url === destination.url)!
        await window.api.jobs.add({
          inputPath: request.doc.file.path,
          outputPath: destination.outputPath,
          params: request.params
        })
        submitted++
      }
      setMessage(`已加入 ${submitted} 个导出任务`)
      useEditorStore.setState({ editingJobId: null })
    } catch (error) {
      setError(`${submitted ? `已有 ${submitted} 个任务提交成功。` : ''}${String(error)}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="export-controls" aria-label="导出设置">
      {editing && (
        <p className="mb-3 text-[10px] leading-5 text-emerald-700">
          已恢复任务参数，调整后提交为新任务。
        </p>
      )}
      <label className="toggle-row">
        <input type="checkbox" checked={batch} onChange={(e) => setBatch(e.target.checked)} />
        <span>应用到队列中全部视频</span>
      </label>
      {batch && (
        <>
          <p className="mt-2 text-[10px] leading-5 text-zinc-600">
            全部 {count} 个已导入素材使用当前参数。
          </p>
          <select
            className="editor-select mt-2 w-full"
            aria-label="批量裁剪方式"
            value={cropMode}
            onChange={(e) => setCropMode(e.target.value as 'scale' | 'ignore')}
          >
            <option value="scale">裁剪按源尺寸比例缩放</option>
            <option value="ignore">忽略裁剪，使用完整画面</option>
          </select>
          <p className="mt-2 text-[9px] leading-4 text-zinc-500">
            时间区间按秒应用，出点截至各素材结尾。
          </p>
        </>
      )}
      <button
        className="primary-button mt-4 w-full"
        disabled={!file || busy}
        onClick={() => void submit()}
      >
        {busy ? '正在提交…' : batch ? `开始导出 · ${count} 个视频` : '开始导出'}
      </button>
      <p role="status" className="mt-2 text-[10px] leading-5 text-emerald-700">
        {message}
      </p>
      {error && (
        <p role="alert" className="panel-error">
          {error}
        </p>
      )}
    </section>
  )
}

function ExportSizeControls(): React.JSX.Element {
  const params = useAppStore((s) => s.params)
  const update = useAppStore((s) => s.updateParams)
  const info = useEditorStore((s) => s.probeInfo)
  const crop = useEditorStore((s) => s.crop)
  const width = crop ? Math.floor(crop.w / 2) * 2 : (info?.width ?? 0)
  const height = crop ? Math.floor(crop.h / 2) * 2 : (info?.height ?? 0)
  const scale = params.exportMaxEdge
    ? Math.min(1, params.exportMaxEdge / Math.max(width, height))
    : 1
  const even = (value: number): number => Math.max(2, Math.floor((value * scale) / 2) * 2)
  const dimensions = params.exportMaxEdge
    ? `${even(width)} × ${even(height)}`
    : `${width} × ${height}`
  return (
    <section className="parameter-section space-y-3" aria-label="导出大小">
      <p className="panel-label">导出大小</p>
      <label className="toggle-row">
        <span>最长边</span>
        <select
          className="editor-select ml-auto"
          aria-label="导出最长边"
          value={params.exportMaxEdge}
          onChange={(e) =>
            update({ exportMaxEdge: Number(e.target.value) as KeyParams['exportMaxEdge'] })
          }
        >
          <option value={0}>原始尺寸</option>
          <option value={1920}>1920 px</option>
          <option value={1280}>1280 px</option>
          <option value={960}>960 px · 均衡</option>
          <option value={720}>720 px · 小体积</option>
        </select>
      </label>
      <label className="toggle-row">
        <span>帧率上限</span>
        <select
          className="editor-select ml-auto"
          aria-label="导出帧率上限"
          value={params.exportFps}
          onChange={(e) => update({ exportFps: Number(e.target.value) as KeyParams['exportFps'] })}
        >
          <option value={0}>保持原帧率</option>
          {[60, 30, 24, 15].map((fps) => (
            <option key={fps} value={fps}>
              {fps} fps
            </option>
          ))}
        </select>
      </label>
      <button
        className="quiet-button w-full"
        onClick={() => update({ exportMaxEdge: 720, exportFps: 24 })}
      >
        使用小体积设置 · 720px / 24fps
      </button>
      <p className="text-[10px] leading-5 text-zinc-600">
        {info && (
          <>
            预计输出 {dimensions} · {Math.min(info.fps, params.exportFps || info.fps).toFixed(2)}{' '}
            fps。
            <br />
          </>
        )}
        等比缩小，不放大或补帧；降低尺寸 /
        帧率会减少细节或流畅度，透明通道保留。实际体积随画面变化。
      </p>
    </section>
  )
}

export function ParameterSidebar(): React.JSX.Element {
  const params = useAppStore((s) => s.params)
  const update = useAppStore((s) => s.updateParams)
  const picking = useAppStore((s) => s.picking)
  const file = useEditorStore((s) => s.currentFile)
  return (
    <aside className="parameter-sidebar" aria-label="参数面板">
      <div className="side-heading">
        <span>抠像参数</span>
        <span className="text-[9px] text-zinc-500">HEVC + ALPHA</span>
      </div>
      <div className="parameter-body">
        <PresetControls />
        <section className="parameter-section">
          <p className="panel-label">键控颜色</p>
          <div className="mt-3 flex items-center gap-2">
            <input
              type="color"
              aria-label="键控颜色"
              value={params.keyColor.replace('0x', '#')}
              onChange={(e) =>
                update({
                  keyColor: e.target.value.replace('#', '0x').toUpperCase().replace('0X', '0x')
                })
              }
            />
            <span className="font-mono text-[11px]">{params.keyColor}</span>
            <button
              className={`quiet-button ml-auto ${picking ? 'text-emerald-700' : ''}`}
              aria-pressed={picking}
              disabled={!file}
              onClick={() => useAppStore.getState().setPicking(!picking)}
            >
              {picking ? '取消取色' : '吸管取色'}
            </button>
          </div>
          {picking && (
            <p className="mt-2 text-[10px] text-emerald-700">点击原图画面取色 · Esc 取消</p>
          )}
        </section>
        <section className="parameter-section space-y-4">
          <NumberSlider name="similarity" label="相似度" min={0.01} max={1} step={0.01} />
          <NumberSlider name="blend" label="边缘混合" min={0} max={1} step={0.01} />
          <NumberSlider
            name="alphaLow"
            label="Alpha 下限"
            min={0}
            max={params.alphaHigh - 1}
            step={1}
          />
          <NumberSlider
            name="alphaHigh"
            label="Alpha 上限"
            min={params.alphaLow + 1}
            max={255}
            step={1}
          />
          <p className="text-[10px] leading-5 text-zinc-500">
            松开滑块后更新预览；数值输入按 Enter 或离开输入框后应用。
          </p>
        </section>
        <section className="parameter-section space-y-3">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={params.despill}
              onChange={(e) => update({ despill: e.target.checked })}
            />
            <span>去溢色</span>
            <select
              aria-label="去溢色类型"
              className="editor-select ml-auto"
              disabled={!params.despill}
              value={params.despillType}
              onChange={(e) => update({ despillType: e.target.value as 'green' | 'blue' })}
            >
              <option value="green">绿色</option>
              <option value="blue">蓝色</option>
            </select>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={params.keepAudio}
              onChange={(e) => update({ keepAudio: e.target.checked })}
            />
            <span>保留音频</span>
          </label>
        </section>
        <ExportSizeControls />
      </div>
      <ExportControls />
    </aside>
  )
}
