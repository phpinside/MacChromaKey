import { expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, rename, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OutputAuthorizations, trustedRendererUrl } from './ipcSecurity'
it('requires the exact trusted entry URL, including file path, host and port', () => {
  expect(trustedRendererUrl('file:///app/index.html', 'file:///app/index.html')).toBe(true)
  for (const url of [
    'file:///tmp/evil.html',
    'https://evil.example/',
    'file:///app/index.html?other'
  ])
    expect(trustedRendererUrl(url, 'file:///app/index.html')).toBe(false)
  expect(trustedRendererUrl('http://localhost:5174/', 'http://localhost:5173/')).toBe(false)
})
it('grants one output per chosen source and rejects symlink directory retargeting', async () => {
  const root = await mkdtemp(join(tmpdir(), 'macchromakey-grants-'))
  try {
    const a = join(root, 'a'),
      b = join(root, 'b'),
      alias = join(root, 'chosen')
    await mkdir(a)
    await mkdir(b)
    await symlink(a, alias)
    const grants = new OutputAuthorizations()
    const out = join(alias, 'video.mov')
    await grants.grant('/input.mp4', out)
    await expect(grants.consume('/other.mp4', out)).rejects.toThrow('未经授权')
    expect(await grants.consume('/input.mp4', out)).toBe(join(await realpath(a), 'video.mov'))
    await expect(grants.consume('/input.mp4', out)).rejects.toThrow('未经授权')
    await grants.grant('/input.mp4', out)
    await rename(alias, join(root, 'old'))
    await symlink(b, alias)
    await expect(grants.consume('/input.mp4', out)).rejects.toThrow('目录已变化')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
