import type { UpdaterPrefs } from '@shared/types'

// 更新偏好：UpdateCard 浮层与设置页「版本」区共享同一份持久化数据
const PREFS_KEY = 'awesome-notes-updater-prefs'

export function loadUpdaterPrefs(): UpdaterPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw) return { autoCheck: true, autoDownload: true, ...(JSON.parse(raw) as Partial<UpdaterPrefs>) }
  } catch {
    /* ignore */
  }
  return { autoCheck: true, autoDownload: true }
}

export function saveUpdaterPrefs(p: UpdaterPrefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  window.awesomeNotes?.updaterSetPrefs(p)
}
