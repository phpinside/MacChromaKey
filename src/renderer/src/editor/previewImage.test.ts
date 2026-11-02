import { afterEach, expect, it, vi } from 'vitest'
import { previewImage } from './previewImage'
afterEach(() => vi.restoreAllMocks())
it('releases the owned Blob once and never keeps the PNG base64 string as its URL', () => {
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const owned = previewImage('data:image/png;base64,iVBORw0KGgo=')
  expect(owned.url).toBe('blob:test')
  expect(create).toHaveBeenCalledWith(expect.any(Blob))
  owned.release()
  owned.release()
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:test')
  expect(() => previewImage('https://evil.example/image')).toThrow('格式无效')
})
