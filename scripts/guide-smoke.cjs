const assert = require('node:assert/strict')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

async function testGuide({ contents, window }) {
  const run = (code) => contents.executeJavaScript(code)
  const wait = (condition) =>
    run(`new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{clearInterval(poll);reject(new Error(${JSON.stringify(condition)}))},5000);
      const poll=setInterval(()=>{if(${condition}){clearTimeout(timer);clearInterval(poll);resolve()}},25);
    })`)
  const guide = "document.querySelector('[aria-labelledby=guide-title]')"
  await wait(`${guide}?.open`)
  assert.equal(
    await run("document.querySelector('h1').textContent.trim()"),
    '苹果手机透明视频生成器'
  )
  assert.match(await run(`${guide}.textContent`), /macOS 13/)
  assert.match(await run(`${guide}.textContent`), /MP4、MOV、MKV/)
  assert.match(await run(`${guide}.textContent`), /开始制作/)
  assert.ok(await run(`${guide}.contains(document.activeElement)`), 'focus starts inside modal')
  window.show()
  await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  const screenshot = join(tmpdir(), 'macchromakey-guide.png')
  writeFileSync(screenshot, (await contents.capturePage()).toPNG())
  // Scrollable copy must not hide the action at the minimum supported window size.
  window.setSize(960, 640)
  await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  const bounds = await run(
    `(()=>{const d=${guide}.getBoundingClientRect(), b=${guide}.querySelector('.primary-button').getBoundingClientRect(); return {top:d.top,bottom:d.bottom,buttonBottom:b.bottom,height:innerHeight}})()`
  )
  assert.ok(bounds.top >= 0 && bounds.bottom <= bounds.height)
  assert.ok(bounds.buttonBottom <= bounds.height)
  await run(`${guide}.querySelector('.primary-button').click()`)
  await wait(`!${guide}`)
  assert.equal(await run("localStorage.getItem('macchromakey:guide-seen:v1.0')"), 'seen')
  const loaded = new Promise((resolve) => contents.once('did-finish-load', resolve))
  contents.reload()
  await loaded
  await wait("!!document.querySelector('h1') && !!window.api")
  assert.equal(await run(`!!${guide}`), false, 'acknowledged guide stays closed after reload')
  await run(
    "{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='使用说明');button.focus();button.click();} void 0"
  )
  await wait(`${guide}?.open`)
  assert.match(await run(`${guide}.textContent`), /返回工作台/)
  contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  contents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await wait(`!${guide}`)
  assert.equal(await run('document.activeElement.textContent.trim()'), '使用说明')
  window.setSize(1280, 800)
  console.log(
    `PASS: Chinese branding, first-launch guide, remembered dismissal/reload, permanent help, Escape/focus and small-window layout. Screenshot: ${screenshot}`
  )
}
module.exports = { testGuide }
