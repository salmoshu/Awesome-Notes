// 应用设置：localStorage 持久化（Web 预览模式同样可用），变更即生效
export interface AppSettings {
  /** 主题：浅色 / 深色 */
  theme: 'light' | 'dark'
  /** 阅读区正文字号（px） */
  fontSize: number
  /** 阅读区纸张最大宽度（px） */
  contentWidth: number
  /** 正文使用衬线字体 */
  serifFont: boolean
  /** 打开文档的默认模式 */
  defaultMode: 'read' | 'edit'
  /** 打开文档时默认展开批注面板 */
  annPanelDefaultOpen: boolean
  /** 编辑器自动保存 */
  autoSave: boolean
  /** 自动保存延迟（ms） */
  autoSaveDelayMs: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  fontSize: 15,
  contentWidth: 820,
  serifFont: false,
  defaultMode: 'read',
  annPanelDefaultOpen: true,
  autoSave: false,
  autoSaveDelayMs: 2000
}

const SETTINGS_KEY = 'awesome-notes-settings'

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) }
  } catch {
    /* 损坏数据回退默认 */
  }
  return { ...DEFAULT_SETTINGS }
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
}

/** 把外观类设置应用到 DOM（主题、字号、宽度、字体经 CSS 变量生效） */
export function applyAppearance(s: AppSettings): void {
  const root = document.documentElement
  root.dataset.theme = s.theme
  root.style.setProperty('--reader-font-size', `${s.fontSize}px`)
  root.style.setProperty(
    '--reader-width',
    s.contentWidth >= 9999 ? 'none' : `${s.contentWidth}px`
  )
  root.style.setProperty(
    '--reader-font-family',
    s.serifFont
      ? '"Source Han Serif SC", "Noto Serif CJK SC", Georgia, "Times New Roman", serif'
      : '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, -apple-system, sans-serif'
  )
}
