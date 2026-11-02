import { open } from 'node:fs/promises'
import { extname } from 'node:path'
import { sameFile, type FileIdentity } from './mediaRegistry'
import { Readable } from 'node:stream'

const mediaTypes: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo'
}

// Chromium seeks with a single byte range. Stream only the requested segment.
export async function serveLocalFile(
  request: Request,
  path: string,
  expected?: FileIdentity,
  origin = 'null'
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } })
  }
  try {
    const file = await open(path, 'r')
    let streaming = false
    try {
      const info = await file.stat()
      if (expected && !sameFile(expected, info))
        return new Response('源视频已变化，请重新导入', { status: 409 })
      if (!info.isFile()) return new Response(null, { status: 404 })
      const size = info.size
      const headers = new Headers({
        'Content-Type': mediaTypes[extname(path).toLowerCase()] ?? 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': origin,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      })
      let start = 0
      let end = size - 1
      let status = 200
      const range = request.method === 'GET' ? request.headers.get('range') : null
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range)
        if (!match || (!match[1] && !match[2]) || size === 0) {
          headers.set('Content-Range', `bytes */${size}`)
          return new Response(null, { status: 416, headers })
        }
        if (match[1]) {
          start = Number(match[1])
          end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
        } else {
          const suffix = Number(match[2])
          start = Math.max(size - suffix, 0)
        }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) {
          headers.set('Content-Range', `bytes */${size}`)
          return new Response(null, { status: 416, headers })
        }
        status = 206
        headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
      }
      headers.set('Content-Length', String(size === 0 ? 0 : end - start + 1))
      if (request.method === 'HEAD' || size === 0) return new Response(null, { status, headers })
      const stream = file.createReadStream({ start, end, autoClose: true })
      const abort = (): void => {
        stream.destroy()
      }
      request.signal.addEventListener('abort', abort, { once: true })
      stream.once('close', () => request.signal.removeEventListener('abort', abort))
      if (request.signal.aborted) stream.destroy()
      const body = Readable.toWeb(stream, {
        strategy: { highWaterMark: 64 * 1024, size: (chunk: Uint8Array) => chunk.byteLength }
      }) as ReadableStream<Uint8Array>
      const response = new Response(body, {
        status,
        headers
      })
      streaming = true
      return response
    } finally {
      if (!streaming) await file.close()
    }
  } catch {
    return new Response('文件已移动、删除或无法读取', { status: 404 })
  }
}
