// 应用设置：localStorage 持久化（Web 预览模式同样可用），变更即生效
export interface AppSettings {
  /** 主题：浅色 / 深色 */
  theme: 'light' | 'dark'
  /** 阅读区正文字号（px） */
  fontSize: number
  /** 阅读区内容宽度（百分比 70–100，100 为全宽） */
  contentWidth: number
  /** 正文使用衬线字体 */
  serifFont: boolean
  /** 打开文档的默认模式 */
  defaultMode: 'read' | 'source'
  /** 打开文档时默认展开批注面板 */
  annPanelDefaultOpen: boolean
  /** 编辑器自动保存 */
  autoSave: boolean
  /** 文件树/搜索支持的文档格式组（key 见 DOC_FORMAT_GROUPS） */
  docFormats: string[]
  /** 自动保存延迟（ms） */
  autoSaveDelayMs: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  fontSize: 15,
  contentWidth: 80,
  serifFont: true,
  defaultMode: 'read',
  annPanelDefaultOpen: true,
  autoSave: false,
  autoSaveDelayMs: 2000,
  docFormats: ['md', 'html', 'txt']
}

const SETTINGS_KEY = 'awesome-notes-settings'

/** v0.2.0 及之前 contentWidth 为像素值（760/820/960/9999），迁移到百分比档位 */
function normalizeWidth(w: unknown): number {
  if (w === 70 || w === 80 || w === 90 || w === 100) return w
  if (w === 9999) return 100
  if (w === 760) return 70
  if (w === 820) return 80
  if (w === 960) return 90
  return DEFAULT_SETTINGS.contentWidth
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Omit<AppSettings, 'defaultMode'>> & { defaultMode?: string }
      return {
        ...DEFAULT_SETTINGS,
        ...saved,
        contentWidth: normalizeWidth(saved.contentWidth),
        defaultMode: saved.defaultMode === 'source' || saved.defaultMode === 'edit' ? 'source' : 'read'
      }
    }
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
    s.contentWidth >= 100 ? 'none' : `${s.contentWidth}%`
  )
  root.style.setProperty(
    '--reader-font-family',
    s.serifFont
      ? '"Source Han Serif SC", "Noto Serif CJK SC", Georgia, "Times New Roman", serif'
      : '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, -apple-system, sans-serif'
  )
}
