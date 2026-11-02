import { useEffect, useRef } from 'react'
import { PRODUCT } from '../../../shared/product'
import appIcon from '../assets/app-icon.png'

export function GuideDialog({
  firstRun,
  onClose
}: {
  firstRun: boolean
  onClose: () => void
}): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const startButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const node = dialog.current!
    const previousFocus = document.activeElement
    node.showModal()
    startButton.current?.focus({ preventScroll: true })
    return () => {
      node.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])
  return (
    <dialog
      ref={dialog}
      className="settings-dialog guide-dialog"
      aria-labelledby="guide-title"
      aria-describedby="guide-description"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className="guide-layout">
        <header className="guide-header">
          <span className="text-[11px] font-medium text-emerald-700">
            {firstRun ? '欢迎使用' : '功能与使用说明'}
          </span>
          <button className="quiet-button" aria-label="关闭使用说明" onClick={onClose}>
            关闭
          </button>
        </header>
        <div className="guide-content">
          <div className="flex flex-wrap items-center gap-3">
            <img src={appIcon} alt="" aria-hidden="true" className="h-11 w-11 object-contain" />
            <h2 id="guide-title" className="text-xl font-semibold tracking-tight text-zinc-900">
              {PRODUCT.name}
            </h2>
            <span className="preview-badge">{PRODUCT.version}</span>
          </div>
          <p className="mt-3 text-base text-emerald-700">{PRODUCT.tagline}</p>
          <p id="guide-description" className="mt-3 text-xs leading-6 text-zinc-600">
            {PRODUCT.description}
          </p>
          <p className="guide-platform">
            安装环境：macOS 13 及以上 · Apple 芯片 / Intel Mac
            <br />
            制作完成后，可将视频用于 iPhone、iPad 或 Mac 上支持透明视频的 Safari 网页或应用。
          </p>
          <h3 className="guide-section-title">三步制作透明视频</h3>
          <ol className="guide-steps">
            {[
              ['导入绿幕视频', '拖入或点击选择 MP4、MOV、MKV 文件。素材在本机处理，无需上传。'],
              [
                '裁剪与去除背景',
                '裁剪画面、选取时间区间，再用吸管取色和参数调节，去掉绿幕并修整边缘。'
              ],
              [
                '导出透明动画',
                '选择保存位置，导出带透明通道的 MOV 视频。任务在后台排队执行，可查看进度。'
              ]
            ].map(([title, text], index) => (
              <li key={title}>
                <span className="guide-step-number">{index + 1}</span>
                <div>
                  <h4 className="text-xs font-medium text-zinc-800">{title}</h4>
                  <p className="mt-1 text-[11px] leading-5 text-zinc-600">{text}</p>
                </div>
              </li>
            ))}
          </ol>
          <h3 className="guide-section-title">这些功能能帮到你</h3>
          <dl className="guide-features">
            <div>
              <dt>边调边看</dt>
              <dd>
                切换原图、抠像结果和 Alpha 蒙版（白色保留、黑色透明），检查透明区域与人物边缘。
              </dd>
            </div>
            <div>
              <dt>灵活裁剪</dt>
              <dd>拖动裁剪框或输入精确尺寸，设置入点 / 出点，只导出需要的片段。</dd>
            </div>
            <div>
              <dt>减小体积</dt>
              <dd>调整导出尺寸与帧率，或一键使用小体积设置；可按需保留音频。</dd>
            </div>
            <div>
              <dt>重复制作更省事</dt>
              <dd>保存常用参数预设、批量提交视频，失败后可查看日志并重试。</dd>
            </div>
          </dl>
          <section className="guide-notes" aria-label="开始前的小提示">
            <h3 className="text-xs font-medium text-zinc-700">开始前的小提示</h3>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] leading-5 text-zinc-600">
              <li>
                首次启动会检测工具，缺少 FFmpeg 时自动安装；等待顶部显示「本机环境就绪」后开始制作。
              </li>
              <li>选择光线均匀、主体与绿幕颜色区分明显的素材，通常能获得更干净的边缘。</li>
              <li>
                导出格式为 HEVC with Alpha（.mov）。透明效果取决于播放环境，普通播放器可能显示黑底。
              </li>
              <li>转换时会生成较大的临时文件，请留足磁盘空间；降低尺寸 / 帧率可减小输出体积。</li>
            </ul>
          </section>
        </div>
        <footer className="guide-footer">
          <p className="text-[11px] leading-5 text-zinc-600">
            随时点击右上角「使用说明」，即可再次查看。
          </p>
          <button ref={startButton} className="primary-button shrink-0" onClick={onClose}>
            {firstRun ? '开始制作' : '返回工作台'}
          </button>
        </footer>
      </div>
    </dialog>
  )
}
