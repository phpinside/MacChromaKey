import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportDuration, ProcessError, runFFmpeg, runProcess } from './run'

const directories: string[] = []
async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'macchromakey-run-test-'))
  directories.push(directory)
  return directory
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('process runner', () => {
  it('calculates monotonic progress from split out_time_us lines using trimmed duration', async () => {
    const executable = join(await fixture(), 'fake-ffmpeg.cjs')
    await writeFile(
      executable,
      `#!${process.execPath}\n` +
        String.raw`
      if (!process.argv.includes('-progress') || !process.argv.includes('pipe:1') || !process.argv.includes('-nostats')) process.exit(2);
      process.stdout.write('out_time_us=-100\nout_time_us=N/A\nout_time_');
      setTimeout(() => process.stdout.write('us=500000\nout_time_us=250000\nout_time_us=1000000\nprogress=end\n'), 10);
    `,
      { mode: 0o755 }
    )
    const values: number[] = []
    await runFFmpeg(executable, [], {
      duration: 10,
      trim: { start: 2, end: 4 },
      onProgress: (value) => values.push(value)
    })
    expect(values).toEqual([0, 0.25, 0.5, 1])
    expect(() => exportDuration(10, { start: 1, end: 11 })).toThrow()
  })

  it('returns exactly the last 50 stderr lines when a command fails', async () => {
    const error = await runProcess(process.execPath, [
      '-e',
      "for (let i=0;i<60;i++) console.error('line-'+i); process.exit(7)"
    ]).catch((error) => error)
    expect(error).toBeInstanceOf(ProcessError)
    expect(error.exitCode).toBe(7)
    expect(error.stderrLines).toHaveLength(50)
    expect(error.stderrLines[0]).toBe('line-10')
    expect(error.stderrLines.at(-1)).toBe('line-59')
  })

  it('waits for SIGTERM exit before cancellation cleanup', async () => {
    const directory = await fixture()
    const partial = join(directory, 'partial.mov')
    const marker = join(directory, 'signal.txt')
    await writeFile(partial, 'partial')
    const controller = new AbortController()
    const running = runProcess(
      process.execPath,
      [
        '-e',
        `
      const {writeFileSync}=require('node:fs');
      process.on('SIGTERM', () => { writeFileSync(${JSON.stringify(marker)}, 'SIGTERM'); process.exit(0) });
      console.log('ready'); setInterval(() => {}, 1000);
    `
      ],
      {
        signal: controller.signal,
        cleanupOnAbort: [partial],
        onStdoutLine: (line) => {
          if (line === 'ready') controller.abort()
        }
      }
    )
    await expect(running).rejects.toMatchObject({ name: 'AbortError' })
    expect(await readFile(marker, 'utf8')).toBe('SIGTERM')
    await expect(readFile(partial)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not start an already-cancelled command', async () => {
    const marker = join(await fixture(), 'should-not-exist')
    await expect(
      runProcess(
        process.execPath,
        ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`],
        { signal: AbortSignal.abort() }
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

it('bounds stderr memory even when a process never terminates its very long metadata line', async () => {
  const error = await runProcess(process.execPath, [
    '-e',
    "process.stderr.write('x'.repeat(2*1024*1024)+'tail',()=>process.exit(1))"
  ]).catch((error) => error)
  expect(error.stderrLines).toHaveLength(1)
  expect(error.stderrLines[0]).toHaveLength(8192)
  expect(error.stderrLines[0]).toMatch(/tail$/)
})
