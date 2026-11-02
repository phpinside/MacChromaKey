const assert = require('node:assert/strict')
const { readFileSync, readdirSync, writeFileSync, copyFileSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

async function testTasks({
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
}) {
  const run = (code) => contents.executeJavaScript(code)
  const settle = () => run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  const wait = (condition, timeout = 12000) =>
    run(`new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{clearInterval(poll);reject(new Error(${JSON.stringify(condition)}))},${timeout});
    const poll=setInterval(()=>{if(${condition}){clearTimeout(timer);clearInterval(poll);resolve()}},25);
  })`)
  const click = async (selector, text) => {
    await run(
      `{const root=document.querySelector(${JSON.stringify(selector)}); const button=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!button)throw new Error('button missing '+${JSON.stringify(text)});button.click()} void 0`
    )
    await settle()
  }
  const field = async (label, value) => {
    await run(
      `{const input=document.querySelector('[aria-label=${JSON.stringify(label)}]');input.focus();input.select()} void 0`
    )
    await contents.insertText(String(value))
    await settle()
  }
  const addJob = async (request, url = media.url) => {
    controls.nextOutputPath = request.outputPath
    await run(`window.api.chooseExportPaths([${JSON.stringify(url)}])`)
    return run(`window.api.jobs.add(${JSON.stringify(request)})`)
  }
  const job = async (id) => (await run('window.api.jobs.list()')).jobs.find((j) => j.id === id)
  const waitJob = async (id, status) => {
    await run(`new Promise((resolve,reject)=>{const deadline=Date.now()+20000;const poll=setInterval(async()=>{
      const {jobs}=await window.api.jobs.list();const job=jobs.find(j=>j.id===${JSON.stringify(id)});
      if(job?.status===${JSON.stringify(status)}){clearInterval(poll);resolve()}
      else if(Date.now()>deadline){clearInterval(poll);reject(new Error(JSON.stringify(job)))}
    },30)})`)
    await wait(`!!document.querySelector('[data-job-id="${id}"]')`)
  }
  assert.ok(
    await run("document.querySelector('.media-item img')?.naturalWidth>0"),
    'import extracts thumbnail'
  )
  await run('document.querySelector(\'[aria-label="打开设置"]\').click()')
  await wait("document.querySelector('dialog')?.open")
  await field('任务并发数', 2)
  await click('dialog', '选择输出目录')
  await click('dialog', '选择临时目录')
  writeFileSync(join(tmpdir(), 'macchromakey-settings.png'), (await contents.capturePage()).toPNG())
  await click('dialog', '保存设置')
  await wait("!document.querySelector('dialog')")
  const settings = await run('window.api.settings.get()')
  assert.equal(settings.concurrency, 2)
  assert.equal(settings.outputDirectory, join(directory, 'exports'))
  assert.equal(settings.tempDirectory, join(directory, 'scratch'))
  assert.deepEqual(JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8')), settings)
  assert.equal((await run('window.api.jobs.list()')).concurrency, 2)
  await run('window.api.jobs.setConcurrency(1)')

  controls.crash = true
  const failed = await addJob({
    inputPath: media.path,
    outputPath: join(directory, 'crash.mov'),
    params: { ...params, similarity: 0.55, crop: { x: 0, y: 0, w: 160, h: 90 } }
  })
  await waitJob(failed.id, 'failed')
  const failure = await job(failed.id)
  assert.match(failure.error, /SIGKILL/)
  assert.ok(failure.stderrTail.length)
  assert.ok(failure.thumbnail.startsWith('data:image/jpeg;base64,'))
  const card = `[data-job-id="${failed.id}"]`
  await wait(`document.querySelector('${card} .job-log') !== null`)
  await run(`document.querySelector('${card} summary').click()`)
  assert.equal(await run(`document.querySelector('${card} details').open`), true)
  await click(card, '复制日志')
  assert.match(clipboardWrites.at(-1), /SIGKILL/)

  controls.slow = true
  await click(card, '重试')
  await waitJob(failed.id, 'running')
  await wait(
    `document.querySelector('[data-testid="queue-status"]').textContent.includes('运行中 1')`
  )
  app.quit() // First confirmation chooses Continue; the real queue must keep running.
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(quitDialogs.length, 1)
  assert.match(quitDialogs[0].message, /1 个运行中任务/)
  assert.equal(contents.isDestroyed(), false)
  assert.equal((await job(failed.id)).status, 'running')
  await click(card, '取消')
  await waitJob(failed.id, 'canceled')
  assert.ok(
    encodePaths.some((path) => path.startsWith(join(directory, 'scratch'))),
    'pipeline honors configured scratch directory'
  )
  assert.deepEqual(readdirSync(join(directory, 'scratch')), [], 'cancellation cleans scratch')

  controls.slow = false
  await click(card, '重新编辑')
  await wait(
    "document.querySelector('[aria-label=\"导出设置\"]').textContent.includes('已恢复任务参数')"
  )
  assert.equal(
    await run('Number(document.querySelector(\'[aria-label="相似度数值"]\').value)'),
    0.55
  )
  assert.equal(await run('Number(document.querySelector(\'[aria-label="裁剪 w"]\').value)'), 160)
  await field('相似度数值', 0.56)
  await field('裁剪 w', 120)
  await click('[aria-label="导出设置"]', '开始导出')
  await wait(
    "document.querySelector('[aria-label=\"导出设置\"]').textContent.includes('已加入 1 个导出任务')"
  )
  const changed = (await run('window.api.jobs.list()')).jobs.find((j) => j.id !== failed.id)
  assert.equal(changed.params.similarity, 0.56)
  assert.equal(changed.params.crop.w, 120)
  assert.equal((await job(failed.id)).params.similarity, 0.55)
  assert.equal(saveDialogs.at(-1).defaultPath.startsWith(join(directory, 'exports')), true)
  await waitJob(changed.id, 'done')
  await wait(
    `document.querySelector('[data-job-id="${changed.id}"]').textContent.includes('在 Finder 中显示')`
  )
  await click(`[data-job-id="${changed.id}"]`, '在 Finder 中显示')
  assert.equal(revealedFiles.at(-1), changed.outputPath)
  await click(card, '删除')
  await wait(`!document.querySelector('${card}')`)

  // Runtime disk-full classification without filling the developer's actual disk.
  controls.noSpace = true
  const full = await addJob({
    inputPath: media.path,
    outputPath: join(directory, 'disk-full.mov'),
    params
  })
  await waitJob(full.id, 'failed')
  assert.match((await job(full.id)).error, /磁盘空间不足/)
  assert.ok(
    (await job(full.id)).stderrTail.some((line) => line.includes('No space left on device'))
  )

  controls.slow = true
  const blocker = await addJob({
    inputPath: media.path,
    outputPath: join(directory, 'blocker.mov'),
    params
  })
  await waitJob(blocker.id, 'running')
  const movingPath = join(directory, 'moving.mp4')
  copyFileSync(media.path, movingPath)
  controls.selectedPath = movingPath
  const movingMedia = await run('window.api.openVideo()')
  delete controls.selectedPath
  const missing = await addJob(
    { inputPath: movingMedia.path, outputPath: join(directory, 'missing.mov'), params },
    movingMedia.url
  )
  assert.equal((await job(missing.id)).status, 'queued')
  rmSync(movingPath)
  await run(`window.api.jobs.cancel(${JSON.stringify(blocker.id)})`)
  controls.slow = false
  await waitJob(missing.id, 'failed')
  assert.match((await job(missing.id)).error, /输入文件已移动或删除/)
  await wait(`document.querySelector('[data-job-id="${missing.id}"] .job-log') !== null`)
  await click(`[data-job-id="${missing.id}"]`, '重新编辑')
  await wait(
    "document.querySelector('[aria-label=\"导出设置\"]').textContent.includes('已恢复任务参数')"
  )
  assert.ok(await run("document.querySelector('video').src.startsWith('localfile://')"))
  writeFileSync(join(tmpdir(), 'macchromakey-tasks.png'), (await contents.capturePage()).toPNG())
  await run('window.api.jobs.clearFinished()')
  assert.equal((await run('window.api.jobs.list()')).jobs.length, 0)
  console.log(
    'PASS: task thumbnails/stages/progress/time, persisted settings/directories, real SIGKILL + logs/copy, retry/cancel/Finder/delete, re-edit/new snapshot, disk-full and moved-file recovery, cancel quit'
  )
}
module.exports = { testTasks }
