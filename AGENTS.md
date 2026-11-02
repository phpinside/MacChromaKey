# 项目：MacChromaKey —— 本地绿幕抠像工具（macOS）

## 目标
用户导入绿幕视频 → 在 UI 中预览、裁剪、设置抠像参数 → 提交后台任务 →
输出 HEVC with Alpha 的 .mov 文件（可被 Safari / Apple 生态直接使用）。

## 技术栈（不要擅自更换）
- Electron + Vite + React + TypeScript（使用 electron-vite 模板）
- 状态管理：zustand
- 样式：Tailwind CSS
- 视频处理：原生 ffmpeg / ffprobe + macOS 自带 avconvert，通过 child_process.spawn 调用
- 禁止：Python、FFmpeg.wasm、WebGL 自实现抠像、任何云服务

## 已验证的核心管线（以此为准，参数化即可）
步骤1（ffmpeg，输出带 alpha 的 ProRes 4444 中间文件）：
ffmpeg -y -i input.mp4 \
  -vf "chromakey=0x00FF00:0.3:0.05,format=yuva420p,lutyuv=a='clip((val-100)*255/(200-100),0,255)',despill=type=green,format=yuva444p10le" \
  -c:v prores_ks -profile:v 4444 -an temp.mov
步骤2（Apple 转码）：
avconvert --preset PresetHEVCHighestQualityWithAlpha --source temp.mov --output output.mov --replace

## 参数模型（TypeScript 类型，所有模块共用）
- keyColor: string（默认 "0x00FF00"）
- similarity: number（chromakey 第一个参数，0.01–1，默认 0.3）
- blend: number（chromakey 第二个参数，0–1，默认 0.05）
- alphaLow: number（lutyuv 下限，0–255，默认 100）
- alphaHigh: number（lutyuv 上限，0–255，默认 200）
- despill: boolean + despillType: "green" | "blue"（默认开启 green）
- crop: { x, y, w, h } | null（源视频像素坐标，保存时自动取偶数）
- trim: { start, end } | null（秒）
- keepAudio: boolean（默认 false）

## 架构约束
- 滤镜链只在一个文件 `src/main/ffmpeg/buildFilter.ts` 里构建，预览与导出共用。
- 渲染进程不能直接用 Node API；通过 preload + contextBridge 暴露类型安全的 IPC。
- ffmpeg/ffprobe 路径要自动探测（/opt/homebrew/bin、/usr/local/bin、which），
  因为 Electron GUI 应用不继承 shell 的 PATH；找不到时在 UI 里提示安装方法（brew install ffmpeg）。
- 所有任务在主进程的队列里执行，默认并发 1，可配置。
- 代码要简洁，不要过度设计，不要引入不必要的依赖。