// Prepare native icon sizes from the approved PNG; no external packages are needed.
const { execFileSync } = require('node:child_process')
const { mkdtempSync, mkdirSync, copyFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')

if (process.platform !== 'darwin') throw new Error('图标构建需要 macOS 的 sips 和 iconutil')
const project = resolve(__dirname, '..')
const master = join(project, 'build/chroma-icon-master.png')
const temporary = mkdtempSync(join(tmpdir(), 'macchromakey-icons-'))
try {
  const iconset = join(temporary, 'chroma.iconset')
  mkdirSync(iconset)
  const sized = new Map()
  for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
    const file = join(temporary, `${size}.png`)
    execFileSync('/usr/bin/sips', ['-z', String(size), String(size), master, '--out', file], {
      stdio: 'pipe'
    })
    sized.set(size, file)
  }
  for (const size of [16, 32, 128, 256, 512]) {
    copyFileSync(sized.get(size), join(iconset, `icon_${size}x${size}.png`))
    copyFileSync(sized.get(size * 2), join(iconset, `icon_${size}x${size}@2x.png`))
  }
  copyFileSync(sized.get(1024), join(project, 'build/chroma-icon.png'))
  copyFileSync(sized.get(128), join(project, 'src/renderer/src/assets/app-icon.png'))
  execFileSync(
    '/usr/bin/iconutil',
    ['-c', 'icns', iconset, '-o', join(project, 'build/chroma-icon.icns')],
    { stdio: 'pipe' }
  )
  console.log('已生成 1024px PNG、macOS ICNS 和界面用 128px PNG')
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
