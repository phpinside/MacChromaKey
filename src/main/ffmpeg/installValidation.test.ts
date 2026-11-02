import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { runProcess } from './run'
import { validateInstalledBinary } from './install'
vi.mock('./run', async (original) => ({
  ...(await original<typeof import('./run')>()),
  runProcess: vi.fn()
}))
const run = vi.mocked(runProcess)
let root: string
let binary: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'macchromakey-signature-test-'))
  binary = join(root, 'ffmpeg')
  await writeFile(binary, 'not executable; all execution is mocked')
  await chmod(binary, 0o600)
  run.mockReset()
  run.mockImplementation(async (command, args) => ({
    stdout: Buffer.from(
      command.endsWith('lipo')
        ? 'arm64'
        : args.includes('-version')
          ? 'ffmpeg version 9.0.2\n'
          : args.includes('-filters')
            ? ' chromakey lutyuv despill alphaextract scale fps '
            : ' prores_ks pcm_s16le png mjpeg '
    ),
    stderrLines:
      command.endsWith('codesign') && args.includes('-d')
        ? [
            'Authority=Developer ID Application: Martin Riedl (KU3N25YGLU)',
            'TeamIdentifier=KU3N25YGLU'
          ]
        : []
  }))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})
it('validates the Apple trust chain and pinned publisher before executing downloaded code', async () => {
  await validateInstalledBinary(binary, 'ffmpeg', 'arm64', '9.0.2', new AbortController().signal)
  const commands = run.mock.calls.map(([cmd, args]) =>
    cmd === binary ? args[0] : cmd.split('/').at(-1)
  )
  expect(commands).toEqual([
    'lipo',
    'codesign',
    'codesign',
    '-version',
    '-hide_banner',
    '-hide_banner'
  ])
  expect(run.mock.calls[1][1]).toContain('anchor apple generic')
})
it('rejects a foreign publisher without running its executable', async () => {
  run
    .mockImplementationOnce(async () => ({ stdout: Buffer.from('arm64'), stderrLines: [] }))
    .mockImplementationOnce(async () => ({ stdout: Buffer.alloc(0), stderrLines: [] }))
    .mockImplementationOnce(async () => ({
      stdout: Buffer.alloc(0),
      stderrLines: [
        'Authority=Developer ID Application: Other (OTHERTEAM0)',
        'TeamIdentifier=OTHERTEAM0'
      ]
    }))
  await expect(
    validateInstalledBinary(binary, 'ffmpeg', 'arm64', '9.0.2', new AbortController().signal)
  ).rejects.toThrow('发行者签名')
  expect(run.mock.calls.some(([command]) => command === binary)).toBe(false)
})
it('rejects incompatible architecture before signature checks or execution', async () => {
  await expect(
    validateInstalledBinary(binary, 'ffmpeg', 'x64', '9.0.2', new AbortController().signal)
  ).rejects.toThrow('架构不匹配')
  expect(run).toHaveBeenCalledTimes(1)
})
it('rejects a version mismatch and missing pipeline features', async () => {
  await expect(
    validateInstalledBinary(binary, 'ffmpeg', 'arm64', '9.0.3', new AbortController().signal)
  ).rejects.toThrow('版本')
  const real = run.getMockImplementation()!
  run.mockImplementation(async (cmd, args, options) =>
    args.includes('-encoders')
      ? { stdout: Buffer.from(' png mjpeg '), stderrLines: [] }
      : real(cmd, args, options)
  )
  await expect(
    validateInstalledBinary(binary, 'ffmpeg', 'arm64', '9.0.2', new AbortController().signal)
  ).rejects.toThrow('prores_ks')
})
