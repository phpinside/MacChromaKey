// Audit the actual artifacts, then launch each app with an isolated profile through CDP.
const assert = require('node:assert/strict')
const { execFileSync, spawn } = require('node:child_process')
const {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync
} = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const net = require('node:net')
const asar = require('@electron/asar')
const version = require('../package.json').version
const productName = require('../package.json').productName
const dist = resolve(process.argv[2] ?? 'dist')
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

async function freePort() {
  const server = net.createServer()
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const port = server.address().port
  await new Promise((done) => server.close(done))
  return port
}
async function connect(url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  let id = 0
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (!message.id) return
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(message.id)
    if (message.error) request.reject(new Error(JSON.stringify(message.error)))
    else request.resolve(message.result)
  })
  socket.addEventListener('close', () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('CDP closed'))
    }
    pending.clear()
  })
  await new Promise((done, reject) => {
    socket.addEventListener('open', done, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  return {
    socket,
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const key = ++id
        const timer = setTimeout(() => {
          pending.delete(key)
          reject(new Error(`CDP timed out: ${method}`))
        }, 15000)
        pending.set(key, { resolve, reject, timer })
        socket.send(JSON.stringify({ id: key, method, params }))
      })
    }
  }
}
async function launch(appPath, arch) {
  const directory = mkdtempSync(join(tmpdir(), `macchromakey-package-${arch}-`))
  const profile = join(directory, 'profile')
  mkdirSync(profile)
  const port = await freePort()
  const child = spawn(
    join(appPath, 'Contents/MacOS/MacChromaKey'),
    [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`],
    {
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: '1',
        ELECTRON_RENDERER_URL: '',
        PATH: '/usr/bin:/bin'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  let logs = '',
    cdp
  child.stdout.on('data', (chunk) => {
    logs = (logs + chunk).slice(-32000)
  })
  child.stderr.on('data', (chunk) => {
    logs = (logs + chunk).slice(-32000)
  })
  let spawnError
  child.on('error', (error) => {
    spawnError = error
  })
  try {
    let page
    const deadline = Date.now() + (arch === 'x64' ? 60000 : 25000)
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError
      if (child.exitCode !== null || child.signalCode)
        throw new Error(`Packaged app exited: ${logs}`)
      try {
        const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        page = pages.find(
          (p) => p.type === 'page' && p.url.includes('/app.asar/out/renderer/index.html')
        )
        if (page) break
      } catch {
        /* startup */
      }
      await sleep(100)
    }
    if (!page) throw new Error(`Packaged app did not load renderer: ${logs}`)
    cdp = await connect(page.webSocketDebuggerUrl)
    const evaluate = async (expression) => {
      const reply = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true
      })
      if (reply.exceptionDetails)
        throw new Error(
          reply.exceptionDetails.exception?.description ?? JSON.stringify(reply.exceptionDetails)
        )
      return reply.result?.value
    }
    const wait = async (condition) => {
      const end = Date.now() + 15000
      while (Date.now() < end) {
        if (await evaluate(condition)) return
        await sleep(50)
      }
      throw new Error(`Packaged UI timed out: ${condition}\n${logs}`)
    }
    await wait('!!window.api?.detectTools')
    assert.equal(await evaluate('getComputedStyle(document.documentElement).colorScheme'), 'light')
    assert.equal(await evaluate("matchMedia('(prefers-color-scheme: dark)').matches"), false)
    await wait("document.querySelector('[aria-labelledby=guide-title]')?.open")
    assert.equal(await evaluate("document.querySelector('h1').textContent.trim()"), productName)
    assert.ok(
      await evaluate(
        "document.querySelector('[aria-label=\"参数面板\"]').textContent.includes('松开滑块后更新预览')"
      )
    )
    await wait("document.querySelector('header.titlebar img')?.naturalWidth>0")
    await evaluate(
      "document.querySelector('[aria-labelledby=guide-title] .primary-button').click()"
    )
    await wait("!document.querySelector('[aria-labelledby=guide-title]')")
    assert.equal(await evaluate('typeof window.require'), 'undefined')
    assert.equal((await evaluate('window.api.jobs.list()')).jobs.length, 0)
    assert.ok(existsSync(join(profile, 'jobs.json')), 'app state uses isolated profile')
    const report = await evaluate('window.api.detectTools()')
    assert.ok(report.tools.ffmpeg.available && report.tools.ffprobe.available)
    assert.equal(report.tools.avconvert.path, '/usr/bin/avconvert')
    assert.ok(!report.tools.ffmpeg.path.includes('.asar'), 'native tool is not inside asar')
    const input = join(directory, 'package-video.mp4')
    execFileSync(report.tools.ffmpeg.path, [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x00ff00:s=320x180:r=24:d=1,drawbox=x=80:y=30:w=100:h=100:color=red:t=fill',
      '-c:v',
      'libx264',
      input
    ])
    await evaluate(
      `{const input=document.createElement('input');input.type='file';input.id='package-fixture';input.hidden=true;document.body.append(input)} void 0`
    )
    const document = await cdp.send('DOM.getDocument')
    const node = await cdp.send('DOM.querySelector', {
      nodeId: document.root.nodeId,
      selector: '#package-fixture'
    })
    await cdp.send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [input] })
    await evaluate(
      `{const dt=new DataTransfer();dt.items.add(document.querySelector('#package-fixture').files[0]);document.querySelector('[aria-label="视频预览工作区"]').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}))} void 0`
    )
    await wait("document.querySelector('video')?.readyState>=2")
    assert.equal(await evaluate("document.querySelector('video').videoWidth"), 320)
    await evaluate(
      "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='使用小体积设置 · 720px / 24fps').click()"
    )
    await wait("document.querySelector('[aria-label=\"导出最长边\"]').value==='720'")
    assert.equal(
      await evaluate('document.querySelector(\'[aria-label="导出帧率上限"]\').value'),
      '24'
    )
    await evaluate(
      "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='抠像结果').click()"
    )
    await wait("document.querySelector('[data-testid=processed-frame]')?.naturalWidth>0")
    assert.ok(
      await evaluate(
        "document.querySelector('[data-testid=processed-frame]').src.startsWith('blob:')"
      )
    )
    if (arch === 'arm64') {
      const screenshots = join(dist, 'screenshots')
      mkdirSync(screenshots, { recursive: true })
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(
        join(screenshots, 'workspace-light.png'),
        Buffer.from(screenshot.data, 'base64')
      )
    }
    console.log(
      `PASS: packaged ${arch} app, isolated profile, trusted IPC, system tools, disk-file import, localfile video, compact export settings and FFmpeg Blob preview`
    )
  } finally {
    if (cdp) {
      await cdp.send('Browser.close').catch(() => {})
      cdp.socket.close()
    }
    const end = Date.now() + 5000
    while (child.exitCode === null && !child.signalCode && Date.now() < end) await sleep(100)
    let killTimer
    if (child.exitCode === null && !child.signalCode) {
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), 3000)
    }
    await new Promise((done) => {
      if (child.exitCode !== null || child.signalCode) done()
      else child.once('close', done)
    })
    clearTimeout(killTimer)
    rmSync(directory, { recursive: true, force: true })
  }
}
async function main() {
  const targets = process.argv.slice(3).length ? process.argv.slice(3) : ['arm64', 'x64']
  for (const arch of targets) {
    assert.ok(['arm64', 'x64'].includes(arch), 'expected arm64 or x64')
    const app = join(dist, arch === 'arm64' ? 'mac-arm64' : 'mac', 'MacChromaKey.app')
    const dmg = join(dist, `${productName}-${version}-${arch}.dmg`)
    assert.ok(existsSync(dmg), `missing ${dmg}`)
    const actual = execFileSync(
      '/usr/bin/lipo',
      ['-archs', join(app, 'Contents/MacOS/MacChromaKey')],
      { encoding: 'utf8' }
    ).trim()
    assert.equal(actual, arch === 'x64' ? 'x86_64' : 'arm64')
    assert.equal(
      execFileSync(
        '/usr/libexec/PlistBuddy',
        ['-c', 'Print :CFBundleDisplayName', join(app, 'Contents/Info.plist')],
        { encoding: 'utf8' }
      ).trim(),
      productName
    )
    const iconName = execFileSync(
      '/usr/libexec/PlistBuddy',
      ['-c', 'Print :CFBundleIconFile', join(app, 'Contents/Info.plist')],
      { encoding: 'utf8' }
    ).trim()
    const icon = join(
      app,
      'Contents/Resources',
      iconName.endsWith('.icns') ? iconName : `${iconName}.icns`
    )
    assert.deepEqual(
      readFileSync(icon),
      readFileSync(join(__dirname, '../build/chroma-icon.icns')),
      'bundle uses the new app icon'
    )
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' })
    execFileSync('/usr/bin/hdiutil', ['verify', dmg], { stdio: 'pipe' })
    const archive = join(app, 'Contents/Resources/app.asar')
    const files = asar.listPackage(archive)
    for (const prefix of ['/src', '/scripts', '/AGENTS.md', '/input.mp4', '/.env', '/resources'])
      assert.ok(
        !files.some((p) => p === prefix || p.startsWith(prefix + '/')),
        `unexpected packaged content ${prefix}`
      )
    const pkg = JSON.parse(asar.extractFile(archive, 'package.json').toString())
    assert.equal(pkg.main, './out/main/index.js')
    console.log(
      `PASS: ${arch} Mach-O, ad-hoc signature, DMG integrity, asar allowlist (${files.length} entries)`
    )
    if (arch === 'x64' && process.arch === 'arm64')
      execFileSync('/usr/bin/arch', ['-x86_64', '/usr/bin/true']) // Rosetta availability
    await launch(app, arch)
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
