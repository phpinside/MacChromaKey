import { createHash } from 'node:crypto'
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  FFmpegInstaller,
  FFMPEG_PROVIDER,
  installFFmpeg,
  latestRelease,
  releaseFromUrl
} from './install'
import { managedBinDirectory, toolCandidates } from './toolPaths'
import { runProcess } from './run'
import type { FFmpegInstallState, ToolReport } from '../../shared/types'

let root: string
let archives: Record<string, Buffer>
const version = '9.0.2'
const release = `${FFMPEG_PROVIDER}/download/macos/arm64/1789931890_${version}/`
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'macchromakey-install-test-'))
  archives = {}
  for (const name of ['ffmpeg', 'ffprobe']) {
    await writeFile(join(root, name), `fixture ${name}`)
    await runProcess('/usr/bin/zip', ['-jq', join(root, `${name}.zip`), join(root, name)])
    archives[name] = await readFile(join(root, `${name}.zip`))
  }
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})
const signal = (): AbortSignal => new AbortController().signal
function fixtureFetch(): Mock<(url: string, options?: RequestInit) => Promise<Response>> {
  return vi.fn(async (url: string, options?: RequestInit) => {
    expect(options?.redirect).toBe('manual')
    if (url.includes('/redirect/latest/'))
      return new Response(null, { status: 307, headers: { location: `${release}ffmpeg.zip` } })
    const name = url.includes('/ffprobe.') ? 'ffprobe' : 'ffmpeg'
    if (url.endsWith('.sha256'))
      return new Response(
        `${createHash('sha256').update(archives[name]).digest('hex')}  ${name}.zip`
      )
    return new Response(new Uint8Array(archives[name]), {
      headers: { 'content-length': String(archives[name].length) }
    })
  })
}
const validate = async (path: string): Promise<void> => {
  await chmod(path, 0o700)
}

