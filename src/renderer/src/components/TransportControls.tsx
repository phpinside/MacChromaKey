import type { PlayerControls } from '../editor/usePlayer'
import { formatTime } from '../editor/geometry'
import { useEditorStore } from '../store/editorStore'

export function TransportControls({
  controls,
  disabled
}: {
  controls: PlayerControls
  disabled: boolean
}): React.JSX.Element {
  const time = useEditorStore((s) => s.currentTime)
  const playing = useEditorStore((s) => s.playing)
  const info = useEditorStore((s) => s.probeInfo)!
  return (
    <section className="transport" aria-label="播放控制">
      <div className="flex items-center gap-2">
        <button
          className="transport-button"
          aria-label="后退一帧"
          title="后退一帧（←）"
          disabled={disabled}
          onClick={() => controls.step(-1)}
        >
          │◀
        </button>
        <button
          className="transport-button play-button"
          aria-label={playing ? '暂停' : '播放'}
          title="播放 / 暂停（空格）"
          disabled={disabled}
          onClick={controls.toggle}
        >
          {playing ? 'Ⅱ' : '▶'}
        </button>
        <button
          className="transport-button"
          aria-label="前进一帧"
          title="前进一帧（→）"
          disabled={disabled}
          onClick={() => controls.step(1)}
        >
          ▶│
        </button>
        <output
          className="ml-2 min-w-32 font-mono text-[11px] text-zinc-600"
          aria-label="当前播放时间"
        >
          {formatTime(time)} <span className="text-zinc-500">/ {formatTime(info.duration)}</span>
        </output>
        <span className="ml-auto text-[10px] text-zinc-500">← → 逐帧 · 空格播放</span>
      </div>
      <input
        className="seek-slider"
        type="range"
        aria-label="播放进度"
        min="0"
        max={info.duration}
        step={1 / info.fps}
        value={time}
        disabled={disabled}
        onChange={(event) => controls.seek(Number(event.target.value))}
      />
    </section>
  )
}
