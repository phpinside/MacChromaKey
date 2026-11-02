const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

async function testKeying({ contents, directory, previewSpawns, saveDialogs, batchDialogs }) {
  const run = (code) => contents.executeJavaScript(code)
  const wait = (condition, timeout = 12000) =>
    run(`new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{clearInterval(poll);reject(new Error(${JSON.stringify(condition)}))},${timeout});
    const poll=setInterval(()=>{if(${condition}){clearTimeout(timer);clearInterval(poll);resolve()}},25);
  })`)
  const settle = () => run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  const click = async (label) => {
    await run(
      `{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}); if(!button) throw new Error('button missing: '+${JSON.stringify(label)});button.click();} void 0`
    )
    await settle()
  }
  const field = async (label, value) => {
    await run(
      `{const input=document.querySelector('[aria-label=${JSON.stringify(label)}]');input.focus();input.select();} void 0`
    )
    await contents.insertText(String(value))
    if (await run("document.activeElement.type==='number'")) {
      contents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
      contents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
    }
    await settle()
  }
  const select = async (label, value) => {
    await run(
      `{const select=document.querySelector('[aria-label=${JSON.stringify(label)}]'); select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}));} void 0`
    )
    await settle()
  }
  const checked = async (text, value) => {
    await run(
      `{const label=[...document.querySelectorAll('label')].find(l=>l.textContent.includes(${JSON.stringify(text)}));const input=label.querySelector('input');if(input.checked!==${value})input.click();} void 0`
    )
    await settle()
  }
  await click('重置 / 全画面')
  await click('全时长')
  await wait(
    "document.querySelector('video').readyState>=2 && !document.querySelector('video').seeking"
  )
  const expected =
    await run(`(()=>{const video=document.querySelector('video');video.pause(); const c=document.createElement('canvas');c.width=c.height=1;
    const ctx=c.getContext('2d');ctx.drawImage(video,160,90,1,1,0,0,1,1);
    return '0x'+Array.from(ctx.getImageData(0,0,1,1).data.slice(0,3),v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();})()`)
  await click('吸管取色')
  const center = await run(
    `(()=>{const v=document.querySelector('video').getBoundingClientRect();return {x:Math.round(v.x+v.width/2),y:Math.round(v.y+v.height/2)}})()`
  )
  contents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...center })
  contents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...center })
  await wait("!document.querySelector('[data-testid=color-pick-overlay]')")
  assert.ok(
    await run(
      `document.querySelector('[aria-label="参数面板"]').textContent.includes(${JSON.stringify(expected)})`
    ),
    'eyedropper reads actual source pixels'
  )
  await click('载入') // restore default green
  await field('相似度数值', 0.41)
  await field('边缘混合数值', 0.08)
  await field('Alpha 下限数值', 80)
  await field('Alpha 上限数值', 220)
  await checked('去溢色', false)
  await checked('去溢色', true)
  await select('去溢色类型', 'blue')
  await click('使用小体积设置 · 720px / 24fps')
  assert.equal(await run('document.querySelector(\'[aria-label="导出最长边"]\').value'), '720')
  await select('导出帧率上限', '15')

  await field('预设名称', 'Smoke 蓝幕')
  await click('保存')
  await wait(
    `document.querySelector('[aria-label="选择参数预设"]').selectedOptions[0]?.textContent==='Smoke 蓝幕'`
  )
  const saved = JSON.parse(readFileSync(join(directory, 'presets.json'), 'utf8'))
  assert.equal(saved[0].params.similarity, 0.41)
  assert.equal(saved[0].params.despillType, 'blue')
  assert.equal(saved[0].params.exportMaxEdge, 720)
  assert.equal(saved[0].params.exportFps, 15)
  await field('相似度数值', 0.2)
  await click('载入')
  assert.equal(
    await run('Number(document.querySelector(\'[aria-label="相似度数值"]\').value)'),
    0.41
  )

  await run(
    `{ const create=URL.createObjectURL.bind(URL), revoke=URL.revokeObjectURL.bind(URL);window.previewURLs={created:[],revoked:[]};URL.createObjectURL=(blob)=>{const url=create(blob);window.previewURLs.created.push(url);return url};URL.revokeObjectURL=(url)=>{window.previewURLs.revoked.push(url);revoke(url)};} void 0`
  )
  await click('抠像结果')
  await wait("document.querySelector('[data-testid=processed-frame]')?.complete")
  const first = await run("document.querySelector('[data-testid=processed-frame]').src")
  assert.match(first, /^blob:/)

  // A pause longer than the preview debounce while holding the mouse must not commit.
  const range = '[aria-label="相似度"]'
  await run(`document.querySelector(${JSON.stringify(range)}).scrollIntoView({block:'center'})`)
  await settle()
  const slider = await run(
    `(()=>{const r=document.querySelector(${JSON.stringify(range)}).getBoundingClientRect();return {x:Math.round(r.x+r.width*.6),y:Math.round(r.y+r.height/2),outsideY:Math.round(r.bottom+30)}})()`
  )
  const dragStart = previewSpawns.length
  contents.sendInputEvent({ type: 'mouseMove', x: slider.x, y: slider.y })
  await settle()
  contents.sendInputEvent({
    type: 'mouseDown',
    button: 'left',
    clickCount: 1,
    x: slider.x,
    y: slider.y
  })
  await run('new Promise(resolve=>setTimeout(resolve,400))')
  const pendingValue = await run(
    'Number(document.querySelector(\'[aria-label="相似度数值"]\').value)'
  )
  assert.notEqual(pendingValue, 0.41, 'drag updates the local control value')
  assert.equal(previewSpawns.length, dragStart, 'holding a slider does not start FFmpeg')
  assert.equal(
    await run("document.querySelector('[data-testid=processed-frame]').src"),
    first,
    'existing preview remains visible during drag'
  )
  contents.sendInputEvent({
    type: 'mouseMove',
    x: slider.x,
    y: slider.outsideY,
    modifiers: ['leftButtonDown']
  })
  contents.sendInputEvent({
    type: 'mouseUp',
    button: 'left',
    clickCount: 1,
    x: slider.x,
    y: slider.outsideY
  })
  await settle()
  await wait(
    `document.querySelector('[data-testid=processed-frame]')?.complete && document.querySelector('[data-testid=processed-frame]').src!==${JSON.stringify(first)}`
  )
  assert.equal(
    previewSpawns.length,
    dragStart + 1,
    'release outside the slider commits one preview'
  )
  assert.ok(previewSpawns.at(-1).includes(`chromakey=0x00FF00:${pendingValue}:0.08`))

  // Repeated keyboard adjustments also stay local until the adjustment key is released.
  await run(`document.querySelector(${JSON.stringify(range)}).focus()`)
  const keyboardStart = previewSpawns.length
  const beforeKey = await run("document.querySelector('[data-testid=processed-frame]').src")
  contents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' })
  await run('new Promise(resolve=>setTimeout(resolve,350))')
  assert.equal(previewSpawns.length, keyboardStart)
  assert.equal(
    await run('Number(document.querySelector(\'[aria-label="相似度数值"]\').value)'),
    Number((pendingValue + 0.01).toFixed(2))
  )
  contents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' })
  await settle()
  await wait(
    `document.querySelector('[data-testid=processed-frame]')?.complete && document.querySelector('[data-testid=processed-frame]').src!==${JSON.stringify(beforeKey)}`
  )
  assert.equal(previewSpawns.length, keyboardStart + 1)

  const before = previewSpawns.length
  await field('相似度数值', 0.42)
  await field('相似度数值', 0.43)
  await field('相似度数值', 0.44)
  await wait("document.querySelector('[data-testid=processed-frame]')?.complete")
  assert.equal(previewSpawns.length - before, 1, '250ms debounce coalesces rapid edits')
  assert.ok(previewSpawns.at(-1).includes('chromakey=0x00FF00:0.44:0.08'))
  assert.ok(previewSpawns.at(-1).includes('scale=320:180'), previewSpawns.at(-1))
  const frameCount = previewSpawns.length
  await select('导出帧率上限', '24')
  await run('new Promise(resolve=>setTimeout(resolve,350))')
  assert.equal(previewSpawns.length, frameCount, 'fps-only edits do not restart a frame preview')
  await select('导出帧率上限', '15')
  await select('预览背景', 'solid')
  assert.ok(await run('!!document.querySelector(\'[aria-label="预览背景颜色"]\')'))
  await click('Alpha 蒙版')
  await wait(
    "document.querySelector('[data-testid=processed-frame]')?.alt==='Alpha 蒙版' && document.querySelector('[data-testid=processed-frame]').complete"
  )
  assert.ok(previewSpawns.at(-1).includes('alphaextract,format=rgba'))
  await click('原图')
  assert.deepEqual(
    await run('window.previewURLs.created'),
    await run('window.previewURLs.revoked'),
    'preview Blob URLs released on parameter/mode changes'
  )

  // Actual UI export action -> native dialog -> job:add -> native pipeline.
  await click('开始导出')
  await wait(
    "document.querySelector('[aria-label=\"导出设置\"]').textContent.includes('已加入 1 个导出任务')"
  )
  assert.match(saveDialogs.at(-1).defaultPath, /_alpha\.mov$/)
  let jobs = await run('window.api.jobs.list()')
  assert.equal(jobs.jobs.length, 1)
  assert.equal(jobs.jobs[0].params.similarity, 0.44)
  assert.equal(jobs.jobs[0].params.exportMaxEdge, 720)
  assert.equal(jobs.jobs[0].params.exportFps, 15)
  await wait(
    "document.querySelector('[aria-label=\"文件与任务列表\"]').textContent.includes('已完成')",
    25000
  )
  await run('window.api.jobs.clearFinished()')
  await field('裁剪 w', 160)
  await field('裁剪 h', 90)
  await checked('应用到队列中全部视频', true)
  await click('开始导出 · 2 个视频')
  await wait(
    "document.querySelector('[aria-label=\"导出设置\"]').textContent.includes('已加入 2 个导出任务')"
  )
  assert.ok(batchDialogs.length)
  jobs = await run('window.api.jobs.list()')
  assert.equal(jobs.jobs.length, 2)
  assert.deepEqual(jobs.jobs[0].params.crop, { x: 0, y: 0, w: 160, h: 90 })
  assert.deepEqual(jobs.jobs[1].params.crop, { x: 0, y: 0, w: 90, h: 160 })
  assert.notEqual(
    jobs.jobs[0].outputPath,
    saveDialogs.at(-1).defaultPath,
    'batch avoids prior output'
  )
  await run(`new Promise((resolve,reject)=>{const deadline=Date.now()+25000;const poll=setInterval(async()=>{
    const {jobs}=await window.api.jobs.list(); if(jobs.some(j=>j.status==='failed')){clearInterval(poll);reject(new Error(JSON.stringify(jobs)));return}
    if(jobs.every(j=>j.status==='done')){clearInterval(poll);resolve()}
    else if(Date.now()>deadline){clearInterval(poll);reject(new Error('batch exports timed out'))}
  },50)})`)
  await run('window.api.jobs.clearFinished()')
  await run(
    `[...document.querySelector('[aria-label="参数预设"]').querySelectorAll('button')].find(b=>b.textContent.trim()==='删除').click()`
  )
  await run(
    `new Promise((resolve,reject)=>{const limit=Date.now()+5000;const timer=setInterval(async()=>{if((await window.api.presets.list()).length===1){clearInterval(timer);resolve()}else if(Date.now()>limit){clearInterval(timer);reject(new Error('preset delete timed out'))}},25)})`
  )
  assert.deepEqual(JSON.parse(readFileSync(join(directory, 'presets.json'), 'utf8')), [])
  await checked('应用到队列中全部视频', false)
  await select('导出最长边', '0')
  await select('导出帧率上限', '0')
  console.log(
    'PASS: canvas eyedropper, deferred slider release / numeric commit / key release, presets, debounced native PNG and alphaextract, backgrounds, real single + proportional batch exports'
  )
}
module.exports = { testKeying }
