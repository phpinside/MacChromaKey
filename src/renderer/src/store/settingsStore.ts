import { create } from 'zustand'
import type { AppSettings } from '../../../shared/types'
interface SettingsState {
  settings: AppSettings | null
  error: string | null
  refresh: () => Promise<void>
}
export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  error: null,
  refresh: async () => {
    try {
      set({ settings: await window.api.settings.get(), error: null })
    } catch (error) {
      set({ error: String(error) })
    }
  }
}))
