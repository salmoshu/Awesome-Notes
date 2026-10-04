import { create } from 'zustand'
import { api } from './api'
import type { Annotation, DocContent, DocNode, Project, UpdateStatusType } from '@shared/types'
import { applyAppearance, loadSettings, saveSettings, type AppSettings } from './utils/settings'

export type ViewMode = 'read' | 'edit'

export interface Toast {
  id: number
  kind: 'ok' | 'err' | 'info'
  text: string
}

interface State {
  ready: boolean
  fatalError: string | null
  projects: Project[]
  activeProjectId: string | null
  tree: DocNode | null
  treeLoading: boolean
  filter: string
  activeDoc: DocContent | null
  docLoading: boolean
  mode: ViewMode
  draft: string
  dirty: boolean
  saving: boolean
  annotations: Annotation[]
  annPanelOpen: boolean
  composeQuote: { quote: string; prefix: string; suffix: string } | null
  toasts: Toast[]
  updateChecking: boolean
  updateManualPending: boolean
  settings: AppSettings
  settingsOpen: boolean

  setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void
  openSettings(): void
  closeSettings(): void
  checkUpdate(): Promise<void>
  updateSettled(type: UpdateStatusType): void
  setUpdateChecking(b: boolean): void

  init(): Promise<void>
  toast(kind: Toast['kind'], text: string): void
  importProject(path: string): Promise<void>
  removeProject(id: string): Promise<void>
  selectProject(id: string): Promise<void>
  rescan(): Promise<void>
  openDoc(path: string): Promise<void>
  setFilter(f: string): void
  setMode(m: ViewMode): void
  setDraft(d: string): void
  saveDoc(): Promise<void>
  loadAnnotations(): Promise<void>
  toggleAnnPanel(): void
  setComposeQuote(q: State['composeQuote']): void
  createAnnotation(text: string): Promise<void>
  setAnnStatus(a: Annotation, status: 'open' | 'done'): Promise<void>
  deleteAnnotation(a: Annotation): Promise<void>
}

let toastSeq = 1
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null

