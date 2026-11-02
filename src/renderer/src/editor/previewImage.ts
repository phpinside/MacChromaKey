// The caller owns one URL and releases it on parameter/source/mode change or unmount.
export function previewImage(dataUrl: string): { url: string; release: () => void } {
  const prefix = 'data:image/png;base64,'
  if (!dataUrl.startsWith(prefix) || dataUrl.length > 12 * 1024 * 1024)
    throw new Error('预览图片格式无效')
  const bytes = Uint8Array.from(atob(dataUrl.slice(prefix.length)), (character) =>
    character.charCodeAt(0)
  )
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
  let released = false
  return {
    url,
    release: () => {
      if (!released) {
        released = true
        URL.revokeObjectURL(url)
      }
    }
  }
}