describe('private FFmpeg installation', () => {
  it('resolves latest release dynamically for the selected architecture and rejects unsafe redirects', async () => {
    const fetcher = fixtureFetch()
    expect(await latestRelease('arm64', signal(), fetcher)).toEqual({ directory: release, version })
    expect(fetcher.mock.calls[0][0]).toBe(
      `${FFMPEG_PROVIDER}/redirect/latest/macos/arm64/release/ffmpeg.zip`
    )
    expect(releaseFromUrl(`${release.replace('arm64', 'amd64')}ffmpeg.zip`, 'x64').version).toBe(
      version
    )
    for (const url of [
      `https://evil.example/ffmpeg.zip`,
      `${release}ffmpeg.zip?override=1`,
      `${release}ffmpeg.zip#x`,
      release.replace('arm64', 'amd64') + 'ffmpeg.zip'
    ])
      expect(() => releaseFromUrl(url, 'arm64')).toThrow()
    await expect(latestRelease('ia32', signal(), fetcher)).rejects.toThrow('仅支持')
    await expect(
      latestRelease('arm64', signal(), async () => new Response(null, { status: 503 }))
    ).rejects.toThrow('HTTP 503')
  })

  it('activates both tools together only after verification and makes discovery prefer the installed pair', async () => {
    const states: FFmpegInstallState[] = []
    const check = vi.fn(async (path: string) => {
      expect(await managedBinDirectory(join(root, 'tools'), 'arm64')).toBeUndefined()
      await validate(path)
    })
    expect(
      await installFFmpeg(
        join(root, 'tools'),
        'arm64',
        (s) => states.push(s),
        signal(),
        fixtureFetch(),
        check
      )
    ).toBe(version)
    const bin = (await managedBinDirectory(join(root, 'tools'), 'arm64'))!
    expect(await readFile(join(bin, 'ffmpeg'), 'utf8')).toBe('fixture ffmpeg')
    expect(await readFile(join(bin, 'ffprobe'), 'utf8')).toBe('fixture ffprobe')
    expect(check).toHaveBeenCalledTimes(2)
    expect(toolCandidates('ffmpeg', '/resources', 'arm64', bin)[2]).toBe(join(bin, 'ffmpeg'))
    expect((await readdir(join(root, 'tools', 'arm64'))).sort()).toEqual(
      [bin.split('/').at(-1), 'current.json'].sort()
    )
    expect(states.map((s) => s.stage)).toContain('verifying')
  })

  it('rejects tampered downloads without changing a previously installed pair', async () => {
    const tools = join(root, 'tools')
    await installFFmpeg(tools, 'arm64', () => {}, signal(), fixtureFetch(), validate)
    const previous = await readFile(join(tools, 'arm64', 'current.json'), 'utf8')
    const fetcher = fixtureFetch()
    const corrupt = async (url: string, options?: RequestInit): Promise<Response> =>
      url.endsWith('ffprobe.zip') ? new Response('tampered') : fetcher(url, options)
    await expect(
      installFFmpeg(tools, 'arm64', () => {}, signal(), corrupt, validate)
    ).rejects.toThrow('SHA-256')
    expect(await readFile(join(tools, 'arm64', 'current.json'), 'utf8')).toBe(previous)
    expect((await readdir(join(tools, 'arm64'))).length).toBe(2)
  })

  it('cleans partially downloaded files on cancellation and never activates a rejected signature', async () => {
    const tools = join(root, 'tools')
    const controller = new AbortController()
    await expect(
      installFFmpeg(
        tools,
        'arm64',
        (s) => {
          if (s.stage === 'downloading') controller.abort()
        },
        controller.signal,
        fixtureFetch(),
        validate
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(await readdir(join(tools, 'arm64'))).toEqual([])
    await expect(
      installFFmpeg(
        tools,
        'arm64',
        () => {},
        signal(),
        fixtureFetch(),
        async () => {
          throw new Error('发行者签名不匹配')
        }
      )
    ).rejects.toThrow('签名')
    expect(await readdir(join(tools, 'arm64'))).toEqual([])
  })

  it('rejects manifest path traversal and oversized metadata', async () => {
    await installFFmpeg(join(root, 'tools'), 'arm64', () => {}, signal(), fixtureFetch(), validate)
    for (const directory of ['../../escape', '9.0.2-' + 'x'.repeat(36), '/tmp/binary']) {
      await writeFile(join(root, 'tools/arm64/current.json'), JSON.stringify({ directory }))
      expect(await managedBinDirectory(join(root, 'tools'), 'arm64')).toBeUndefined()
    }
    await expect(
      installFFmpeg(
        join(root, 'big'),
        'arm64',
        () => {},
        signal(),
        async (url, options) =>
          url.endsWith('.sha256') ? new Response('x'.repeat(4097)) : fixtureFetch()(url, options),
        validate
      )
    ).rejects.toThrow('大小限制')
  })
})

it('coalesces concurrent installation, cancels, retries and does not repeat automatic attempts', async () => {
  const report = (missing: boolean): ToolReport => ({
    checkedAt: '',
    tools: Object.fromEntries(
      ['ffmpeg', 'ffprobe', 'avconvert'].map((name) => [
        name,
        { name, path: null, version: null, available: !missing }
      ])
    ) as ToolReport['tools']
  })
  const runner = vi.fn(
    (_progress, abort: AbortSignal) =>
      new Promise<string>((_resolve, reject) =>
        abort.addEventListener('abort', () => reject(new Error('canceled')), { once: true })
      )
  )
  const installer = new FFmpegInstaller(runner)
  installer.ensureMissing(report(false))
  expect(runner).not.toHaveBeenCalled()
  installer.ensureMissing(report(true))
  const pending = installer.start()
  expect(installer.start()).toBe(pending)
  await Promise.resolve()
  await installer.cancel()
  expect((await pending).stage).toBe('canceled')
  installer.ensureMissing(report(true))
  expect(runner).toHaveBeenCalledTimes(1)
  runner.mockImplementationOnce(async () => '9.0.2')
  expect((await installer.start()).stage).toBe('done')
  await installer.shutdown()
})

it('handles synchronous runner failures and throttles notifications to the latest state', async () => {
  const installer = new FFmpegInstaller(() => {
    throw new Error('offline')
  })
  const changed = vi.fn()
  installer.subscribe(changed)
  expect((await installer.start()).stage).toBe('failed')
  expect((await installer.start()).stage).toBe('failed')
  expect(changed).not.toHaveBeenCalled()
  await new Promise((resolve) => setTimeout(resolve, 220))
  expect(changed).toHaveBeenCalledTimes(1)
  expect(changed.mock.calls[0][0].message).toContain('offline')
  await installer.shutdown()
})
