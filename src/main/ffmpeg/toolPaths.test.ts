import { expect, it } from 'vitest'
import { toolCandidates } from './toolPaths'
it('prefers optional architecture/common resource binaries then system paths, keeping avconvert system-only', () => {
  expect(toolCandidates('ffmpeg', '/App/Resources', 'arm64')).toEqual([
    '/App/Resources/bin/arm64/ffmpeg',
    '/App/Resources/bin/ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg'
  ])
  expect(toolCandidates('ffprobe', '/App/Resources', 'x64')[0]).toBe(
    '/App/Resources/bin/x64/ffprobe'
  )
  expect(toolCandidates('avconvert', '/App/Resources', 'arm64')).toEqual(['/usr/bin/avconvert'])
})
