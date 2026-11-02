# 苹果手机透明视频生成器（MacChromaKey）V1.0

**把绿幕视频，变成透明背景动画。**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0--only-blue)](./LICENSE) ![Platform: macOS 13+](https://img.shields.io/badge/platform-macOS%2013%2B-lightgrey) ![Built with Electron](https://img.shields.io/badge/Electron%20%2B%20React-44%20%2F%2019-47848F)

[English](./README.en.md) | 简体中文

在 Mac 上导入 MP4 / MOV / MKV 绿幕视频，通过裁剪画面、去除背景和调整边缘，制作可在苹果设备的兼容播放器中使用的透明视频动画。所有处理都在本机完成，无需上传素材。

- 导入与裁剪：拖拽导入、精确裁剪、选取时间区间。
- 抠像与预览：吸管取色、边缘与去溢色调节，查看原图、抠像结果和 Alpha 蒙版。
- 导出与批量：输出带透明通道的 MOV，可调整尺寸 / 帧率减小体积，支持参数预设、批量队列、进度和失败重试。

仅支持 **macOS 13+** 安装使用，兼容 Apple 芯片与 Intel Mac。输出为 HEVC with Alpha，面向 iPhone / iPad / Mac 上支持该格式的 Safari 网页或应用；透明效果取决于播放环境，普通播放器可能显示黑底。

默认采用明亮的白天模式：白色面板、浅灰绿色工作区、深色文字与绿色操作按钮；原生文件对话框和首次启动说明保持同一明亮风格。首次打开会显示欢迎与使用说明，关闭后自动记住；以后可通过窗口右上角「使用说明」随时重看。窗口、通知与安装包使用中文名称，应用版本为 1.0.0（界面显示 V1.0）。为兼容升级，内部项目名 / appId 与原有 MacChromaKey 用户数据目录保持一致，已有任务、预设和设置继续保留。

本地 macOS 绿幕视频工作台，基于 [electron-vite 官方 react-ts 模板](https://electron-vite.org/guide/)，使用 React、TypeScript、Tailwind CSS 和 zustand。

已实现三栏编辑器、工具检测、安全的视频导入、源像素裁剪、时间区间、抠像参数与吸管、FFmpeg 单帧预览、预设、单文件 / 批量 HEVC Alpha 导出，以及带缩略图、日志和管理操作的持久任务列表与设置页。

## 开发启动

仅支持 **macOS 13+**（Apple Silicon arm64 或 Intel x64），需要 Node.js 22.12+（或 24+）与 npm。导出还要求系统 avconvert 包含 HEVC Alpha 预设。

```bash
npm ci
npm run dev
```

`npm run dev` 同时启动 Vite 和 Electron。请使用 Electron 桌面窗口验证；直接打开 Vite 的浏览器地址没有 preload 桥接。

启动时自动检测运行环境。若缺少 ffmpeg 或 ffprobe，软件会按当前 Mac 架构自动下载安装该发行源提供的最新稳定版，并在顶部显示下载、验证、启用进度；可以取消或失败后重试。已存在可用工具时直接使用，不自动升级或改动系统安装。也可手动在终端安装：

```bash
brew install ffmpeg
```

avconvert 由 macOS 提供。它没有独立版本参数，状态中显示 macOS 版本，并额外确认 `PresetHEVCHighestQualityWithAlpha` 可用。其 `--help` 返回非零退出码属于工具的正常行为。

安装依赖时如本机 npm 镜像不可用，可运行 `npm install --registry=https://registry.npmjs.org`。

## macOS DMG 打包

应用使用专属绿色图标：绿幕画面揭开后露出透明棋盘格，搭配白色播放按钮。设计由内置 imagegen 生成，[生成记录与提示词](build/chroma-icon.prompt.md) 随项目保留。源图为 `build/chroma-icon-master.png`，交付的 1024px PNG / macOS ICNS 为 `build/chroma-icon.png`、`build/chroma-icon.icns`；界面标识与开发 Dock 图标也使用同一设计。

若更新源图，在 macOS 运行 `npm run build:icons` 重新生成各尺寸，再正常打包。脚本仅使用系统 sips / iconutil，保留 Alpha，不添加依赖。模板图标仍保留，打包明确选择新 ICNS。

```bash
npm ci
npm run build:mac          # 一次生成 arm64、x64 两份 DMG
# 或单独构建
npm run build:mac:arm64
npm run build:mac:x64
# 仅生成 .app 目录，便于检查
npm run build:unpack
```

产物为 `dist/苹果手机透明视频生成器-1.0.0-arm64.dmg`、`dist/苹果手机透明视频生成器-1.0.0-x64.dmg`（版本随 package.json 更新）。打开对应架构 DMG，将中文名称的应用拖入 Applications。两份安装包不捆绑 ffmpeg / ffprobe 命令行工具；缺失时首次启动会自动联网安装，也可预先运行 `brew install ffmpeg`。Intel 版本应在 Intel Mac 上验证；Apple Silicon 可使用已安装的 Rosetta 进行补充测试。

当前使用 **ad-hoc 本地签名，未做 Apple 公证**，用于本地验证；这不等同于 Developer ID 发行签名，下载后可能被 Gatekeeper 拦截。正式对外分发前需配置自己的 Developer ID、签名权限及公证流程（参考 [electron-builder v26 macOS 配置](https://www.electron.build/v26/docs/mac/)）。ad-hoc Electron 框架没有 Team ID，本地 entitlements 包含 disable-library-validation；正式签名时应另行复核并收紧权限。

打包采用 out/** 与 package.json 的允许列表及生产依赖，只通过 extraResources 复制明确指定的可选工具，不会带入源码、测试、input.mp4、.env 或项目文档；原生可执行文件放在 app.asar 之外。CLI 固定 `--publish never`，不会上传产物。

```bash
npm run test:package       # 构建后：两架构、签名、DMG 完整性、asar 内容及真实 .app 启动
```

该检查使用独立的 `--user-data-dir`，验证打包后的工具检测、导入、localfile 播放、FFmpeg 单帧预览，不读写现有用户任务。Apple Silicon 上测试 x64 启动需要 Rosetta。源代码 / Electron 原生集成检查见下方检查命令。

## FFmpeg 分发与查找顺序

本版本优先复用已有可用的 FFmpeg；缺失时自动安装原生命令行工具，不使用 FFmpeg.wasm，媒体始终在本机处理。`resources/bin/README.md` 为预留说明，目前没有内置可执行文件。

ffmpeg、ffprobe 各自按以下顺序检查可执行权限和版本，失败后继续回退：

1. 开发时 `resources/bin/<arch>/ffmpeg`、`ffprobe`；安装后为 `Contents/Resources/bin/<arch>/`。
2. 开发时 `resources/bin/ffmpeg`、`ffprobe`；安装后为 `Contents/Resources/bin/`。
3. 应用自动安装的私有目录：`~/Library/Application Support/MacChromaKey/tools/<arch>/<version>-<uuid>/`（通过 `current.json` 选择已验证的版本）。
4. `/opt/homebrew/bin`、`/usr/local/bin`。
5. `/usr/bin/which` 在当前 PATH 中找到的位置。

`<arch>` 为 arm64 或 x64。以后内置时，应成对放入对应架构、具有执行权限且不依赖开发机 Homebrew 动态库的二进制；extraResources 已配置复制匹配架构子目录及公共位置。公共位置的二进制需要支持对应目标架构，优先推荐使用架构子目录。`avconvert` 始终只查 `/usr/bin/avconvert`，它是 macOS 系统组件，不捆绑、不下载，也没有跨平台替代实现。

自动安装从 [Martin Riedl 的 FFmpeg Build Server](https://ffmpeg.martin-riedl.de/) 的 latest release 接口动态选择稳定版本（arm64 / Intel amd64），ffmpeg 与 ffprobe 固定为同一发行版。此为第三方预编译发行源；[FFmpeg 官方](https://ffmpeg.org/download.html) 本身发布源代码。下载仅允许此源的 HTTPS 地址，验证 SHA-256、Apple Developer ID 签名与发行者 Team ID、架构、版本及所需滤镜 / 编码器后，才原子启用整对工具；取消、校验失败或退出均清理临时文件。无需 sudo / Homebrew，不修改系统目录。安装状态 IPC 只接受开始、取消、查询，不接受渲染进程提供的 URL、路径或命令。失败 / 取消后不循环自动重试，用户可点「重试安装」；「重新检测」可识别后来手动安装的工具。

联网仅用于首次缺失时下载工具，不上传媒体。发行源可用性和速度取决于网络；该源已宣布 2027 年 1 月停止 Intel release 构建，届时 Intel 的“最新”指该源仍提供的最新兼容稳定版。有效工具不会被静默升级；如需升级可自行使用 Homebrew 管理。

解析结果短缓存 30 秒以减少频繁预览时启动 which / -version 进程；顶部「重新检测」强制刷新。GUI 不依赖交互式 shell PATH，因此优先使用明确的资源目录与 Homebrew 路径。

## 运行导出管线

> 仓库不含测试素材：请自备一段绿幕视频，重命名为 `input.mp4` 放到项目根目录再运行以下示例（`input.mp4` 已列入 `.gitignore`，不会被提交）。

```bash
npx tsx scripts/test-pipeline.ts input.mp4 output.mov
# 等价命令
npm run test:pipeline -- input.mp4 output.mov
# 小体积透明视频：等比缩到最长边 720px、帧率最多 24fps
npx tsx scripts/test-pipeline.ts input.mp4 output_compact.mov --max-edge 720 --fps 24
```

已安装 tsx 的环境也可以直接运行 `tsx scripts/test-pipeline.ts input.mp4 output.mov`。脚本使用 `src/shared/types.ts` 中的默认参数（默认不保留音频）。Ctrl+C 会取消任务；异常退出返回非零状态码。

导出分两阶段：ffmpeg 抠像占 0–90%，avconvert 阶段保持 90% 并显示「Apple 转码中」，通过输出校验后才报告 100%。ffmpeg 进度解析自 `out_time_us`，分母使用源视频时长或 `trim.end - trim.start`。

核心入口为 `runExport(input, output, params, onProgress, signal)`，进度回调接收 `{ stage, progress, message }`，其中 `progress` 范围为 0–1。返回值包含输出路径、尺寸、时长、帧率、音频状态、编码与 Alpha 层 ID。该入口只执行单次管线，CLI 直接调用；应用内导出通过下述主进程任务队列调度，避免重复排队或并发限制冲突。

Electron 中临时文件默认放在 `app.getPath('temp')`；tsx 的 Node 环境使用 `os.tmpdir()`。设置页可指定其他临时目录，对随后启动的任务生效。每个任务使用独立目录，成功、失败、取消均清理；取消先发送 SIGTERM，3 秒未退出再发送 SIGKILL，等子进程关闭后删除文件。现有目标文件在编码与校验阶段保持原样，通过校验后才发布新文件。临时目录跨磁盘时先将通过校验的文件复制到目标目录的隐藏暂存文件，再 rename 发布；复制失败或取消会删除该暂存文件，保留原输出。avconvert 始终带 `--replace`。

`probe(input)` 使用 ffprobe JSON 返回 `{ width, height, duration, fps, hasAudio }`。`buildFilter(params, source)`、`buildExportArgs(input, tempOut, params, source)` 与 `buildPreviewArgs(input, time, params, source)` 共用唯一滤镜链。设置 crop 时必须传入 probe 获得的尺寸，先将 x/y/w/h 向下规范为偶数，再验证边界；源尺寸不明时不会跳过检查。裁剪坐标基于原始源像素，ffmpeg 输入禁用自动旋转以保持坐标一致。trim 为源视频中的绝对秒数。启用 keepAudio 时，中间文件使用 PCM s16le 音频，最终音频由 avconvert 编码。

预览使用源视频中的绝对时间 `time`，忽略导出 trim / 帧率上限，输出单帧 RGBA PNG 至 stdout（`image2pipe`），无音频。`buildPreviewArgs(input, time, params, source, mode)` 的 mode 为 `keyed`（默认）或 `alpha`；两者复用同一抠像链，在 crop 之后等比 scale（不放大小素材），预览最长边不超过 960px，选择更小导出尺寸时遵循导出上限，最终输出 format=rgba；alpha 模式在最后插入 alphaextract。默认导出保持原分辨率与帧率；选择尺寸上限时才加入导出 scale，缩放尺寸取偶数并设置方形像素，避免 Apple 因像素比例再次缩放。

## 减小透明 MOV 体积

右侧「导出大小」可选最长边 **1920 / 1280 / 960 / 720px** 和帧率上限 **60 / 30 / 24 / 15fps**。「使用小体积设置」一键设为 **720px / 24fps**；竖屏 720×1280 会缩到 404×720，横屏 1920×1080 会缩到 720×404。尺寸与帧率只会降低，不放大小视频或提高低帧率素材的帧率。帧率转换在抠像前执行，减少无用帧的处理；预览仍可定位源视频任意时间。

新增参数 `exportMaxEdge`、`exportFps` 的 `0` 表示保持源尺寸 / 帧率；原有任务与 JSON 预设缺少这两个字段时按 `0` 兼容。设置随任务与参数预设保存，也支持批量导出与重新编辑提交。源像素 crop 不受输出尺寸影响，磁盘预检会按缩放后的尺寸和帧率估算中间文件空间。

最终仍使用 `PresetHEVCHighestQualityWithAlpha`，保留并校验 Apple Alpha 层。MP4 与 MOV 是容器，体积差异主要取决于视频码率、透明层、尺寸和帧率。源 MP4 已高度压缩时，透明 MOV 即使减小分辨率也可能比它大；更低尺寸会损失细节，更低帧率会降低流畅度，不能保证固定压到 2MB。

`avconvert --help` 没有开放目标码率 / CRF 参数；本机实测换成 `PresetHEVC1920x1080WithAlpha` 对 720×1280 样片体积几乎无改善，因此没有把普通 HEVC 预设当作压缩方案（会丢失透明度）。精确设置基底码率和 Alpha 质量需要 Apple 的 [AVAssetWriter / VideoToolbox 编码接口](https://developer.apple.com/videos/play/wwdc2019/506/)，当前仍保持原有 ffmpeg → avconvert 架构。

开发时的测试素材 `input.mp4`（2.11 MiB、720×1280、30fps、约 13.93 秒，未随仓库分发）用默认抠像参数、不保留音频的实测如下；不同素材、参数或 macOS 编码器版本结果会不同：

| 导出设置           | 最终尺寸 / 帧率     | 文件大小  | 相对原设置 |
| ------------------ | ------------------- | --------- | ---------- |
| 原始               | 720×1280 / 约 30fps | 10.28 MiB | —          |
| 最长边 960 / 24fps | 540×960 / 约 24fps  | 6.62 MiB  | 减少约 36% |
| 最长边 720 / 24fps | 404×720 / 约 24fps  | 4.86 MiB  | 减少约 53% |

两种缩小输出均通过完整导出管线的 HEVC / Apple Alpha 层校验；降低帧率后的时长可能在一个输出帧附近取整，不表示原片被大幅裁短。

Apple HEVC Alpha 将透明度存为辅助 HEVC 层；当前 ffprobe 7.1.1 对这类文件仍报告基底像素格式 `yuv420p`。根据已确认的兼容方式，最终校验使用 ffprobe 确认 `hevc` / `hvc1`，读取 hvcC 配置和第一个视频 packet，检查启用的 Alpha SEI、非零层 SPS/PPS，以及实际基底层和 Alpha 层图像 NAL 数据；普通无 Alpha 的 HEVC 会被拒绝。该结构依据 [Apple HEVC Video with Alpha 规范](https://developer.apple.com/av-foundation/HEVC-Video-with-Alpha-Interoperability-Profile.pdf)，不会仅因编码名是 HEVC 就视为成功。

## 任务队列与 IPC

主进程启动时打开 `app.getPath('userData')/jobs.json`，使用 `JobQueue.open({ filePath, concurrency: 1, onDone })` 创建队列。任务列表通过同目录临时文件和 rename 原子保存，写操作串行执行，进度存盘合并至 2 秒一次（避免大列表高频重写），IPC 快照仍最多每 200 ms 一次；入队、状态切换和管理操作会等待保存。存盘失败会停止调度新任务，并通过状态中的 `persistenceError` 返回错误。无效的历史文件会报错并保留原文件，不会静默覆盖。

任务使用统一的 `Job` 类型：`status` 为 `queued | running | done | failed | canceled`，`stage` 为 `keying | apple-transcode | verifying`，`progress` 为 **0–100**。`startedAt` / `finishedAt` 始终存在，未发生时为 null，发生后为 ISO 时间。底层管线仍使用 0–1 进度，队列负责映射；只有输出校验、发布和临时文件清理均完成后才标记 `done / 100`。

重启时，原来的 queued / running 任务改为 failed，error 为「应用中断」，补充 finishedAt；已完成、失败和已取消的记录保留。退出应用会停止调度、终止正在运行的子进程、等待清理和保存，未完成任务在下次启动时按中断恢复。关闭 macOS 窗口不会停止后台队列。

渲染进程只使用 preload 暴露的固定 API。inputPath 必须是已导入源视频的主进程规范路径；outputPath 必须来自 chooseExportPaths 原生对话框的一次性授权，不能直接任意写入绝对路径：

```ts
const unsubscribe = window.api.jobs.onChanged((snapshot) => {
  // 完整列表快照，最多每 200 ms 推送一次；不暴露 Electron event。
  console.table(snapshot.jobs)
})
const snapshot = await window.api.jobs.list()
const destinations = await window.api.chooseExportPaths([video.url])
if (!destinations) return // 用户取消
const job = await window.api.jobs.add({
  inputPath: video.path,
  outputPath: destinations[0].outputPath,
  params
})
await window.api.jobs.cancel(job.id)
await window.api.jobs.retry(job.id)
await window.api.jobs.remove(job.id)
await window.api.jobs.clearFinished()
await window.api.jobs.setConcurrency(2)
await window.api.jobs.showOutput(completedJobId)
await window.api.jobs.copyLog(failedJobId)
const editing = await window.api.jobs.edit(job.id) // {video, info, params}；取消定位文件返回 null
const settings = await window.api.settings.get()
await window.api.settings.save({ ...settings, concurrency: 2 })
unsubscribe()
```

取消排队任务立即生效；取消运行任务会等子进程退出及临时文件清理后再返回 canceled。成功发布输出与取消发生竞争时，已成功完成的导出保留 done。retry 仅允许 failed / canceled，同 ID 移到队尾、重置进度及时间；remove 拒绝运行中的任务，需先 await cancel；clearFinished 仅移除 done / failed / canceled。并发数默认 1，设置页支持 1–8，保存到 userData/settings.json 并在重启时恢复。降低并发不会中断已有运行任务，只影响后续启动。

IPC 通道集中在 `src/shared/types.ts`：`jobs:list/add/cancel/retry/remove/clear-finished/set-concurrency/show-output/changed`。主进程验证窗口、主 frame、精确 renderer URL 及任务参数；新任务需已导入视频与对话框输出授权，相同输出路径不允许并发写入。Finder API 按已完成任务 ID 查询主进程记录，检查输出文件存在，再调用 `shell.showItemInFolder`。`jobsStore.ts` 自动接收快照，并按 revision 防止旧的列表响应覆盖新状态；左侧任务卡片提供操作入口，顶部实时显示运行和排队数量。

任务成功后使用 Electron Notification 通知，点击通知可在 Finder 中显示输出；失败和取消不发送完成通知，通知失败不改变导出结果。macOS 系统是否显示通知还取决于系统通知权限及应用签名；当前 Electron 的未签名应用可能触发 failed 事件，见 [Electron Notification 文档](https://www.electronjs.org/docs/latest/api/notification)。

## 手动验证

1. 运行 `npm run dev`，确认 Electron 窗口默认为 1280×800，默认明亮模式；首次启动显示中文使用说明，关闭后可从右上角重新打开。左上角为 macOS 内嵌窗口按钮，拖动标题栏能移动窗口。
2. 顶部自动检测 ffmpeg、ffprobe、avconvert。展开「路径与版本」查看真实结果，或悬停每个工具查看详情。「重新检测」可在安装工具后刷新。
3. 工具缺失或无法执行时，顶部显示红色提示；ffmpeg / ffprobe 缺失会自动选择当前架构的最新稳定版，显示安装进度、取消与重试，并保留 `brew install ffmpeg` 作为手动方案。具体探测顺序见上文；avconvert 仅使用 `/usr/bin/avconvert`。
4. 点击「导入视频」或拖入视频到中间预览区（MP4 / MOV / MKV）。导入后由主进程 probe 显示分辨率、时长和帧率；左侧列出已导入素材及已有任务。包含中文、空格、`#` 的文件名同样支持。
5. 按 F12 或 Option+Command+I 打开开发者工具。Network 中过滤 `localfile`，拖动进度条查看媒体请求（缓存较小视频时可能无需再次请求）。请求使用不透明的授权 URL；Range 响应为 `206`，并包含 `Accept-Ranges: bytes`、`Content-Range` 和正确的 `Content-Length`。
6. DevTools 中运行 `await window.api.detectTools()` 查看类型化 IPC 返回数据。`typeof window.require` 应为 `"undefined"`。

MOV、MKV、AVI 等容器中的具体编码可能不受 Chromium 播放器支持，界面会提示播放失败。即使 Chromium 无法播放源编码，仍可使用 FFmpeg 在当前时间生成抠像 / Alpha 单帧预览；吸管依赖原片可解码。

## 中间预览区

- 播放使用 localfile://，自定义控制条提供播放/暂停、进度、当前/总时长和逐帧按钮。空格播放/暂停，← / → 按 probe 帧率前后移动一帧，边界停在首帧/末帧。数值输入和选择框中不抢占文本编辑按键。
- 裁剪框可拖动，八个手柄可缩放，使用 pointer capture 保持指针移出手柄时仍可拖动。`editorStore.crop` 始终保存源视频像素坐标；显示位置使用 object-fit: contain 的缩放比例和上下/左右黑边偏移换算，窗口改变大小不修改源坐标。
- X/Y/W/H 数值与画框双向联动，所有值限制在源视频范围内；「重置 / 全画面」清除裁剪。比例可选自由、16:9、1:1、9:16。编辑坐标按整数像素取整，比例锁定允许至多约一个像素的取整误差；提交到现有队列时再按原有规则规范为偶数。
- 进度条下方为独立的入点/出点双滑块，点轨道会移动较近的端点。I / O 或点击相应按钮设为当前时间，滑块也支持左右键逐帧微调（Shift 为十帧）。始终保留至少一帧区间，端点不能交叉；「全时长」清除 trim。播放进度用于浏览整个源文件，区间仅决定后续导出范围。
- 当前文件、probe 信息、crop、trim、宽高比和播放状态存入 zustand `editorStore`。切换已导入素材会恢复各自裁剪与时间区间；本步编辑状态仅保留在内存中。

拖拽路径仅在 preload 中通过 [Electron webUtils.getPathForFile](https://www.electronjs.org/docs/latest/api/web-utils) 从真实磁盘 File 获取，再由主进程检查扩展名并签发授权 URL。probe IPC 仅接受已授权的 localfile URL，不接受任意文件路径；协议在打开文件后复核 dev / inode / size / mtime，文件替换须重新导入，CORS 限制为当前 renderer 来源。

## 参数面板、抠像预览与导出

右侧提供键控颜色、吸管、similarity、blend、alphaLow、alphaHigh、despill 开关及绿色 / 蓝色类型，以及保留音频。滑块和数值双向同步；拖动时只显示待应用的数值，松开后才应用参数并刷新预览，拖出滑块再松开也有效。键盘调整滑块在按键松开时应用；数值输入在按 Enter 或离开输入框时应用。Alpha 上限始终大于下限。点击「吸管取色」后会暂停原片，点击画面读取当前帧的源像素 RGB，保存为 0xRRGGBB；黑边不响应，Esc 可取消。canvas 仅用于取色，不执行抠像。

预览区顶部可切换「原图 / 抠像结果 / Alpha 蒙版」。抠像结果可选棋盘格或自定义纯色背景；Alpha 模式白色保留、黑色透明。后两者是 **FFmpeg 单帧预览**：切换后暂停源视频，拖动时间轴或逐帧按钮可更新；播放会切回原图。参数 / 裁剪 / 时间变化后 250ms 防抖，旧请求立即取消，主进程等待旧进程关闭后再启动新的请求，且丢弃过期结果。主进程接收已授权视频 URL，通过有文件签名校验的缓存 probe / 参数校验后返回 PNG data URL，不生成预览临时文件。渲染进程立即转为 Blob URL，换参数 / 模式 / 素材及卸载时 revoke；过期响应不会创建 Blob。

```ts
const result = await window.api.preview.frame({
  id: crypto.randomUUID(),
  url: video.url,
  time: 1.5,
  params,
  mode: 'keyed'
}) // { id, dataUrl }；取消或被替代时 dataUrl 为 null
await window.api.preview.cancel(requestId)
const presets = await window.api.presets.list()
await window.api.presets.save('我的蓝幕', params)
await window.api.presets.delete(customPresetId)
```

内置「默认绿幕」不可覆盖或删除。自定义预设保存在 userData/presets.json，原子写入、串行更新；同名保存覆盖原预设。预设保存抠像、音频与导出大小参数，crop / trim 始终为空，载入时保留各素材已有裁剪与时间区间。

点击右侧底部「开始导出」打开原生保存对话框，默认使用设置中的输出目录（未设置时同目录）、原文件名加 _alpha.mov；提交到主进程 jobs:add，左侧显示进度。勾选「应用到队列中全部视频」会将 **已导入素材列表中的全部视频** 创建为新导出任务（不会修改正在执行的任务），选择统一输出目录；同名或已存在输出自动追加 _2、_3 等编号。所有素材使用当前抠像 / 音频参数，裁剪可按当前源尺寸比例分别缩放到目标像素并取偶数，或全部忽略。时间区间按绝对秒数应用、出点截至各素材结尾；若某素材与区间完全无交集，提交前显示素材名和原因，不会静默导出错误区间。

验证步骤：导入视频，拖动右侧参数，切换「抠像结果」观察透明背景，再切到「Alpha 蒙版」检查边缘；用吸管选颜色；命名保存预设、改值后载入；最后导入另一尺寸视频并勾选批量模式，确认左侧出现独立任务，输出尺寸按所选裁剪方式变化。

## 任务管理、设置与异常恢复

- 导入时通过 ffmpeg 提取一帧 JPEG 缩略图（最长 240×135，最多 128 项缓存、串行抽帧）。素材列表使用该图，任务入队时附带同一缩略图并保存在 jobs.json，重启后仍可显示；抽帧失败显示占位图，不阻塞导入。
- 任务卡片显示文件名、抠像 / Apple 转码 / 校验阶段、0–100% 进度、耗时及输出文件名。运行中的耗时每秒更新，已结束任务使用 finishedAt 固定耗时；排队显示等待开始。
- 排队 / 运行任务可取消，失败 / 取消任务可重试，运行任务需先取消再删除。已完成任务可在 Finder 中显示输出，列表支持「清除已结束」。失败详情可展开、选择文本、复制完整错误及 stderr 末尾最多 50 行。
- 「重新编辑」按任务 ID 读取主进程保存的参数快照，恢复到中间预览和右侧面板，提交后创建新任务，保留原任务记录与参数。源文件丢失时会打开文件选择框定位视频；替换源尺寸变化时裁剪限制在新边界、时间区间截至新素材结尾。
- 顶部显示「运行中 n / 排队 m」。点击「设置」可保存并发数、默认输出目录和临时文件目录；恢复默认即同源输出 / 系统临时目录。目录通过原生选择器选择，保存时验证存在且可写，JSON 原子写入。未连接的历史外置盘设置仍保留，使用时给出错误，可在设置页改回默认。

编码开始前会 probe 并按 **导出时长 × 估算码率** 检查磁盘：ProRes 4444 按 1080p30 约 500Mbps 预算，随裁剪后像素数与帧率缩放，加 30% 余量；另计 HEVC 输出、音频及临时目录 256MiB 余量。临时与输出同卷时合并预算，跨卷时另查输出卷。并发任务共享预留账本，避免同时重复使用同一份空闲空间，成功 / 失败 / 取消 / 临时目录创建失败都会释放预留。估算是保守预算，实际体积取决于视频内容；运行中仍捕获 ENOSPC / No space left on device 并显示换目录或释放空间的提示。预检不足时不会启动 FFmpeg 编码，也不会分配大中间文件。

输入文件被移动 / 删除会明确标记失败，编码进程崩溃或被系统终止会显示退出信号与 stderr 尾部，释放队列槽位并清理中间文件，其他排队任务继续调度。

Cmd-Q / 应用菜单退出时，若有运行或排队任务，会显示「继续处理 / 退出并中断任务」。继续处理不改变队列；确认退出等待导出、预览、缩略图进程退出与临时文件清理，保存中断状态，下一次启动按「应用中断」恢复失败任务。最终状态写盘失败时保留上次有效 JSON，清理完成后仍允许退出。macOS 仅关闭窗口会继续后台队列。

验证：在设置中选择另一临时目录并提交任务，观察进度、耗时和该目录中的独立任务目录；取消后确认中间目录删除。展开失败任务并复制日志；重新编辑修改参数后提交，确认创建新任务。任务运行时按 Cmd-Q，分别检查继续处理和确认退出。

## 已知限制与 Review

- 仅 macOS，当前 Electron 发行版要求 macOS 13+；HEVC Alpha 导出依赖系统 avconvert 的对应预设，启动时实际探测可用性。没有 Windows / Linux 导出支持。
- 缺失 FFmpeg / ffprobe 时自动安装需要联网，源不可达或签名 / 架构 / 功能校验失败时不会启用下载文件，可重试或手动安装 Homebrew 版本；不会更改系统工具。原生播放器对 MOV / MKV 等容器内的部分编码不支持，FFmpeg 单帧预览和导出可能仍可用。
- 抠像是暂停状态下的单帧预览，播放切回原图；预览最长边 960px，缩放会造成与原分辨率导出边缘有轻微差异。
- 裁剪按编码后的源像素计算，ffmpeg 禁用自动旋转；带旋转元数据的素材应先转正，再使用裁剪和吸管。
- ProRes 中间文件、原生编码和高并发消耗较多磁盘 / CPU；空间预检是保守估算，不能保证抵御其他应用同时写盘。
- 当前使用 JSON / 内存任务队列和全量 IPC 快照，极多历史任务仍会增加载入、写盘和消息体积；可使用「清除已结束」。编辑会话本身不跨重启保存，任务与预设、设置持久化。
- 当前安装包是本地 ad-hoc 签名，尚未配置 Developer ID / 公证或自动更新。系统通知显示取决于系统权限和签名。

整体 Review、已修复问题、回归证据及剩余边界见 [docs/REVIEW.md](docs/REVIEW.md)。

## 检查命令

```bash
npm test
npm run lint
npm run build
npm run test:smoke
```

Vitest 测试覆盖滤镜顺序、偶数 crop 与边界、despill 开关、非法 alpha 范围、导出/预览参数、probe 解析、跨数据块的进度解析、stderr 最后 50 行、真实子进程 SIGTERM 与取消清理、Apple Alpha 结构校验，以及串行队列的等待取消。

`src/main/jobs/queue.integration.test.ts` 包含三项 macOS 集成测试：真实 ffmpeg + avconvert 正常完成、在真实 ffmpeg 进度中取消、真实 ffmpeg 非零退出失败。其余队列测试覆盖重试/删除/清空、并发配置、重启恢复、200 ms 节流及坏文件保护；macOS 集成测试需要本机 ffmpeg/ffprobe/avconvert，其他系统跳过这些 macOS 测试；额外集成测试验证真实源文件缺失和模拟满盘预检不会启动编码。

`src/main/ffmpeg/install.test.ts` 验证架构与下载地址限制、成对原子启用、损坏下载、取消清理、保留旧版本、失败重试和状态节流；ZIP 下载使用固定测试响应，解压调用真实系统工具，不写真实 userData。

`test:smoke` 需要本机 ffmpeg，会构建项目、启动真实 Electron 主进程/preload/React，并在临时目录生成横屏和竖屏测试视频。`editor-smoke.cjs` 使用真实鼠标/键盘事件验证八个裁剪手柄、数值编辑、比例锁定、窗口缩放、黑边换算、逐帧往返、空格/I/O、双滑块和文件切换；通过 CDP 指定磁盘 File 后触发生产 drop handler 验证真实文件拖入。`keying-smoke.cjs` 额外验证 canvas 吸管、参数联动、250ms 防抖、原生 PNG / alphaextract、纯色背景、预设保存载入删除，以及原生对话框到队列的单文件与比例裁剪批量导出。`tasks-smoke.cjs` 还验证任务卡片、设置持久化与目录生效、真实 FFmpeg SIGKILL、日志展开复制、重试取消删除、重新编辑提交新任务、运行时磁盘写满提示、丢失文件定位，以及继续 / 确认退出的进程清理。它还覆盖 IPC、沙箱、精简 PATH 的工具检测、协议 Range、任务管理与节流事件。通知、Finder、剪贴板和原生对话框测试替换系统动作以避免打扰；转码使用真实工具。测试使用独立临时 userData，不读写用户的 jobs.json / presets.json / settings.json，完成后关闭测试窗口。

## 目录

```text
src/
├── main/
│   ├── index.ts                 # 窗口、应用生命周期、协议注册
│   ├── ipc.ts                   # 固定通道及发送者检查
│   ├── settings.ts              # 并发 / 默认输出目录 / 临时目录的原子持久化
│   ├── quit.ts                  # 去重退出确认与清理顺序
│   ├── presets.ts               # 自定义预设 JSON 与内置默认绿幕
│   ├── exportPaths.ts           # 导出默认文件名与批量避重
│   ├── localfile.ts             # 主进程授权及 localfile://media/<token>
│   ├── localFileResponse.ts     # 流式读取、Range / HEAD / 416
│   ├── ffmpeg/
│   │   ├── detectTools.ts       # spawn 检测路径、版本、Alpha 预设
│   │   ├── probe.ts             # ffprobe JSON 与元数据
│   │   ├── buildFilter.ts       # 唯一滤镜链及导出/预览参数
│   │   ├── diskSpace.ts         # ProRes / HEVC 空间预算与并发预留
│   │   ├── thumbnail.ts         # 原生 FFmpeg JPEG 缩略图缓存
│   │   ├── preview.ts           # 单窗口可取消单帧预览，等待旧进程关闭
│   │   ├── run.ts               # 可取消 spawn、进度与 stderr 尾部
│   │   ├── validateOutput.ts    # HEVC / Apple Alpha 结构校验
│   │   └── pipeline.ts          # 两阶段导出、临时目录与最终发布
│   └── jobs/queue.ts            # 默认并发 1 的可配置队列
├── preload/
│   ├── index.ts                # contextBridge，仅暴露固定的 DesktopAPI 方法
│   └── index.d.ts
├── renderer/src/
│   ├── components/
│   ├── store/appStore.ts       # zustand 状态
│   ├── store/editorStore.ts    # 当前文件、probe、源像素 crop / trim 与素材编辑会话
│   ├── editor/                # 裁剪几何与播放器快捷键
│   ├── assets/main.css         # Tailwind 入口、默认明亮主题
│   └── App.tsx
└── shared/types.ts             # 参数及默认值、Job、工具状态、IPC 通道与 API 类型
```

`localfile://` 在 Electron ready 之前注册为支持流媒体的安全协议，ready 之后安装 handler，遵循 [Electron protocol 文档](https://www.electronjs.org/docs/latest/api/protocol)。主进程为原生文件选择框或 preload 获取的磁盘 File 签发随机 token；协议与 probe 只读取已授权 URL。视频按请求范围流式读取，不将整个文件载入内存。渲染进程关闭 Node integration，启用 context isolation 与 sandbox，并限制导航和新窗口。

命令行脚本位于 `scripts/test-pipeline.ts`；单元测试与对应核心模块放在一起，以 `.test.ts` 命名。

## 许可证（License）

本项目基于 [GNU Affero General Public License v3.0（AGPL-3.0-only）](./LICENSE) 开源发布。

> Commercial use is allowed, but if you modify and distribute this software, or provide a modified version over a network, you must provide the corresponding source code under AGPL v3.

即：允许商业使用；但一旦修改并分发本软件，或通过网络对外提供修改后的版本，就必须以 AGPL v3 开放相应修改的完整源代码。
