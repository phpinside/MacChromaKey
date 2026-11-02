import { useState } from 'react'
import { useEditorStore } from '../store/editorStore'
import { fullCrop, type Aspect, type Crop } from '../editor/geometry'

function PixelInput({ field, value }: { field: keyof Crop; value: number }): React.JSX.Element {
  const [draft, setDraft] = useState<{ source: number; text: string } | null>(null)
  const setField = useEditorStore((s) => s.setCropField)
  return (
    <label className="pixel-field">
      <span>{field.toUpperCase()}</span>
      <input
        type="number"
        aria-label={`裁剪 ${field}`}
        value={draft?.source === value ? draft.text : String(value)}
        step="1"
        onChange={(event) => {
          setDraft({ source: value, text: event.target.value })
          if (event.target.value !== '') setField(field, Number(event.target.value))
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
    </label>
  )
}

export function CropControls(): React.JSX.Element | null {
  const info = useEditorStore((s) => s.probeInfo)
  const crop = useEditorStore((s) => s.crop)
  const aspect = useEditorStore((s) => s.aspect)
  const setAspect = useEditorStore((s) => s.setAspect)
  const reset = useEditorStore((s) => s.resetCrop)
  if (!info) return null
  const area = crop ?? fullCrop(info)
  return (
    <section className="crop-controls" aria-label="裁剪数值">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[11px] font-medium text-zinc-600">裁剪</span>
        {(['x', 'y', 'w', 'h'] as const).map((field) => (
          <PixelInput key={field} field={field} value={area[field]} />
        ))}
        <span className="text-[10px] text-zinc-500">源像素</span>
        <select
          aria-label="裁剪宽高比"
          className="editor-select ml-auto"
          value={aspect}
          onChange={(event) => setAspect(event.target.value as Aspect)}
        >
          <option value="free">自由比例</option>
          <option value="16:9">16:9</option>
          <option value="1:1">1:1</option>
          <option value="9:16">9:16</option>
        </select>
        <button className="quiet-button" onClick={reset}>
          重置 / 全画面
        </button>
      </div>
    </section>
  )
}
