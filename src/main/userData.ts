import { join, resolve } from 'node:path'

// A rename must retain both the legacy profile and caller-provided isolated profiles.
export function userDataDirectory(
  current: string,
  appData: string,
  appName: string,
  profile: string
): string {
  if (profile) return resolve(profile)
  if (resolve(current) !== resolve(join(appData, appName))) return current
  return join(appData, 'MacChromaKey')
}
