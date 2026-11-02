import { protocol } from 'electron'
import { serveLocalFile } from './localFileResponse'
import { MediaRegistry } from './mediaRegistry'

export const mediaRegistry = new MediaRegistry()
export const authorizeVideo = (path: string): ReturnType<MediaRegistry['authorize']> =>
  mediaRegistry.authorize(path)
export const authorizedVideoPath = (url: string): string | undefined => mediaRegistry.get(url)?.path

// Must run before app.ready. Keep CSP enforcement enabled.
export function registerLocalFileScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'localfile',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    }
  ])
}
export function registerLocalFileHandler(rendererUrl: string): void {
  const origin = new URL(rendererUrl).origin
  protocol.handle('localfile', (request) => {
    const requestedOrigin = request.headers.get('origin')
    if (requestedOrigin && requestedOrigin !== origin)
      return new Response('不允许的来源', { status: 403 })
    const entry = mediaRegistry.get(request.url)
    if (!entry) return new Response('未授权的本地文件', { status: 404 })
    return serveLocalFile(request, entry.path, entry.identity, origin)
  })
}
