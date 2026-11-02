import { expect, it } from 'vitest'
import { userDataDirectory } from './userData'

it('keeps the legacy data directory after a product rename', () => {
  expect(
    userDataDirectory('/data/苹果手机透明视频生成器', '/data', '苹果手机透明视频生成器', '')
  ).toBe('/data/MacChromaKey')
  expect(userDataDirectory('/data/MacChromaKey', '/data', 'MacChromaKey', '')).toBe(
    '/data/MacChromaKey'
  )
})
it('retains app.setPath profiles and honors an explicit command-line profile', () => {
  expect(userDataDirectory('/tmp/test-profile', '/data', 'macchromakey', '')).toBe(
    '/tmp/test-profile'
  )
  expect(userDataDirectory('/tmp/test-profile', '/data', 'macchromakey', '/tmp/cli-profile')).toBe(
    '/tmp/cli-profile'
  )
})
