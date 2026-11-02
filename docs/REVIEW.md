# 整体 Review（2026-11-02）

范围：electron-builder 产物、原生工具分发、主进程管线与队列、preload / IPC、协议、React / zustand 资源生命周期。

以下为本次发现并直接修复的问题；表中“风险”描述的是修复前行为。

| 优先级 | 问题 / 风险                                                                                               | 修复                                                                                                                                                                                                                            |
| ------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1     | builder 使用排除列表，可能将根目录的 input.mp4、测试脚本或新加入的敏感文件一起分发；两架构 DMG 文件名冲突 | electron-builder.yml 改为 out/**、package.json 与生产依赖允许列表；可选原生工具由 extraResources 单独复制；产物名包含 arch；检查实际 asar 根目录及 DMG                                                                          |
| P1     | jobs:add 接受任意绝对输入 / 输出路径，渲染层被注入后可能越过文件选择意图                                  | 输入须先由 native picker / 真实 File 导入并通过主进程文件签名复核；输出只接受保存 / 目录选择器签发的一次性授权，授权绑定源文件与输出父目录 realpath，任务保存规范化后的输出路径；重试使用已保存的主进程任务记录                 |
| P1     | IPC 只验证 webContents / 主 frame，未验证精确入口 URL                                                     | 所有固定通道同时验证窗口、主 frame 和 renderer 入口完整 URL；拒绝其他窗口、端口、路径或查询参数；保留 contextIsolation=true、sandbox=true、nodeIntegration=false、webSecurity=true，不暴露原始 ipcRenderer / Electron event     |
| P1     | 同一输出可被两个任务同时写入，可能互相覆盖                                                                | 入队及 retry 拒绝已有 queued / running 写者的输出路径；跨卷发布仍先复制到目标暂存文件，成功后 rename，不直接破坏已有输出                                                                                                        |
| P2     | localfile token 重复导入不断累积，文件被替换后旧 token 仍能读取新内容，CORS 为 *                          | 相同文件复用 token；文件变更重新授权并废弃旧 token；打开文件后用 fstat 比较 dev / inode / size / mtime；严格 URL 格式、来源 CORS；窗口销毁清空授权；Range / HEAD 行为保留                                                       |
| P2     | 预览用 base64 React 状态保留大图片，未来转 Blob 若不 revoke 会泄漏；播放器卸载依赖 GC 释放解码与文件句柄  | PNG 仅在 IPC 短暂使用 base64，显示转 Blob URL；换参数 / 模式 / 素材与卸载时恰好 revoke 一次，丢弃过期返回；video 清理时暂停、移除 src、load，并兼容 StrictMode 重建；帧回调、键盘监听、ResizeObserver、计时器、IPC 订阅均有清理 |
| P2     | 每次预览重复启动 which、版本检测与 ffprobe；缩略图缓存无上限，多个导入可能并发 fork 大量进程              | 工具解析缓存 30 秒，显式重新检测强制刷新；预览 metadata 缓存最多 32 项并按文件签名失效；缩略图最多 128 项、串行抽帧；预览限制最长边 960、解码线程 2 / 滤镜线程 1；保留 250ms 防抖及先等旧子进程 close 再启动新预览              |
| P2     | 日志虽只保留最后 50 行，readline 仍会缓存一个无限长的未换行 metadata 行                                   | stderr 改为 UTF-8 增量解析，未完成行及已完成行都限制 8192 字符，保留末尾 50 行；stdout 仍有字节上限、进程超时与取消清理                                                                                                         |
| P2     | 频繁进度导致整个 JSON（含缩略图）每 200ms 重写，并使所有已完成任务卡片反复渲染                            | 进度存盘合并为 2 秒，最终状态 / 管理操作仍立即等待落盘，UI 事件保留 200ms；复用未变化的 job 对象并 memo 卡片，仅运行任务接收时钟更新                                                                                            |
| P2     | 本地伪装视频可被 FFmpeg 自动识别为引用网络资源的容器 / 播放列表；生产 CSP 包含开发 WebSocket 放行         | ffmpeg / ffprobe 输入限制 file,pipe 协议；生产 CSP 不放行 ws / 外部网络，只允许本地应用资源、授权媒体及预览 Blob；开发 Vite 才注入 nonce 和本地 HMR WebSocket；拒绝未使用的 renderer 权限请求                                   |
| P2     | ad-hoc + hardened runtime 的 Electron 框架无 Team ID，缺少权限会导致签名产物无法加载框架                  | 本地签名 entitlements 明确允许 library validation 例外，移除模板中的 DYLD 环境变量放行；实际运行两个架构产物验证。正式 Developer ID 分发时需要重新复核权限并配置公证                                                            |

## 回归检查

- 单元测试：精确入口 URL、输出授权一次性使用 / 父目录符号链接重定向、源文件替换、协议 fstat 校验、Blob 幂等释放、超长 stderr 行、工具资源目录优先级、重复输出写者、未变化任务引用复用，以及原有滤镜 / 裁剪 / 队列 / HEVC Alpha 校验。
- Electron smoke：真实文件拖入、Range / CORS、canvas 吸管、FFmpeg 透明帧与蒙版、Blob 创建 / revoke 配对、未授权输入 / 输出与不可信窗口拒绝、任务操作、磁盘错误、确认退出清理。也使用 Vite 开发模式验证 React StrictMode。
- 打包检查：两份 DMG 的完整性、Mach-O 架构、codesign 严格校验、asar 允许列表。真实 .app 用独立 user-data-dir 验证启动、工具检测、IPC、真实 File 导入、localfile 视频和 FFmpeg Blob 预览；在 Apple Silicon 上运行 x64 使用 Rosetta，不能替代原生 Intel 硬件验收。

## 剩余边界

- 这是本地开发产物，ad-hoc 签名不能替代 Developer ID / Apple 公证；没有上传或发布安装包。
- FFmpeg 默认由用户安装，avconvert 依赖系统预设；未来放入 resources/bin 的工具必须匹配目标架构、具备执行权限并能独立运行。
- source stat 与子进程再次打开文件之间仍存在 OS 级竞态；协议读取已用打开后的 fstat 防止替换。这里不是对同一用户恶意本地进程的隔离沙箱。
- JSON / 全量 IPC 快照与内存中的素材、历史任务仍随用户保留的记录数量增长；本次降低了写盘和重渲染成本，但没有引入数据库、分页或虚拟列表。极大历史列表可清除已结束任务。
- 缓存按文件签名失效；工具被替换后可点“重新检测”。空间预算为保守估算，不能预留真实磁盘块或阻止其他程序写盘。原生编码器 / macOS 系统组件的内部内存不由 React Blob 管理。

## 本机验收结果

- npm run lint、TypeScript / Vite 构建、91 项测试通过。
- 生产 Electron smoke 与 Vite / StrictMode smoke 通过；包含实际 FFmpeg / avconvert 管线、授权拒绝、Blob 释放和退出清理。
- arm64 / x64 DMG 已构建，Mach-O 架构、codesign --deep --strict、hdiutil verify 与 asar 根目录允许列表均已检查。
- 打包应用启动、独立用户目录、系统工具、真实磁盘 File 导入、localfile 播放、FFmpeg Blob 预览均通过；x64 在 Apple Silicon + Rosetta 上测试。首次 Rosetta 加载动态库超过原 25 秒启动超时，测试对 x64 留出 60 秒，不将其误报为主进程代码失败。
- 未上传安装包，未修改实际用户的任务 / 预设 / 设置，也未内置 FFmpeg 命令行工具。

## 输出大小优化补充

- 增加可选最长边 / 帧率上限和一键 720px / 24fps，默认仍为原尺寸 / 原帧率。主进程严格验证允许值；历史任务 / 预设缺少新字段时迁移为 0，不破坏原导出行为。
- crop 仍基于源像素，先裁剪再等比缩小到偶数尺寸；缩放后 setsar=1，修复 Apple 按 FFmpeg 保留的非方形像素比例再次调整宽度的问题（720×404 曾变成 718×404）。
- fps 使用前置 fps 滤镜与 passthrough 时间戳，修复输出端帧率同步在片尾补帧导致短片变长的问题；低帧率源不会提高帧率。帧率单独变化不会重复生成 PNG 或创建新 Blob。
- 空间预检按实际缩放尺寸和帧率计算；任务、批量、预设、重新编辑、CLI 共享同一参数。保持 ffmpeg → avconvert 与最终 Alpha 层校验。
- 100 项测试、类型检查、lint、生产构建与 Electron smoke 通过；新增真实 960×540 / 30fps → 720×404 / 15fps 的 HEVC Alpha 导出检查，以及 UI / IPC / 预设保存和不重复预览的检查。
- 仓库样片实测：原设置 10.28 MiB，960px / 24fps 为 6.62 MiB，720px / 24fps 为 4.86 MiB；完整管线均校验 Alpha。仅切换 Apple 1080p Alpha 预设输出字节数与最高质量相同，未采用这一无效优化。

## 中文名称、首次说明与明亮界面

- 产品名称更新为「苹果手机透明视频生成器 V1.0」，窗口、系统通知和安装包统一使用中文。首屏介绍明确在 Mac 上安装制作、在苹果设备的兼容播放环境中使用。
- 首次打开显示可滚动的使用说明，关闭后记住；右上角保留「使用说明」。原生 dialog 限制焦点、支持 Escape，关闭后恢复入口焦点；960×640 下主要按钮仍可见。
- 默认明亮模式，主窗口和 Electron 原生主题都固定 light；白色面板、浅灰绿色工作区、深色文字、绿色主按钮、浅色透明棋盘格。视频像素与取色逻辑不参与 UI 配色变更。
- 重命名继续使用既有 MacChromaKey 用户数据目录，同时尊重显式 user-data-dir 与 app.setPath 测试目录；新增回归测试与启动断言。早期验证发现一次测试目录被覆盖，读取并重新保存了已完成任务列表，随后已修正隔离逻辑；后续测试使用独立临时目录。
- 102 项测试、类型检查、lint 和生产 Electron smoke 通过；包含首次显示 / 关闭记忆 / 重开说明、真实 Escape、焦点恢复、小窗口排版、默认 light 及原有真实透明视频管线。

## 专属应用图标

- 使用内置 imagegen 生成绿色视频画面、揭开绿幕露出透明棋盘格与白色播放按钮的图标，源图与最终提示词保存在 build/chroma-icon-master.png / chroma-icon.prompt.md。
- 使用 macOS sips / iconutil 制备 16–1024px 的普通 / Retina 图标表示，保留 PNG Alpha，封装为独立的 chroma-icon.icns。模板图标保留，mac.icon 明确选择新文件。
- 标题栏、首次说明和 Dock 使用同一图标；主进程 PNG 通过 electron-vite 的 asset 导入随产物携带，避免运行时依赖源码目录。
- 已检查 PNG 尺寸 / Alpha、ICNS 各尺寸数据与生产构建；Electron smoke 通过。打包检查新增包内 ICNS 与源文件逐字节比较，以及界面图标实际加载检查。

## 抠像滑块结束后提交

- similarity、blend、alphaLow、alphaHigh 的拖动值保留在组件草稿中，松开后才写入 zustand 并触发预览。拖动期间保留原预览，不产生新的 FFmpeg 请求。
- pointer capture 支持拖出控件后松开；数字框切换到滑块时不提前提交共享草稿。Chromium 原生滑块内部转移 capture 时仍按拖动处理，取消手势则恢复已提交值。
- 键盘调整松键后提交；数值输入按 Enter / 失焦后提交，校验范围并取步长。未改变数值不重复写入状态或生成预览。
- 真实 Electron 鼠标检查覆盖按住超过 250ms 仍无预览变化、控件数值联动、拖到控件外松开仅生成一帧；键盘松键、数值提交、原有批量导出和 Blob 清理也通过。
