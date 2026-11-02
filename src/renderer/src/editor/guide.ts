const GUIDE_SEEN_KEY = 'macchromakey:guide-seen:v1.0'

export function needsFirstRunGuide(): boolean {
  try {
    return localStorage.getItem(GUIDE_SEEN_KEY) !== 'seen'
  } catch {
    return true
  }
}

export function rememberGuide(): void {
  try {
    localStorage.setItem(GUIDE_SEEN_KEY, 'seen')
  } catch {
    // The guide remains readable and dismissible if local storage is unavailable.
  }
}
