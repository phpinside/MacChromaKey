// Real main/preload/renderer; native picker, notifications and Finder are replaced.
const assert = require('node:assert/strict')
const {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readdirSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')
const childProcess = require('node:child_process')
const electron = require('electron')
const { testEditor } = require('./editor-smoke.cjs')
const { testKeying } = require('./keying-smoke.cjs')
const { testTasks } = require('./tasks-smoke.cjs')
const { testGuide } = require('./guide-smoke.cjs')
const { app, BrowserWindow, dialog, net, shell, Notification, clipboard, nativeTheme } = electron
// Never download/install real tools in the UI smoke test.
const realFetch = net.fetch.bind(net)
let installNetwork = 'hang'
const installRequests = []
net.fetch = (url, options) => {
  if (!String(url).startsWith('https://ffmpeg.martin-riedl.de/')) return realFetch(url, options)
  installRequests.push(String(url))
  if (installNetwork === 'fail') return Promise.reject(new Error('测试：下载源暂时不可用'))
  return new Promise((_resolve, reject) => {
    const abort = () => reject(new DOMException('canceled', 'AbortError'))
    if (options?.signal?.aborted) abort()
    else options?.signal?.addEventListener('abort', abort, { once: true })
  })
}

// A GUI launch must not rely on the user's interactive shell PATH.
process.env.PATH = '/usr/bin:/bin'

const directory = mkdtempSync(join(tmpdir(), 'macchromakey-smoke-'))
// Do not read/write the user's real jobs.json or Chrome profile during tests.
app.setPath('userData', directory)
mkdirSync(join(directory, 'exports'))
mkdirSync(join(directory, 'scratch'))
const controls = { slow: false, crash: false, noSpace: false, quitDecision: 0 }
const clipboardWrites = [],
  quitDialogs = [],
  encodePaths = []
clipboard.writeText = (text) => clipboardWrites.push(text)
dialog.showMessageBox = async (...args) => {
  quitDialogs.push(args.at(-1))
  return { response: controls.quitDecision }
}
const shownNotifications = []
const revealedFiles = []
Notification.isSupported = () => true
Notification.prototype.show = function () {
  shownNotifications.push({ title: this.title, body: this.body })
  this.emit('close')
}
shell.showItemInFolder = (path) => revealedFiles.push(path)
const videoPath = join(directory, '绿幕 sample #1.mp4')
const emptyPath = join(directory, 'empty.mp4')
writeFileSync(emptyPath, '')
let selectedPath = videoPath
const saveDialogs = [],
  batchDialogs = [],
  previewSpawns = []
dialog.showSaveDialog = async (_window, options) => {
  saveDialogs.push(options)
  const filePath = controls.nextOutputPath ?? options.defaultPath
  delete controls.nextOutputPath
  return { canceled: false, filePath }
}
dialog.showOpenDialog = async (_window, options) => {
  if (options.properties.includes('openDirectory')) {
    batchDialogs.push(options)
    const path =
      options.title === '选择默认输出目录'
        ? join(directory, 'exports')
        : options.title === '选择临时文件目录'
          ? join(directory, 'scratch')
          : directory
    return { canceled: false, filePaths: [path] }
  }
  return { canceled: false, filePaths: [controls.selectedPath ?? selectedPath] }
}
let simulateMissing = false
const realSpawn = childProcess.spawn
childProcess.spawn = (command, args, options) => {
  if (args.includes('image2pipe')) previewSpawns.push(args[args.indexOf('-vf') + 1])
  const encoding = args.includes('prores_ks')
  if (encoding) encodePaths.push(args.at(-1))
  if (encoding && controls.noSpace) {
    controls.noSpace = false
    return realSpawn('/bin/sh', ['-c', "echo 'No space left on device' >&2; exit 1"], options)
  }
  const child = realSpawn(
    simulateMissing && /\/(ffmpeg|ffprobe)$/.test(command)
      ? join(directory, 'missing-executable')
      : command,
    encoding && controls.slow ? ['-re', ...args] : args,
    options
  )
  if (encoding && controls.crash) {
    controls.crash = false
    child.stdout.once('data', () => child.kill('SIGKILL'))
  }
  return child
}

const deadline = setTimeout(() => {
  console.error('Smoke test timed out')
  app.exit(1)
}, 60000)

require('../out/main/index.js')
assert.equal(app.getPath('userData'), directory, 'smoke must keep its isolated userData directory')

app.whenReady().then(async () => {
  try {
    const window =
      BrowserWindow.getAllWindows()[0] ??
      (await new Promise((resolve) => {
        app.once('browser-window-created', (_event, window) => resolve(window))
      }))
    assert.ok(window, 'main creates a BrowserWindow')
    const contents = window.webContents
    contents.setBackgroundThrottling(false)
    const errors = []
    contents.on('preload-error', (_event, _path, error) => errors.push(error.message))
    if (contents.isLoadingMainFrame()) {
      await new Promise((resolve, reject) => {
        contents.once('did-finish-load', resolve)
        contents.once('did-fail-load', (_event, code, description) =>
          reject(new Error(`${code}: ${description}`))
        )
      })
    }
    const run = (code) => contents.executeJavaScript(code)
    assert.deepEqual(window.getSize(), [1280, 800])
    const preferences = contents.getLastWebPreferences()
    assert.equal(preferences.contextIsolation, true)
    assert.equal(preferences.nodeIntegration, false)
    assert.equal(preferences.sandbox, true)
    assert.equal(await run('typeof window.require'), 'undefined')
    assert.equal(await run('typeof window.api.detectTools'), 'function')
    assert.equal(nativeTheme.shouldUseDarkColors, false)
    assert.equal(await run('getComputedStyle(document.documentElement).colorScheme'), 'light')
    assert.equal(await run("matchMedia('(prefers-color-scheme: dark)').matches"), false)
    await testGuide({ contents, window })

    const report = await run('window.api.detectTools()')
    assert.equal(Object.keys(report.tools).length, 3)
    console.log('Tool detection:', JSON.stringify(report, null, 2))
    assert.ok(
      report.tools.ffmpeg.available,
      'smoke video fixture requires ffmpeg; install with brew install ffmpeg'
    )
    const generated = spawnSync(
      report.tools.ffmpeg.path,
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=320x180:rate=24',
        '-t',
        '4',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        videoPath
      ],
      { encoding: 'utf8' }
    )
    assert.equal(generated.status, 0, generated.stderr)

    const media = await run('window.api.openVideo()')
    assert.match(media.url, /^localfile:\/\/media\//)
    const original = readFileSync(videoPath)
    const full = await net.fetch(media.url)
    assert.equal(full.status, 200)
    assert.equal(full.headers.get('accept-ranges'), 'bytes')
    assert.equal(full.headers.get('content-length'), String(original.length))
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), original)

    for (const [range, start, end] of [
      ['bytes=0-15', 0, 15],
      ['bytes=16-', 16, original.length - 1],
      ['bytes=-16', original.length - 16, original.length - 1],
      [`bytes=10-${original.length + 1000}`, 10, original.length - 1]
    ]) {
      const response = await net.fetch(media.url, { headers: { Range: range } })
      assert.equal(response.status, 206, range)
      assert.equal(
        response.headers.get('content-range'),
        `bytes ${start}-${end}/${original.length}`
      )
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), original.subarray(start, end + 1))
    }
    for (const range of ['bytes=999999999-', 'bytes=5-2', 'bytes=-0', 'bytes=0-1,3-4', 'invalid']) {
      const response = await net.fetch(media.url, { headers: { Range: range } })
      assert.equal(response.status, 416, range)
      assert.equal(response.headers.get('content-range'), `bytes */${original.length}`)
    }
    const head = await net.fetch(media.url, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(head.headers.get('content-length'), String(original.length))
    assert.equal((await head.arrayBuffer()).byteLength, 0)
    assert.equal((await net.fetch(media.url, { method: 'POST' })).status, 405)
    assert.equal((await net.fetch('localfile://media/not-authorized')).status, 404)
    assert.equal(
      (await net.fetch(media.url, { headers: { Origin: 'https://evil.example' } })).status,
      403
    )
    assert.equal((await net.fetch('localfile://media/etc/passwd')).status, 404)
    assert.equal((await net.fetch(`${media.url}?path=/etc/passwd`)).status, 404)

    selectedPath = emptyPath
    const empty = await run('window.api.openVideo()')
    assert.equal((await net.fetch(empty.url)).status, 200)
    assert.equal((await net.fetch(empty.url, { headers: { Range: 'bytes=0-' } })).status, 416)
    rmSync(emptyPath)
    assert.equal((await net.fetch(empty.url)).status, 404)

    selectedPath = videoPath
    // Click the actual UI import button so the Zustand store and React video are exercised.
    const playback = await run(`new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { clearInterval(poll); reject(new Error('video did not load/seek')); }, 12000);
      const poll = setInterval(() => {
        const video = document.querySelector('video');
        if (!video || video.readyState < 1) return;
        clearInterval(poll);
        video.play().then(() => {
          video.pause();
          video.addEventListener('seeked', () => {
            requestAnimationFrame(() => requestAnimationFrame(() => {
              clearTimeout(timeout);
              resolve({ duration: video.duration, currentTime: video.currentTime, width: video.videoWidth, readyState: video.readyState });
            }));
          }, { once: true });
          video.currentTime = 2.5;
        }).catch(reject);
      }, 50);
      [...document.querySelectorAll('button')].find(b => b.textContent.includes('导入视频')).click();
    })`)
    assert.ok(playback.duration >= 3.9)
    assert.ok(Math.abs(playback.currentTime - 2.5) < 0.1)
    assert.equal(playback.width, 320)
    assert.ok(playback.readyState >= 2, 'video decoded a frame')
    assert.equal(
      await run(
        "document.querySelector('[aria-label=\"本机工具状态\"]').textContent.includes('本机环境就绪')"
      ),
      Object.values(report.tools).every((t) => t.available)
    )
    assert.deepEqual(errors, [])
    await testEditor({ contents, window, videoPath, directory, ffmpeg: report.tools.ffmpeg.path })

    await testKeying({ contents, directory, previewSpawns, saveDialogs, batchDialogs })
    shownNotifications.length = 0
    revealedFiles.length = 0

    const params = {
      keyColor: '0x00FF00',
      similarity: 0.3,
      blend: 0.05,
      alphaLow: 100,
      alphaHigh: 200,
      despill: true,
      despillType: 'green',
      crop: null,
      trim: null,
      keepAudio: false
    }
    const addJob = async (request) => {
      controls.nextOutputPath = request.outputPath
      await run(`window.api.chooseExportPaths([${JSON.stringify(media.url)}])`)
      return run(`window.api.jobs.add(${JSON.stringify(request)})`)
    }
    const request = { inputPath: media.path, outputPath: join(directory, 'job-output.mov'), params }
    await run(
      `window.jobEvents = []; window.stopJobEvents = window.api.jobs.onChanged(snapshot => window.jobEvents.push({ at: Date.now(), snapshot })); void 0;`
    )
    const job = await addJob(request)
    const waiting = await addJob({ ...request, outputPath: join(directory, 'second.mov') })
    assert.equal(
      (await run(`window.api.jobs.cancel(${JSON.stringify(waiting.id)})`)).status,
      'canceled'
    )
    await run(`window.api.jobs.retry(${JSON.stringify(waiting.id)})`)
    assert.equal(
      (await run(`window.api.jobs.cancel(${JSON.stringify(waiting.id)})`)).status,
      'canceled'
    )
    await run(`window.api.jobs.remove(${JSON.stringify(waiting.id)})`)
    const done = await run(`new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { clearInterval(poll); reject(new Error('job IPC did not complete')); }, 20000);
      const poll = setInterval(async () => {
        const snapshot = await window.api.jobs.list();
        const job = snapshot.jobs.find(j => j.id === ${JSON.stringify(job.id)});
        if (job?.status === 'failed') { clearTimeout(timeout); clearInterval(poll); reject(new Error(job.error)); }
        if (job?.status === 'done' && window.jobEvents.some(e => e.snapshot.jobs.some(j => j.id === job.id && j.status === 'done'))) {
          clearTimeout(timeout); clearInterval(poll); resolve(job);
        }
      }, 50);
    })`)
    assert.equal(done.stage, 'verifying')
    assert.equal(done.progress, 100)
    assert.equal(shownNotifications.length, 1)
    assert.equal(JSON.parse(readFileSync(join(directory, 'jobs.json'), 'utf8'))[0].status, 'done')
    await run(`window.api.jobs.showOutput(${JSON.stringify(job.id)})`)
    assert.deepEqual(revealedFiles, [realpathSync(request.outputPath)])
    const events = await run('window.jobEvents')
    for (let index = 1; index < events.length; index++) {
      assert.ok(events[index].at - events[index - 1].at >= 180, 'job IPC is throttled to 200 ms')
    }
    await run('window.api.jobs.clearFinished()')
    assert.equal((await run('window.api.jobs.list()')).jobs.length, 0)
    await run('window.api.jobs.setConcurrency(2)')
    assert.equal((await run('window.api.jobs.list()')).concurrency, 2)
    console.log('Expected IPC validation rejection follows: keepAudio must be boolean')
    await assert.rejects(addJob({ ...request, params: { ...params, keepAudio: 'false' } }))
    await run('window.stopJobEvents()')
    const eventCount = await run('window.jobEvents.length')
    await run('window.api.jobs.setConcurrency(1)')
    await new Promise((resolve) => setTimeout(resolve, 250))
    assert.equal(await run('window.jobEvents.length'), eventCount)
    console.log(
      'PASS: jobs IPC, progress events and unsubscribe, cancel/retry/remove/clear, persistence, completion notification and Finder reveal'
    )

    console.log('Expected security rejections: unapproved output/input paths')
    await assert.rejects(
      run(
        `window.api.jobs.add(${JSON.stringify({ ...request, outputPath: join(directory, 'unapproved.mov') })})`
      ),
      /未经授权/
    )
    await assert.rejects(
      run(`window.api.jobs.add(${JSON.stringify({ ...request, inputPath: '/etc/passwd' })})`),
      /未经授权/
    )
    const untrusted = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: join(__dirname, '../out/preload/index.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    await untrusted.loadURL('data:text/html,<h1>Untrusted</h1>')
    await assert.rejects(
      untrusted.webContents.executeJavaScript('window.api.jobs.list()'),
      /不允许的 IPC 来源/
    )
    await assert.rejects(
      untrusted.webContents.executeJavaScript('window.api.ffmpegInstall.start()'),
      /不允许的 IPC 来源/
    )
    untrusted.destroy()
    await testTasks({
      app,
      contents,
      directory,
      media,
      params,
      controls,
      clipboardWrites,
      quitDialogs,
      encodePaths,
      revealedFiles,
      saveDialogs
    })

    const image = await contents.capturePage()
    const screenshot = join(tmpdir(), 'macchromakey-smoke.png')
    writeFileSync(screenshot, image.toPNG())
    assert.equal(
      installRequests.length,
      0,
      'valid system tools must not trigger an automatic download'
    )
    simulateMissing = true
    const missing = await run('window.api.detectTools()')
    assert.equal(missing.tools.ffmpeg.available, false)
    assert.equal(missing.tools.ffprobe.available, false)
    await run(`new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { clearInterval(poll); reject(new Error('missing tools UI did not update')); }, 12000);
      const poll = setInterval(() => {
        const status = document.querySelector('[aria-label="本机工具状态"]');
        if (status.textContent.includes('brew install ffmpeg')) {
          clearTimeout(timeout); clearInterval(poll);
          resolve(status.className.includes('bg-red'));
        }
      }, 50);
      [...document.querySelectorAll('button')].find(b => b.textContent.includes('重新检测')).click();
    })`).then((red) => assert.equal(red, true))
    await run(`new Promise((resolve,reject)=>{const deadline=Date.now()+5000;const poll=setInterval(()=>{
      const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='取消安装');
      if(button){clearInterval(poll);button.click();resolve()}
      else if(Date.now()>deadline){clearInterval(poll);reject(new Error('automatic installation did not start'))}
    },30)})`)
    const canceled =
      await run(`new Promise((resolve,reject)=>{const deadline=Date.now()+5000;const poll=setInterval(async()=>{
      const state=await window.api.ffmpegInstall.state();
      if(state.stage==='canceled'){clearInterval(poll);resolve(state)}
      else if(Date.now()>deadline){clearInterval(poll);reject(new Error('installation did not cancel'))}
    },30)})`)
    assert.equal(canceled.stage, 'canceled')
    assert.equal(installRequests.length, 1)
    installNetwork = 'fail'
    const failedInstall = await run('window.api.ffmpegInstall.start()')
    assert.equal(failedInstall.stage, 'failed')
    assert.match(failedInstall.error, /下载源暂时不可用/)
    await run(`new Promise((resolve,reject)=>{const deadline=Date.now()+5000;const poll=setInterval(()=>{
      const text=document.querySelector('[aria-label="FFmpeg 安装状态"]')?.textContent||'';
      if(text.includes('下载源暂时不可用') && text.includes('重试安装')){clearInterval(poll);resolve()}
      else if(Date.now()>deadline){clearInterval(poll);reject(new Error('install retry UI missing'))}
    },30)})`)
    assert.equal(
      installRequests.length,
      2,
      'failed/canceled installation must not loop automatically'
    )
    console.log(
      `PASS: IPC, sandbox, tool detection and missing-tool UI, authorized localfile, 200/206/416/HEAD, real <video> loading and seeking. Screenshot: ${screenshot}`
    )
    simulateMissing = false
    controls.slow = true
    controls.quitDecision = 1
    const exiting = await addJob({
      inputPath: media.path,
      outputPath: join(directory, 'quit.mov'),
      params
    })
    await run(`new Promise((resolve,reject)=>{const deadline=Date.now()+10000;const poll=setInterval(async()=>{
      const {jobs}=await window.api.jobs.list(); const job=jobs.find(j=>j.id===${JSON.stringify(exiting.id)});
      if(job?.status==='running' && job.progress>0){clearInterval(poll);resolve()}
      else if(Date.now()>deadline){clearInterval(poll);reject(new Error('exit job did not start'))}
    },30)})`)
    app.once('will-quit', () => {
      try {
        assert.ok(quitDialogs.length >= 2)
        assert.deepEqual(readdirSync(join(directory, 'scratch')), [])
        const saved = JSON.parse(readFileSync(join(directory, 'jobs.json'), 'utf8'))
        assert.equal(saved[0].status, 'running', 'restart will recover interrupted job as failed')
        console.log(
          'PASS: confirmed app quit waits for native encoder termination, temp cleanup and interrupted-job persistence'
        )
        clearTimeout(deadline)
        rmSync(directory, { recursive: true, force: true })
      } catch (error) {
        console.error(error)
        app.exit(1)
      }
    })
    app.quit()
  } catch (error) {
    console.error(error)
    clearTimeout(deadline)
    rmSync(directory, { recursive: true, force: true })
    app.exit(1)
  }
})