export const useStore = create<State>((set, get) => ({
  ready: false,
  fatalError: null,
  projects: [],
  activeProjectId: null,
  tree: null,
  treeLoading: false,
  filter: '',
  activeDoc: null,
  docLoading: false,
  mode: 'read',
  draft: '',
  dirty: false,
  saving: false,
  annotations: [],
  annPanelOpen: true,
  composeQuote: null,
  toasts: [],
  updateChecking: false,
  updateManualPending: false,
  settings: loadSettings(),
  settingsOpen: false,

  setSetting(key, value) {
    const next = { ...get().settings, [key]: value }
    saveSettings(next)
    set({ settings: next })
    applyAppearance(next)
  },

  openSettings() {
    set({ settingsOpen: true })
  },

  closeSettings() {
    set({ settingsOpen: false })
  },

  async checkUpdate() {
    const bridge = window.awesomeNotes
    if (!bridge) {
      get().toast('info', '纯 Web 预览模式不支持检查更新')
      return
    }
    set({ updateChecking: true, updateManualPending: true })
    try {
      await bridge.updaterCheck()
      // 主进程在 dev 下抛错；打包环境下结果经事件通道推送（updateSettled 收口）
      setTimeout(() => {
        if (get().updateChecking) {
          set({ updateChecking: false, updateManualPending: false })
        }
      }, 15_000)
    } catch (err) {
      set({ updateChecking: false, updateManualPending: false })
      // IPC 错误形如 "Error invoking remote method 'update-check': Error: <msg>"，只保留正文
      const raw = String(err instanceof Error ? err.message : err)
      const msg = raw.includes('Error:') ? raw.split('Error:').pop()!.trim() : raw
      get().toast('info', msg)
    }
  },

  updateSettled(type) {
    set({ updateChecking: false })
    if (get().updateManualPending) {
      set({ updateManualPending: false })
      if (type === 'update-not-available') get().toast('ok', '当前已是最新版本')
    }
  },

  setUpdateChecking(b) {
    set({ updateChecking: b })
  },

  async init() {
    const settings = get().settings
    applyAppearance(settings)
    set({ annPanelOpen: settings.annPanelDefaultOpen })
    try {
      const r = await api<{ projects: Project[] }>('GET', '/api/projects')
      set({ projects: r.projects ?? [], ready: true })
      const first = r.projects?.[0]
      if (first) await get().selectProject(first.id)
    } catch (err) {
      set({ fatalError: String(err), ready: true })
    }
  },

  toast(kind, text) {
    const id = toastSeq++
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 3200)
  },

  async importProject(path) {
    try {
      const p = await api<Project>('POST', '/api/projects', { path })
      const r = await api<{ projects: Project[] }>('GET', '/api/projects')
      set({ projects: r.projects ?? [] })
      await get().selectProject(p.id)
      get().toast('ok', `已导入 ${p.name}（${p.docCount} 篇文档）`)
    } catch (err) {
      get().toast('err', `导入失败：${err}`)
    }
  },

  async removeProject(id) {
    try {
      await api('DELETE', `/api/projects/${id}`)
      const r = await api<{ projects: Project[] }>('GET', '/api/projects')
      set({ projects: r.projects ?? [] })
      if (get().activeProjectId === id) {
        set({ activeProjectId: null, tree: null, activeDoc: null, annotations: [] })
        const first = r.projects?.[0]
        if (first) await get().selectProject(first.id)
      }
    } catch (err) {
      get().toast('err', `移除失败：${err}`)
    }
  },

  async selectProject(id) {
    set({ activeProjectId: id, tree: null, treeLoading: true, activeDoc: null, annotations: [], composeQuote: null })
    try {
      const tree = await api<DocNode>('GET', `/api/projects/${id}/tree`)
      set({ tree, treeLoading: false })
    } catch (err) {
      set({ treeLoading: false })
      get().toast('err', `文档树加载失败：${err}`)
    }
  },

  async rescan() {
    const id = get().activeProjectId
    if (!id) return
    set({ treeLoading: true })
    try {
      await api('POST', `/api/projects/${id}/rescan`)
      const tree = await api<DocNode>('GET', `/api/projects/${id}/tree`)
      set({ tree, treeLoading: false })
      get().toast('ok', '已重新扫描')
    } catch (err) {
      set({ treeLoading: false })
      get().toast('err', `重新扫描失败：${err}`)
    }
  },

  async openDoc(path) {
    const id = get().activeProjectId
    if (!id) return
    if (get().dirty && !window.confirm('当前编辑未保存，切换文档将丢弃修改。继续？')) return
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer)
      autoSaveTimer = null
    }
    const { settings } = get()
    set({
      docLoading: true,
      activeDoc: null,
      composeQuote: null,
      mode: settings.defaultMode,
      annPanelOpen: settings.annPanelDefaultOpen
    })
    try {
      const doc = await api<DocContent>('GET', `/api/projects/${id}/doc?path=${encodeURIComponent(path)}`)
      set({ activeDoc: doc, draft: doc.content, dirty: false, docLoading: false })
      await get().loadAnnotations()
    } catch (err) {
      set({ docLoading: false })
      get().toast('err', `文档读取失败：${err}`)
    }
  },

  setFilter(f) {
    set({ filter: f })
  },

  setMode(m) {
    const s = get()
    if (m === 'edit' && s.activeDoc) set({ mode: m, draft: s.activeDoc.content, dirty: false })
    else set({ mode: m })
  },

  setDraft(d) {
    set({ draft: d, dirty: d !== get().activeDoc?.content })
    // 自动保存：每次变更重置计时器，静止 delay 后落盘
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer)
      autoSaveTimer = null
    }
    const { settings } = get()
    if (settings.autoSave && get().dirty) {
      autoSaveTimer = setTimeout(() => {
        autoSaveTimer = null
        void get().saveDoc()
      }, settings.autoSaveDelayMs)
    }
  },

  async saveDoc() {
    const s = get()
    if (!s.activeDoc || !s.activeProjectId || !s.dirty) return
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer)
      autoSaveTimer = null
    }
    set({ saving: true })
    try {
      await api('PUT', `/api/projects/${s.activeProjectId}/doc`, {
        path: s.activeDoc.path,
        content: s.draft
      })
      set({
        activeDoc: { ...s.activeDoc, content: s.draft },
        dirty: false,
        saving: false
      })
      get().toast('ok', '已保存')
    } catch (err) {
      set({ saving: false })
      get().toast('err', `保存失败：${err}`)
    }
  },

  async loadAnnotations() {
    const s = get()
    if (!s.activeProjectId || !s.activeDoc) return
    try {
      const r = await api<{ annotations: Annotation[] }>(
        'GET',
        `/api/projects/${s.activeProjectId}/annotations?doc=${encodeURIComponent(s.activeDoc.path)}`
      )
      set({ annotations: r.annotations ?? [] })
    } catch {
      set({ annotations: [] })
    }
  },

  toggleAnnPanel() {
    set((s) => ({ annPanelOpen: !s.annPanelOpen }))
  },

  setComposeQuote(q) {
    set({ composeQuote: q, annPanelOpen: q ? true : get().annPanelOpen })
  },

  async createAnnotation(text) {
    const s = get()
    const q = s.composeQuote
    if (!s.activeProjectId || !s.activeDoc || !q) return
    try {
      await api('POST', `/api/projects/${s.activeProjectId}/annotations`, {
        doc: s.activeDoc.path,
        quote: q.quote,
        prefix: q.prefix,
        suffix: q.suffix,
        text,
        status: 'open'
      })
      set({ composeQuote: null })
      await get().loadAnnotations()
      get().toast('ok', '批注已保存')
    } catch (err) {
      get().toast('err', `批注保存失败：${err}`)
    }
  },

  async setAnnStatus(a, status) {
    const s = get()
    if (!s.activeProjectId) return
    await api('PATCH', `/api/projects/${s.activeProjectId}/annotations`, {
      doc: a.doc,
      id: a.id,
      status
    })
    await get().loadAnnotations()
  },

  async deleteAnnotation(a) {
    const s = get()
    if (!s.activeProjectId) return
    await api(
      'DELETE',
      `/api/projects/${s.activeProjectId}/annotations?doc=${encodeURIComponent(a.doc)}&id=${encodeURIComponent(a.id)}`
    )
    await get().loadAnnotations()
  }
}))
