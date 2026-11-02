const assert = require('node:assert/strict')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')

async function testEditor({ contents, window, videoPath, directory, ffmpeg }) {
  const run = (code) => contents.executeJavaScript(code)
  const settle = () =>
    run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const wait = (condition) =>
    run(`new Promise((resolve, reject) => {
    const timer = setTimeout(() => { clearInterval(poll); reject(new Error(${JSON.stringify(condition)})); }, 8000);
    const poll = setInterval(() => { if (${condition}) { clearTimeout(timer); clearInterval(poll); resolve(true); } }, 25);
  })`)
  const crop = () =>
    run(
      `Object.fromEntries(['x','y','w','h'].map(key => [key, Number(document.querySelector('[aria-label="裁剪 '+key+'"]').value)]))`
    )
  const rect = (selector) =>
    run(
      `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; })()`
    )
  const key = async (keyCode) => {
    contents.sendInputEvent({ type: 'keyDown', keyCode })
    contents.sendInputEvent({ type: 'keyUp', keyCode })
    await settle()
  }
  const numeric = async (field, value) => {
    await run(
      `(() => { const input = document.querySelector('[aria-label="裁剪 ${field}"]'); input.focus(); input.select(); })()`
    )
    await contents.insertText(String(value))
    await settle()
  }
  const resetCrop = async () => {
    await run(
      "[...document.querySelectorAll('button')].find(b => b.textContent.includes('重置 / 全画面')).click()"
    )
    await numeric('w', 160)
    await numeric('h', 90)
    await numeric('x', 80)
    await numeric('y', 40)
    assert.deepEqual(await crop(), { x: 80, y: 40, w: 160, h: 90 })
  }
  const drag = async (selector, dx, dy) => {
    const r = await rect(selector)
    const x = Math.round(r.x + r.w / 2),
      y = Math.round(r.y + r.h / 2)
    contents.sendInputEvent({ type: 'mouseMove', x, y })
    await settle()
    contents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x, y })
    await settle()
    for (let step = 1; step <= 3; step++) {
      contents.sendInputEvent({
        type: 'mouseMove',
        button: 'left',
        x: Math.round(x + (dx * step) / 3),
        y: Math.round(y + (dy * step) / 3)
      })
      await settle()
    }
    contents.sendInputEvent({
      type: 'mouseUp',
      button: 'left',
      clickCount: 1,
      x: Math.round(x + dx),
      y: Math.round(y + dy)
    })
    await settle()
  }
  const seek = (time) =>
    run(
      `new Promise((resolve, reject) => { const video = document.querySelector('video'); video.pause(); if (Math.abs(video.currentTime-${time}) < .0001) { resolve(); return; } const timer=setTimeout(()=>reject(new Error('seek ${time} timed out')),8000); video.addEventListener('seeked', () => {clearTimeout(timer);resolve()}, {once:true}); video.currentTime = ${time}; })`
    )
  const trimPoint = (point) =>
    run(
      `Number(document.querySelector('[data-trim-point="${point}"]').getAttribute('aria-valuenow'))`
    )

  assert.match(
    await run("document.querySelector('[data-testid=probe-info]').textContent"),
    /320 × 180.*24 fps/
  )
  assert.equal(await run("document.querySelector('video').controls"), false)
  await resetCrop()
  const viewport = await rect('[data-testid="crop-viewport"]')
  const box = await rect('[data-testid="crop-box"]')
  assert.ok(Math.abs(box.x - viewport.x - (80 * viewport.w) / 320) < 2)
  assert.ok(Math.abs(box.y - viewport.y - (40 * viewport.h) / 180) < 2)
  await drag('[data-testid="crop-box"]', 20, 10)
  const moved = await crop()
  assert.ok(Math.abs(moved.x - 80 - 20 / (viewport.w / 320)) <= 1)
  assert.equal(moved.w, 160)
  assert.equal(moved.h, 90)
  window.setSize(1100, 760)
  await new Promise((resolve) => setTimeout(resolve, 100))
  await settle()
  assert.deepEqual(await crop(), moved)
  const smaller = await rect('[data-testid="crop-viewport"]')
  const smallBox = await rect('[data-testid="crop-box"]')
  assert.ok(Math.abs(smallBox.x - smaller.x - (moved.x * smaller.w) / 320) < 2)
  window.setSize(1280, 800)
  await new Promise((resolve) => setTimeout(resolve, 100))
  await settle()
  for (const handle of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
    await resetCrop()
    await drag(`[data-handle="${handle}"]`, 8, 6)
    const changed = await crop()
    assert.notDeepEqual(changed, { x: 80, y: 40, w: 160, h: 90 }, `pointer resize ${handle}`)
    assert.ok(
      changed.x >= 0 &&
        changed.y >= 0 &&
        changed.x + changed.w <= 320 &&
        changed.y + changed.h <= 180
    )
  }
  await run(
    `(() => { const select=document.querySelector('[aria-label="裁剪宽高比"]'); select.value='1:1'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`
  )
  await settle()
  await drag('[data-handle="se"]', -10, -8)
  const square = await crop()
  console.log('Editor: pointer crop, numeric fields, aspect and resize checks passed')
  assert.equal(square.w, square.h)
  await run('document.activeElement.blur()')
  await seek(1)
  await key('Right')
  await wait("!document.querySelector('video').seeking")
  assert.ok(
    Math.abs((await run("document.querySelector('video').currentTime")) - (1 + 1 / 24)) < 0.002
  )
  await key('Left')
  await wait("!document.querySelector('video').seeking")
  assert.ok(Math.abs((await run("document.querySelector('video').currentTime")) - 1) < 0.002)
  await key('Space')
  await wait("!document.querySelector('video').paused")
  await key('Space')
  await wait("document.querySelector('video').paused")
  console.log('Editor: frame stepping and space shortcut checks passed')
  await seek(1)
  await run('document.querySelector(\'[aria-label="播放进度"]\').focus()')
  await key('I')
  assert.ok(Math.abs((await trimPoint('start')) - 1) < 0.001)
  await seek(2)
  await key('O')
  assert.ok(Math.abs((await trimPoint('end')) - 2) < 0.001)
  await run(
    "[...document.querySelectorAll('button')].find(b => b.textContent === '全时长').click()"
  )
  await settle()
  const track = await rect('[data-testid="trim-track"]')
  await drag('[data-trim-point="start"]', track.w / 4, 0)
  await drag('[data-trim-point="end"]', -track.w / 4, 0)
  assert.ok(Math.abs((await trimPoint('start')) - 1) < 1 / 24 + 0.001)
  assert.ok(Math.abs((await trimPoint('end')) - 3) < 1 / 24 + 0.001)
  await drag('[data-trim-point="start"]', track.w, 0)
  assert.ok((await trimPoint('end')) - (await trimPoint('start')) >= 1 / 24 - 0.00001)

  // CDP assigns a real disk-backed File; the production drop handler uses webUtils in preload.
  console.log('Editor: trim slider and I/O checks passed; testing native File drop')
  const portrait = join(directory, 'portrait.mov')
  const generated = spawnSync(
    ffmpeg,
    [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=green:s=180x320:r=24:d=2',
      '-c:v',
      'libx264',
      portrait
    ],
    { encoding: 'utf8' }
  )
  assert.equal(generated.status, 0, generated.stderr)
  contents.debugger.attach('1.3')
  await run(
    "{ const input=document.createElement('input'); input.type='file'; input.id='drop-fixture'; input.hidden=true; document.body.append(input); } void 0"
  )
  const document = await contents.debugger.sendCommand('DOM.getDocument')
  const node = await contents.debugger.sendCommand('DOM.querySelector', {
    nodeId: document.root.nodeId,
    selector: '#drop-fixture'
  })
  await contents.debugger.sendCommand('DOM.setFileInputFiles', {
    nodeId: node.nodeId,
    files: [portrait]
  })
  await run(
    "{ const dt=new DataTransfer(); dt.items.add(document.querySelector('#drop-fixture').files[0]); document.querySelector('[aria-label=\"视频预览工作区\"]').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt})); } void 0"
  )
  await wait("document.querySelector('[data-testid=probe-info]').textContent.includes('180 × 320')")
  await settle()
  const portraitViewport = await rect('[data-testid="crop-viewport"]')
  const surface = await rect('[data-testid="video-surface"]')
  assert.ok(portraitViewport.x > surface.x + 30, 'portrait left/right letterboxing')
  assert.ok(Math.abs(portraitViewport.w / portraitViewport.h - 180 / 320) < 0.001)
  await run(
    `[...document.querySelectorAll('.media-item')].find(b=>b.textContent.includes(${JSON.stringify(videoPath.split('/').pop())})).click()`
  )
  await wait("document.querySelector('[data-testid=probe-info]').textContent.includes('320 × 180')")
  await settle()
  assert.deepEqual(await crop(), square)
  assert.ok(Math.abs((await trimPoint('end')) - (await trimPoint('start')) - 1 / 24) < 0.001)
  await assert.rejects(run("window.api.importVideo(new File(['fake'], 'fake.mp4'))"))
  await run("document.querySelector('#drop-fixture').remove(); void 0")
  contents.debugger.detach()
  console.log(
    'PASS: editor probe, custom playback/frame shortcuts, eight pointer resize handles, numeric crop, aspect lock, letterbox/resize geometry, trim sliders/I/O, real disk-file drop, per-file edit state'
  )
}

module.exports = { testEditor }
