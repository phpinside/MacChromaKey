# MacChromaKey V1.0 (苹果手机透明视频生成器)

**Turn green-screen videos into transparent-background animations.**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0--only-blue)](./LICENSE) ![Platform: macOS 13+](https://img.shields.io/badge/platform-macOS%2013%2B-lightgrey) ![Built with Electron](https://img.shields.io/badge/Electron%20%2B%20React-44%20%2F%2019-47848F)

English | [简体中文](./README.md)

Import MP4 / MOV / MKV green-screen videos on your Mac, crop the frame, key out the background and fine-tune the edges, then produce transparent video animations for compatible players on Apple devices. Everything is processed locally — no footage ever leaves your machine.

- **Import & crop**: drag-and-drop import, precise cropping, trim ranges.
- **Keying & preview**: eyedropper color picking, edge and despill adjustments, switch between the original frame, the keyed result and the Alpha mask.
- **Export & batch**: MOV files with a real alpha channel, optional size / frame-rate limits to reduce file size, parameter presets, a batch queue with progress, and retry for failed tasks.

Requires **macOS 13+** (Apple silicon and Intel Macs are both supported). The output is HEVC with Alpha, intended for Safari pages and apps on iPhone / iPad / Mac that support the format. Transparency depends on the playback environment; ordinary players may show a black background.

A local macOS green-screen video workbench built on the [official electron-vite react-ts template](https://electron-vite.org/guide/), using React, TypeScript, Tailwind CSS and zustand. The UI ships in Chinese (bright light theme by default); the welcome guide can be reopened anytime from the top-right「使用说明」button.

Implemented so far: a three-pane editor, tool detection, safe video import, source-pixel cropping, trim ranges, keying parameters with eyedropper, single-frame FFmpeg preview, presets, single-file / batch HEVC Alpha export, and a persistent job list with thumbnails, logs and management actions, plus a settings page.

## Getting Started (Development)

macOS 13+ only (Apple Silicon arm64 or Intel x64), with Node.js 22.12+ (or 24+) and npm. Exporting also requires the system `avconvert` to include the HEVC Alpha preset.

```bash
npm ci
npm run dev
```

`npm run dev` starts Vite and Electron together. Verify inside the Electron desktop window; opening the Vite URL in a plain browser has no preload bridge.

The environment is detected automatically at startup. If `ffmpeg` / `ffprobe` are missing, the app downloads and installs the latest stable native build for your Mac's architecture, showing download / verification / activation progress at the top; you can cancel or retry after a failure. Existing usable tools are reused as-is — nothing is auto-upgraded or modified system-wide. You can also install manually:

```bash
brew install ffmpeg
```

`avconvert` is provided by macOS. It has no standalone version flag, so the status shows the macOS version and additionally confirms that `PresetHEVCHighestQualityWithAlpha` is available. Its `--help` returning a non-zero exit code is normal for this tool.

If your local npm mirror is unavailable during dependency installation, run `npm install --registry=https://registry.npmjs.org`.

## Building the macOS DMG

The app uses a dedicated green icon: a green-screen frame peeling open to reveal a transparency checkerboard, with a white play button. The design was AI-generated; the [generation record and prompt](build/chroma-icon.prompt.md) is kept in the repo. The source image is `build/chroma-icon-master.png`; the delivered 1024px PNG / macOS ICNS are `build/chroma-icon.png` and `build/chroma-icon.icns`. The in-app identity and the development Dock icon use the same design.

To update the source image, run `npm run build:icons` on macOS to regenerate all sizes, then package normally. The script only uses system `sips` / `iconutil`, preserves alpha, and adds no dependencies.

```bash
npm ci
npm run build:mac          # build both arm64 and x64 DMGs at once
# or build one architecture
npm run build:mac:arm64
npm run build:mac:x64
# .app directory only, for inspection
npm run build:unpack
```

The artifacts are `dist/苹果手机透明视频生成器-1.0.0-arm64.dmg` and `dist/苹果手机透明视频生成器-1.0.0-x64.dmg` (the version follows package.json). Open the DMG for your architecture and drag the Chinese-named app into Applications. Neither package bundles ffmpeg / ffprobe; if missing, they are installed automatically over the network on first launch, or run `brew install ffmpeg` beforehand. The Intel build should be verified on an Intel Mac; Apple Silicon can supplement with Rosetta.

The current build is **ad-hoc signed locally and not notarized by Apple** — intended for local verification; it is not a Developer ID distribution signature, and Gatekeeper may block it after download. For public distribution, configure your own Developer ID, signing entitlements and notarization (see the [electron-builder v26 macOS docs](https://www.electron.build/v26/docs/mac/)). The ad-hoc Electron frameworks have no Team ID; local entitlements include disable-library-validation and should be reviewed and tightened for real signing.

Packaging uses the `out/**` allow-list from package.json plus production dependencies; only explicitly listed optional tools are copied via extraResources. Source code, tests, `input.mp4`, `.env` and project docs never enter the package; native executables live outside app.asar. The CLI always passes `--publish never`, so artifacts are never uploaded.

```bash
npm run test:package       # after building: both architectures, signing, DMG integrity, asar contents, real .app launch
```

This check uses a separate `--user-data-dir` and verifies packaged tool detection, import, localfile playback and single-frame FFmpeg preview without touching existing user jobs. Testing the x64 launch on Apple Silicon requires Rosetta. Source / Electron integration checks are listed under Check Commands below.

## FFmpeg Distribution & Lookup Order

This build prefers reusing an already-working FFmpeg; when missing, it auto-installs native command-line tools. No FFmpeg.wasm — media is always processed locally. `resources/bin/README.md` is a placeholder; no binaries are bundled today.

`ffmpeg` and `ffprobe` are each checked for executable permission and version in this order, falling through on failure:

1. Development: `resources/bin/<arch>/ffmpeg`, `ffprobe`; after install: `Contents/Resources/bin/<arch>/`.
2. Development: `resources/bin/ffmpeg`, `ffprobe`; after install: `Contents/Resources/bin/`.
3. The app's private auto-install directory: `~/Library/Application Support/MacChromaKey/tools/<arch>/<version>-<uuid>/` (selected via `current.json` among verified versions).
4. `/opt/homebrew/bin`, `/usr/local/bin`.
5. Whatever `/usr/bin/which` finds on the current PATH.

`<arch>` is `arm64` or `x64`. When bundling in the future, binaries should be placed pairwise per architecture, executable, and not depend on the build machine's Homebrew dynamic libraries; extraResources already copies matching architecture subdirectories plus the common location. Binaries in the common location must support the target architecture; architecture subdirectories are preferred. `avconvert` is always only `/usr/bin/avconvert` — a macOS system component that is never bundled or downloaded and has no cross-platform replacement.

Auto-install picks a stable release dynamically from the latest-release API of [Martin Riedl's FFmpeg Build Server](https://ffmpeg.martin-riedl.de/) (arm64 / Intel amd64), with ffmpeg and ffprobe pinned to the same distribution. This is a third-party prebuilt distribution; [FFmpeg officially](https://ffmpeg.org/download.html) publishes source code. Downloads are restricted to HTTPS URLs of that source, and the pair is atomically activated only after verifying SHA-256, the Apple Developer ID signature and issuer Team ID, architecture, version, and required filters / encoders. Cancel, verification failure or app exit all clean up temp files. No sudo / Homebrew needed, no system directories modified. The install-status IPC accepts only start / cancel / query — never URLs, paths or commands from the renderer. No automatic retry loops after failure / cancel; the user clicks「重试安装」, and「重新检测」recognizes tools installed manually afterwards.

The network is used only to download tools when missing — media is never uploaded. Availability and speed of the distribution source depend on your network; that source has announced it will stop Intel release builds in January 2027, after which "latest" for Intel means the newest compatible stable build it still offers. Working tools are never silently upgraded; manage upgrades yourself with Homebrew if desired.

Resolved paths are short-cached for 30 seconds to reduce `which` / `-version` process spawns during frequent previews; the top「重新检测」button forces a refresh. The GUI does not depend on the interactive shell PATH, so explicit resource and Homebrew paths are preferred.

## Running the Export Pipeline

> The repo ships no sample footage: bring your own green-screen video, rename it to `input.mp4`, and put it in the project root before running the examples below (`input.mp4` is git-ignored and never committed).

```bash
npx tsx scripts/test-pipeline.ts input.mp4 output.mov
# equivalent
npm run test:pipeline -- input.mp4 output.mov
# compact transparent video: scale longest edge to 720px, cap at 24fps
npx tsx scripts/test-pipeline.ts input.mp4 output_compact.mov --max-edge 720 --fps 24
```

With tsx installed globally you can run `tsx scripts/test-pipeline.ts input.mp4 output.mov` directly. The script uses the default parameters from `src/shared/types.ts` (audio not kept by default). Ctrl+C cancels the task; abnormal exits return a non-zero status code.

Export runs in two phases: the ffmpeg keying phase occupies 0–90%, the avconvert phase holds 90% and shows「Apple 转码中」(Apple transcoding), and 100% is only reported after output validation. FFmpeg progress is parsed from `out_time_us`, with the denominator being the source duration or `trim.end - trim.start`.

The core entry point is `runExport(input, output, params, onProgress, signal)`; the progress callback receives `{ stage, progress, message }` with `progress` in 0–1. The return value includes the output path, dimensions, duration, fps, audio status, codec and the Alpha layer ID. The entry point runs a single pipeline and is called directly by the CLI; in-app export goes through the main-process job queue described below to avoid duplicate queuing or concurrency-limit conflicts.

In Electron, temp files default to `app.getPath('temp')`; in tsx's Node environment, `os.tmpdir()`. The settings page can pick another temp directory, effective for subsequently started tasks. Each task gets its own directory, cleaned up on success, failure and cancel; cancel sends SIGTERM first, then SIGKILL after 3 seconds, and deletes files after the child processes exit. Existing output files are left untouched during encoding and validation; the new file is published only after validation passes. Across volumes, the validated file is first copied to a hidden staging file in the target directory, then renamed into place; a failed copy or cancel removes the staging file and keeps the original output. avconvert always runs with `--replace`.

`probe(input)` uses ffprobe JSON and returns `{ width, height, duration, fps, hasAudio }`. `buildFilter(params, source)`, `buildExportArgs(input, tempOut, params, source)` and `buildPreviewArgs(input, time, params, source)` share the single filter chain. When crop is set, the dimensions from probe must be passed; x/y/w/h are normalized down to even numbers before boundary validation, and checks are never skipped just because source dimensions are unknown. Crop coordinates are based on original source pixels; ffmpeg input disables auto-rotation to keep coordinates consistent. Trim uses absolute seconds in the source video. With keepAudio enabled, the intermediate file uses PCM s16le audio and the final audio is encoded by avconvert.

Preview takes an absolute source time `time`, ignores export trim / frame-rate caps, and outputs a single RGBA PNG to stdout (`image2pipe`), no audio. `buildPreviewArgs(input, time, params, source, mode)` takes mode `keyed` (default) or `alpha`; both reuse the same keying chain, scale proportionally after crop (never upscaling small footage), cap preview longest edge at 960px, respect the export cap when a smaller export size is chosen, and finish with format=rgba; alpha mode inserts alphaextract last. Default export keeps source resolution and frame rate; an export size cap adds an export scale only when chosen, with even dimensions and square pixels so Apple does not rescale due to pixel aspect.

## Reducing Transparent MOV Size

The right pane's「导出大小」offers longest-edge **1920 / 1280 / 960 / 720px** and frame-rate caps **60 / 30 / 24 / 15fps**.「使用小体积设置」one-click sets **720px / 24fps**; portrait 720×1280 scales to 404×720, landscape 1920×1080 scales to 720×404. Size and frame rate only ever decrease — small videos are never upscaled and low-fps footage never interpolated. Frame-rate conversion happens before keying to avoid processing wasted frames; preview can still seek anywhere in the source.

New parameters `exportMaxEdge` and `exportFps` use `0` to mean keep source size / fps; legacy jobs and JSON presets missing these fields behave as `0`. The settings are saved with jobs and parameter presets, and support batch export and re-edit submission. Source-pixel crop is unaffected by output size, and the disk pre-check estimates the intermediate file from the scaled size and fps.

The final pass still uses `PresetHEVCHighestQualityWithAlpha`, preserving and validating the Apple Alpha layer. MP4 and MOV are containers; size depends mainly on video bitrate, the transparency layer, dimensions and frame rate. When the source MP4 is already highly compressed, the transparent MOV may stay larger even at a lower resolution; smaller sizes lose detail and lower fps reduces smoothness — a fixed 2MB target cannot be guaranteed.

`avconvert --help` exposes no target bitrate / CRF parameters; local tests swapping to `PresetHEVC1920x1080WithAlpha` barely changed the size of a 720×1280 sample, so plain HEVC presets are not treated as a compression scheme (they would lose transparency). Precise base bitrate and Alpha quality control requires Apple's [AVAssetWriter / VideoToolbox APIs](https://developer.apple.com/videos/play/wwdc2019/506/); the ffmpeg → avconvert architecture remains.

The dev-time sample `input.mp4` (2.11 MiB, 720×1280, 30fps, about 13.93 seconds; not shipped with the repo) measured with default keying parameters and no audio; results vary with footage, parameters and macOS encoder versions:

| Export setting     | Final size / fps      | File size | vs. default |
| ------------------ | --------------------- | --------- | ----------- |
| Original           | 720×1280 / ~30fps     | 10.28 MiB | —           |
| 960 edge / 24fps   | 540×960 / ~24fps      | 6.62 MiB  | ~36% less   |
| 720 edge / 24fps   | 404×720 / ~24fps      | 4.86 MiB  | ~53% less   |

Both reduced outputs passed the full export pipeline's HEVC / Apple Alpha layer validation; after fps reduction the duration may round to within one output frame — the source is not meaningfully shortened.

Apple HEVC Alpha stores transparency as an auxiliary HEVC layer; current ffprobe 7.1.1 still reports base-layer pixel format `yuv420p` for such files. Per the confirmed interoperability approach, final validation uses ffprobe to confirm `hevc` / `hvc1`, reads the hvcC config and the first video packet, and checks the enabled Alpha SEI, non-zero-layer SPS/PPS, and actual base- and alpha-layer image NAL data; plain HEVC without Alpha is rejected. The structure follows [Apple's HEVC Video with Alpha specification](https://developer.apple.com/av-foundation/HEVC-Video-with-Alpha-Interoperability-Profile.pdf) — a file is not considered successful merely because its codec is named HEVC.

## Job Queue & IPC

At startup the main process opens `app.getPath('userData')/jobs.json` and creates the queue with `JobQueue.open({ filePath, concurrency: 1, onDone })`. The job list is saved atomically via a same-directory temp file and rename; writes are serialized, progress is persisted at most every 2 seconds (avoiding high-frequency rewrites of large lists), and IPC snapshots remain at most every 200 ms; enqueue, status changes and management operations wait for the save. A persistence failure stops scheduling new tasks and surfaces via `persistenceError` in the status. Invalid history files produce an error and keep the original file — never silently overwritten.

Jobs use a unified `Job` type: `status` is `queued | running | done | failed | canceled`, `stage` is `keying | apple-transcode | verifying`, `progress` is **0–100**. `startedAt` / `finishedAt` always exist — null before they happen, ISO timestamps after. The underlying pipeline still uses 0–1 progress; the queue maps it; `done / 100` is only set after output validation, publication and temp-file cleanup all complete.

On restart, formerly queued / running jobs become failed with error「应用中断」(app interrupted) and a finishedAt is added; done, failed and canceled records are preserved. Quitting the app stops scheduling, terminates running child processes, waits for cleanup and saves, and interrupted tasks recover as failures on next launch. Closing the macOS window does not stop the background queue.

The renderer only uses the fixed API exposed by preload. inputPath must be the canonical main-process path of an already-imported source video; outputPath must come from a one-time authorization via the chooseExportPaths native dialog — arbitrary absolute paths cannot be written directly:

```ts
const unsubscribe = window.api.jobs.onChanged((snapshot) => {
  // full list snapshot, pushed at most every 200 ms; no Electron event exposed
  console.table(snapshot.jobs)
})
const snapshot = await window.api.jobs.list()
const destinations = await window.api.chooseExportPaths([video.url])
if (!destinations) return // user cancelled
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
const editing = await window.api.jobs.edit(job.id) // {video, info, params}; null if locating the file was cancelled
const settings = await window.api.settings.get()
await window.api.settings.save({ ...settings, concurrency: 2 })
unsubscribe()
```

Cancelling a queued task takes effect immediately; cancelling a running task waits for the child processes to exit and temp files to be cleaned before returning canceled. When successful publication races a cancel, the already-completed export stays done. retry only allows failed / canceled; the same ID moves to the queue tail with progress and times reset. remove rejects running tasks — await cancel first; clearFinished removes only done / failed / canceled. Concurrency defaults to 1, configurable 1–8 in settings, persisted to userData/settings.json and restored on restart. Lowering concurrency never interrupts running tasks; it only affects later starts.

IPC channels are centralized in `src/shared/types.ts`: `jobs:list/add/cancel/retry/remove/clear-finished/set-concurrency/show-output/changed`. The main process validates the window, main frame, exact renderer URL and job parameters; new jobs require an imported video and dialog-authorized output, and the same output path is never written concurrently. The Finder API looks up the main-process record by completed job ID, checks the output exists, then calls `shell.showItemInFolder`. `jobsStore.ts` automatically receives snapshots and uses revisions to keep stale list responses from overwriting newer state; job cards on the left offer actions, and the top shows live running / queued counts.

On success, an Electron Notification fires; clicking it reveals the output in Finder. Failures and cancellations send no completion notification, and notification failures never affect export results. Whether macOS actually displays notifications depends on system notification permission and app signing; Electron's unsigned builds may trigger failed events, see the [Electron Notification docs](https://www.electronjs.org/docs/latest/api/notification).

## Manual Verification

1. Run `npm run dev`; the Electron window defaults to 1280×800 in the default light mode; the first launch shows the Chinese guide, reopenable top-right afterwards. macOS traffic lights sit top-left; dragging the title bar moves the window.
2. The top auto-detects ffmpeg, ffprobe, avconvert. Expand「路径与版本」for real results, or hover each tool for details.「重新检测」refreshes after installing tools.
3. Missing or non-executable tools show a red banner; missing ffmpeg / ffprobe auto-install the latest stable build for the current architecture with progress, cancel and retry, keeping `brew install ffmpeg` as the manual fallback. See the lookup order above; avconvert only ever uses `/usr/bin/avconvert`.
4. Click「导入视频」or drop a video (MP4 / MOV / MKV) onto the middle preview. After import the main process probes resolution, duration and fps; imported media and existing jobs list on the left. Filenames with Chinese, spaces or `#` all work.
5. Press F12 or Option+Command+I for DevTools. In Network, filter `localfile` and scrub the timeline to see media requests (small cached videos may not re-request). Requests use opaque authorized URLs; Range responses are `206` with `Accept-Ranges: bytes`, `Content-Range` and correct `Content-Length`.
6. In DevTools run `await window.api.detectTools()` to see typed IPC data. `typeof window.require` should be `"undefined"`.

Specific codecs inside MOV / MKV / AVI containers may not be playable by the Chromium player — the UI shows a playback failure notice. Even when Chromium cannot play the source codec, FFmpeg can still produce keyed / Alpha single-frame previews at the current time; the eyedropper needs the source to be decodable.

## Middle Preview Pane

- Playback uses localfile:// with a custom control bar: play/pause, seek, current / total time and frame-step buttons. Space toggles play/pause; ← / → step one frame at the probe fps, clamped to the first / last frame. Numeric inputs and selects never steal text-editing keys.
- The crop box is draggable with eight resize handles, using pointer capture so dragging continues when the pointer leaves a handle. `editorStore.crop` always stores source-video pixel coordinates; display position is computed from the object-fit: contain scale and letterbox offsets, and resizing the window never mutates source coordinates.
- X / Y / W / H inputs bind both ways with the frame, all clamped to the source range;「重置 / 全画面」clears the crop. Aspect ratio: free, 16:9, 1:1, 9:16. Edited coordinates are rounded to integer pixels; ratio locking allows up to about one pixel of rounding error; even-number normalization happens on submission to the existing queue per the original rules.
- Below the seekbar sit independent in / out dual sliders; clicking the track moves the nearer endpoint. I / O or the matching buttons set the current time; the sliders also support arrow-key frame stepping (Shift for ten frames). At least one frame of range is always kept and endpoints cannot cross;「全时长」clears trim. Playback browses the whole source; the range only decides the export span.
- Current file, probe info, crop, trim, aspect ratio and playback state live in the zustand `editorStore`. Switching imported media restores each one's crop and trim; editing sessions stay in memory only.

The drag-and-drop path gets the real disk File via [Electron webUtils.getPathForFile](https://www.electronjs.org/docs/latest/api/web-utils) in preload only; the main process checks the extension and issues an authorized URL. The probe IPC accepts only authorized localfile URLs, never arbitrary paths; the protocol re-verifies dev / inode / size / mtime after opening — replaced files must be re-imported — and CORS is restricted to the renderer origin.

## Parameter Pane, Keying Preview & Export

The right pane offers key color, eyedropper, similarity, blend, alphaLow, alphaHigh, the despill toggle with green / blue type, and keep-audio. Sliders and numbers sync both ways; while dragging only the pending value shows, and parameters apply — refreshing the preview — on release, including releases outside the slider. Keyboard slider adjustments apply on key-up; number inputs apply on Enter or blur. The alpha upper bound always stays above the lower one. Clicking「吸管取色」pauses the source; clicking the canvas reads the current frame's source-pixel RGB and saves it as 0xRRGGBB; letterbox areas do not respond, Esc cancels. The canvas is used only for picking, never keying.

The preview top switches「原图 / 抠像结果 / Alpha 蒙版」(original / keyed / alpha mask). The keyed result can show a checkerboard or a custom solid background; alpha mode keeps white and hides black. The latter two are **single-frame FFmpeg previews**: switching pauses the source, and scrubbing or frame-stepping updates them; playing switches back to the original. Parameter / crop / time changes debounce 250ms, in-flight requests cancel immediately, the main process waits for the old process to exit before starting a new one, and stale results are discarded. The main process receives the authorized video URL, validates it with signed-cache probe / parameter validation, and returns a PNG data URL without writing preview temp files. The renderer immediately converts to a Blob URL, revoking it on parameter / mode / media change or unmount; stale responses never create Blobs.

```ts
const result = await window.api.preview.frame({
  id: crypto.randomUUID(),
  url: video.url,
  time: 1.5,
  params,
  mode: 'keyed'
}) // { id, dataUrl }; dataUrl is null when cancelled or superseded
await window.api.preview.cancel(requestId)
const presets = await window.api.presets.list()
await window.api.presets.save('我的蓝幕', params)
await window.api.presets.delete(customPresetId)
```

The built-in「默认绿幕」cannot be overwritten or deleted. Custom presets persist in userData/presets.json with atomic writes and serial updates; saving the same name overwrites. Presets save keying, audio and export-size parameters; crop / trim are always empty — loading keeps each clip's existing crop and trim.

Clicking「开始导出」at the bottom right opens the native save dialog, defaulting to the configured output directory (or the source directory when unset) with the original name plus `_alpha.mov`; submitting goes to jobs:add with progress on the left. Checking「应用到队列中全部视频」creates new export tasks for **every video in the imported-media list** (never mutating running tasks), with a unified output directory; name conflicts or existing outputs get `_2`, `_3` suffixes. All clips use the current keying / audio parameters; crops can be proportionally scaled per clip to the target pixels and evened, or ignored entirely. Trim applies as absolute seconds, with out points clamped to each clip's end; if a clip has zero overlap with the range, its name and reason show before submission — wrong ranges are never silently exported.

Verification steps: import a video, drag the right-pane parameters, switch to「抠像结果」to watch the transparent background, then「Alpha 蒙版」to inspect edges; pick a color with the eyedropper; save a named preset, change values, reload; finally import another-sized video, check batch mode, and confirm independent tasks appear on the left with output sizes changing per the chosen crop mode.

## Job Management, Settings & Crash Recovery

- On import, one JPEG thumbnail frame is extracted with ffmpeg (max 240×135, an LRU of 128 items, serial extraction). The media list uses it; jobs carry the same thumbnail into jobs.json so it survives restarts; extraction failure shows a placeholder and never blocks import.
- Job cards show filename, keying / Apple-transcode / verify stage, 0–100% progress, elapsed time and output filename. Running elapsed time updates every second; finished tasks freeze it from finishedAt; queued shows waiting-to-start.
- Queued / running tasks can cancel; failed / canceled tasks can retry; running tasks must cancel before deletion. Completed tasks can reveal output in Finder; the list supports「清除已结束」. Failure details expand, are selectable, and the full error plus the last 50 stderr lines can be copied.
-「重新编辑」reads the parameter snapshot saved by the main process by job ID, restoring the middle preview and right pane; submitting creates a new task and keeps the original record and parameters. When the source is missing, a file picker locates the video; a replaced source with different dimensions re-clamps the crop to the new bounds and trims the range to the new clip's end.
- The top shows「运行中 n / 排队 m」.「设置」saves concurrency, default output directory and temp-file directory; restoring defaults means same-dir output / system temp. Directories are picked via native selectors, validated to exist and be writable on save, written as atomic JSON. Historical external-disk settings that are currently disconnected are kept, erroring on use until changed back in settings.

Before encoding starts, a probe and a **export-duration × estimated-bitrate** disk check run: ProRes 4444 budgeted at about 500Mbps for 1080p30, scaled by post-crop pixels and fps, plus 30% headroom; plus HEVC output, audio and a 256MiB temp-directory allowance. Temp and output on the same volume share one budget; across volumes the output volume is checked too. Concurrent tasks share a reservation ledger so the same free space is never double-counted; success / failure / cancel / temp-dir creation failure all release reservations. The estimate is a conservative budget — actual size depends on content; runtime ENOSPC / "No space left on device" is caught with a hint to change directories or free space. An insufficient pre-check never starts FFmpeg encoding or allocates a large intermediate file.

Moved / deleted input files fail explicitly; encoder crashes or system kills show the exit signal and the stderr tail, release the queue slot and clean intermediates, and other queued tasks keep scheduling.

Cmd-Q / app-menu quit with running or queued tasks shows「继续处理 / 退出并中断任务」(keep processing / quit and interrupt). Continuing changes nothing; confirming quit waits for export, preview and thumbnail processes to exit and temp cleanup, saves interrupted state, and interrupted jobs recover as failures next launch. If the final state fails to persist, the last valid JSON is kept and quitting still proceeds after cleanup. On macOS, closing only the window keeps the background queue running.

Verification: choose another temp directory in settings and submit a task; watch progress, elapsed time and that directory's per-task folder; cancel and confirm the intermediate directory is removed. Expand a failed task and copy the log; re-edit, change parameters, submit, and confirm a new task appears. With a task running, press Cmd-Q and check both continue and confirm-exit paths.

## Known Limitations & Review

- macOS only; the current Electron build requires macOS 13+. HEVC Alpha export depends on the system avconvert preset, probed at startup. No Windows / Linux export support.
- Auto-installing missing FFmpeg / ffprobe requires network access; unreachable sources or failed signature / architecture / capability checks never activate the download — retry or install Homebrew builds manually; system tools are never modified. Native players may not support some codecs inside MOV / MKV containers; single-frame FFmpeg previews and export may still work.
- Keying preview is a paused single frame; playback switches back to the original. Previews cap at 960px longest edge, so scaled previews differ slightly from full-resolution export edges.
- Crop math uses encoded source pixels with ffmpeg auto-rotation disabled; rotated footage should be straightened before cropping or eyedropper use.
- ProRes intermediates, native encoding and high concurrency consume significant disk / CPU; the space pre-check is a conservative estimate and cannot defend against other apps writing simultaneously.
- The job queue is JSON / in-memory with full IPC snapshots; extremely long histories still grow load, write and message sizes — use「清除已结束」. Editing sessions are not persisted across restarts; jobs, presets and settings are.
- Current packages are locally ad-hoc signed without Developer ID / notarization or auto-update. System notification display depends on permission and signing.

The full review, fixed issues, regression evidence and remaining edge cases are in [docs/REVIEW.md](docs/REVIEW.md) (Chinese).

## Check Commands

```bash
npm test
npm run lint
npm run build
npm run test:smoke
```

Vitest tests cover filter ordering, even crop and boundaries, the despill toggle, invalid alpha ranges, export / preview args, probe parsing, progress parsing across data chunks, the last 50 stderr lines, real subprocess SIGTERM and cancel cleanup, Apple Alpha structure validation, and serial-queue cancel waiting.

`src/main/jobs/queue.integration.test.ts` contains three macOS integration tests: real ffmpeg + avconvert completing normally, cancelling mid real-ffmpeg progress, and real ffmpeg non-zero-exit failure. Other queue tests cover retry / remove / clear, concurrency configuration, restart recovery, 200 ms throttling and corrupt-file protection; macOS integration tests need local ffmpeg / ffprobe / avconvert and are skipped elsewhere; extra integration tests verify real missing source files and that a simulated full-disk pre-check prevents encoding from starting.

`src/main/ffmpeg/install.test.ts` verifies architecture and download-URL restrictions, pairwise atomic activation, corrupted downloads, cancel cleanup, keeping old versions, failure retry and status throttling; ZIP downloads use fixed test responses while extraction calls real system tools and never writes the real userData.

`test:smoke` needs local ffmpeg; it builds the project and launches a real Electron main / preload / React app, generating landscape and portrait test videos in a temp directory. `editor-smoke.cjs` uses real mouse / keyboard events to verify the eight crop handles, numeric editing, ratio locking, window resizing, letterbox math, frame-step round trips, Space / I / O, dual sliders and file switching; a disk File is attached via CDP to trigger the production drop handler for real drag-in. `keying-smoke.cjs` additionally verifies the canvas eyedropper, parameter linkage, 250ms debounce, native PNG / alphaextract, solid backgrounds, preset save / load / delete, and single-file plus ratio-cropped batch export from native dialogs to the queue. `tasks-smoke.cjs` further covers job cards, settings persistence and directory effect, real FFmpeg SIGKILL, log expansion and copy, retry / cancel / delete, re-edit submitting new tasks, disk-full hints while running, missing-file relocation, and process cleanup on continue / confirm-exit. It also covers IPC, sandboxing, tool detection with a trimmed PATH, protocol Range, job management and throttled events. Notification, Finder, clipboard and native-dialog tests replace system actions to avoid disturbance; transcoding uses real tools. Tests use isolated temp userData and never read or write the user's jobs.json / presets.json / settings.json, closing test windows when done.

## Project Layout

```text
src/
├── main/
│   ├── index.ts                 # window, app lifecycle, protocol registration
│   ├── ipc.ts                   # fixed channels and sender checks
│   ├── settings.ts              # atomic persistence of concurrency / output / temp dirs
│   ├── quit.ts                  # deduplicated quit confirmation and cleanup order
│   ├── presets.ts               # custom presets JSON and built-in default green
│   ├── exportPaths.ts           # export default filenames and batch de-duplication
│   ├── localfile.ts             # main-process authorization and localfile://media/<token>
│   ├── localFileResponse.ts     # streaming reads, Range / HEAD / 416
│   ├── ffmpeg/
│   │   ├── detectTools.ts       # spawn-based path, version, Alpha preset detection
│   │   ├── probe.ts             # ffprobe JSON and metadata
│   │   ├── buildFilter.ts       # the single filter chain and export/preview args
│   │   ├── diskSpace.ts         # ProRes / HEVC space budget and concurrent reservations
│   │   ├── thumbnail.ts         # native FFmpeg JPEG thumbnail cache
│   │   ├── preview.ts           # single-window cancellable frame preview, waits for old process
│   │   ├── run.ts               # cancellable spawn, progress and stderr tail
│   │   ├── validateOutput.ts    # HEVC / Apple Alpha structure validation
│   │   └── pipeline.ts          # two-phase export, temp dirs and final publication
│   └── jobs/queue.ts            # configurable queue defaulting to concurrency 1
├── preload/
│   ├── index.ts                # contextBridge exposing only fixed DesktopAPI methods
│   └── index.d.ts
├── renderer/src/
│   ├── components/
│   ├── store/appStore.ts       # zustand state
│   ├── store/editorStore.ts    # current file, probe, source-pixel crop / trim, edit sessions
│   ├── editor/                # crop geometry and player shortcuts
│   ├── assets/main.css         # Tailwind entry, default light theme
│   └── App.tsx
└── shared/types.ts             # params with defaults, Job, tool status, IPC channels and API types
```

`localfile://` registers as a streaming-capable secure protocol before Electron ready, installing its handler after ready, per the [Electron protocol docs](https://www.electronjs.org/docs/latest/api/protocol). The main process issues random tokens for native file dialogs or preload-derived disk Files; protocol and probe read only authorized URLs. Video streams by requested range without loading whole files into memory. The renderer disables Node integration, enables context isolation and sandbox, and restricts navigation and new windows.

The command-line script lives at `scripts/test-pipeline.ts`; unit tests sit next to their core modules, named `.test.ts`.

## License

This project is released under the [GNU Affero General Public License v3.0 (AGPL-3.0-only)](./LICENSE).

> Commercial use is allowed, but if you modify and distribute this software, or provide a modified version over a network, you must provide the corresponding source code under AGPL v3.
