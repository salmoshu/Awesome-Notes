import { create } from 'zustand'
import type { Project, RemoteConfig } from '@shared/types'
import type { Annotation, DocContent, DocNode } from '@shared/types'
import { api, apiWith, apiInfo } from './api'
import { connectRemote, loadRemotes, refreshRemote, remoteBase, saveRemotes } from './utils/remote'
import { applyAppearance, loadSettings, saveSettings, type AppSettings } from './utils/settings'

export type ViewMode = 'read' | 'edit'

/** 一个打开的文档标签（VSCode 语义：preview 标签被单击复用，双击固定为独立标签） */
export interface DocTab {
  id: string
  /** 相对项目根路径 */
  path: string
  pinned: boolean
  mode: ViewMode
  /** 编辑草稿与脏状态随标签保留（切标签不丢） */
  draft: string
  dirty: boolean
  /** 阅读区滚动位置（切换后恢复） */
  scrollTop: number
  /** 右侧面板页签（目录/批注）记忆，默认目录 */
  panel: 'toc' | 'ann'
}

export interface Toast {
  id: number
  kind: 'ok' | 'err' | 'info'
  text: string
}

let tabSeq = 1
let toastSeq = 1
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null

function newTabId(): string {
  return 'tab-' + tabSeq++
}

interface State {
  ready: boolean
  fatalError: string | null
  /** 本地 + 已连接远程（合并视图，远程条目带 remoteId） */
  projects: Project[]
  localProjects: Project[]
  remotes: RemoteConfig[]
  addProjectOpen: boolean
  activeProjectId: string | null
  tree: DocNode | null
  treeLoading: boolean
  filter: string
  tabs: DocTab[]
  activeTabId: string | null
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
  settings: AppSettings
  settingsOpen: boolean
  extPageUrl: string | null
  /** 搜索结果点击后待定位：打开文档后滚到首个命中处 */
  pendingLocate: { path: string; keyword: string } | null

  setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void
  openSettings(): void
  closeSettings(): void
  openAddProject(): void
  closeAddProject(): void
  connectRemote(host: string, port: number, token: string, name?: string): Promise<void>
  reconnectRemote(remoteId: string): Promise<void>
  disconnectRemote(remoteId: string): void
  openExtPage(url: string): void
  closeExtPage(): void
  setPendingLocate(v: { path: string; keyword: string } | null): void

  init(): Promise<void>
  toast(kind: Toast['kind'], text: string): void
  importProject(path: string): Promise<void>
  removeProject(id: string): Promise<void>
  selectProject(id: string): Promise<void>
  rescan(): Promise<void>

  /** 单击：预览语义（复用预览标签）；双击：固定为新标签 */
  openTab(path: string, opts?: { pinned?: boolean }): Promise<void>
  /** 兼容入口 = 预览打开（搜索/Git/目录跳转等） */
  openDoc(path: string): Promise<void>
  activateTab(id: string): Promise<void>
  closeTab(id: string): void
  patchActiveTab(patch: Partial<DocTab>): void

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

/** 远程项目合成 id（rm-xxx:origId）→ 还原为远端原始 id */
export function origProjectId(projectId: string): string {
  return projectId.replace(/^rm-[a-z0-9]+:/, '')
}

/** 按项目路由 API：远程项目走远端 notesd（并还原路径中的原始项目 id），本地项目走默认 */
export function apiFor<T = unknown>(
  projectId: string | null | undefined
): (method: string, path: string, body?: unknown) => Promise<T> {
  const remotes = useStore.getState().remotes
  const remote =
    projectId && projectId.includes(':')
      ? remotes.find((r) => projectId.startsWith(r.id + ':'))
      : undefined
  if (remote) {
    const base = remoteBase(remote)
    const token = remote.token
    return (method: string, path: string, body?: unknown) =>
      apiWith<T>(base, token, method, path.split(remote.id + ':').join(''), body)
  }
  return (method: string, path: string, body?: unknown) => api<T>(method, path, body)
}

/** 项目（含远程）对应的 /raw 文件服务 base（HTML iframe 用） */
export async function rawBaseFor(projectId: string | null | undefined): Promise<string> {
  const remotes = useStore.getState().remotes
  const remote =
    projectId && projectId.includes(':')
      ? remotes.find((r) => projectId.startsWith(r.id + ':'))
      : undefined
  if (remote) return remoteBase(remote)
  return (await apiInfo()).base
}

function mergeProjects(local: Project[], remotes: RemoteConfig[], remoteProjects: Project[]): Project[] {
  const connected = new Set(remotes.filter((r) => r.connected).map((r) => r.id))
  return [...local, ...remoteProjects.filter((p) => p.remoteId && connected.has(p.remoteId))]
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  fatalError: null,
  projects: [],
  localProjects: [],
  remotes: loadRemotes(),
  addProjectOpen: false,
  activeProjectId: null,
  tree: null,
  treeLoading: false,
  filter: '',
  tabs: [],
  activeTabId: null,
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
  settings: loadSettings(),
  settingsOpen: false,
  extPageUrl: null,
  pendingLocate: null,

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

  openAddProject() {
    set({ addProjectOpen: true })
  },

  closeAddProject() {
    set({ addProjectOpen: false })
  },

  async connectRemote(host, port, token, name) {
    try {
      const { remote, projects } = await connectRemote(host, port, token, name)
      const remotes = [...get().remotes.filter((r) => r.id !== remote.id), remote]
      saveRemotes(remotes)
      set({
        remotes,
        projects: mergeProjects(get().localProjects, remotes, [
          ...get().projects.filter((p) => p.remoteId && p.remoteId !== remote.id),
          ...projects
        ]),
        addProjectOpen: false
      })
      get().toast('ok', `已连接 ${remote.name}（${projects.length} 个项目）`)
    } catch (err) {
      get().toast('err', `连接失败：${err}`)
      throw err
    }
  },

  async reconnectRemote(remoteId) {
    const remote = get().remotes.find((r) => r.id === remoteId)
    if (!remote) return
    try {
      const { remote: ok, projects } = await refreshRemote(remote)
      const remotes = get().remotes.map((r) => (r.id === remoteId ? ok : r))
      saveRemotes(remotes)
      set({
        remotes,
        projects: mergeProjects(get().localProjects, remotes, [
          ...get().projects.filter((p) => p.remoteId && p.remoteId !== remoteId),
          ...projects
        ])
      })
      get().toast('ok', `${ok.name} 已重新连接`)
    } catch (err) {
      const remotes = get().remotes.map((r) =>
        r.id === remoteId ? { ...r, connected: false, lastError: String(err) } : r
      )
      saveRemotes(remotes)
      set({ remotes, projects: mergeProjects(get().localProjects, remotes, get().projects) })
      get().toast('err', `重连失败：${err}`)
    }
  },

  disconnectRemote(remoteId) {
    const remotes = get().remotes.filter((r) => r.id !== remoteId)
    saveRemotes(remotes)
    const activeId = get().activeProjectId
    set({
      remotes,
      projects: mergeProjects(get().localProjects, remotes, get().projects),
      activeProjectId:
        activeId && activeId.startsWith(remoteId + ':') ? null : activeId,
      tree: activeId && activeId.startsWith(remoteId + ':') ? null : get().tree,
      tabs: activeId && activeId.startsWith(remoteId + ':') ? [] : get().tabs,
      activeTabId: activeId && activeId.startsWith(remoteId + ':') ? null : get().activeTabId,
      activeDoc: activeId && activeId.startsWith(remoteId + ':') ? null : get().activeDoc
    })
  },

  openExtPage(url) {
    set({ extPageUrl: url })
  },

  closeExtPage() {
    set({ extPageUrl: null })
  },

  setPendingLocate(v) {
    set({ pendingLocate: v })
  },

  async init() {
    const settings = get().settings
    applyAppearance(settings)
    set({ annPanelOpen: settings.annPanelDefaultOpen })
    try {
      const r = await api<{ projects: Project[] }>('GET', '/api/projects')
      const localProjects = r.projects ?? []
      set({ localProjects })
      // 已存远程自动重连（重启后需要重新握手）
      const remotes = get().remotes
      if (remotes.length > 0) {
        void Promise.allSettled(remotes.map((rm) => get().reconnectRemote(rm.id))).then(() => {
          set({ ready: true })
        })
        set({ ready: true, projects: mergeProjects(localProjects, get().remotes, []) })
        return
      }
      set({ projects: localProjects, ready: true })
    } catch (err) {
      set({ fatalError: String(err), ready: true })
      return
    }
    const first = get().projects[0]
    if (first) await get().selectProject(first.id)
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
      const localProjects = r.projects ?? []
      set({ localProjects, projects: mergeProjects(localProjects, get().remotes, get().projects) })
      await get().selectProject(p.id)
      get().toast('ok', `已导入 ${p.name}（${p.docCount} 篇文档）`)
    } catch (err) {
      get().toast('err', `导入失败：${err}`)
    }
  },

  async removeProject(id) {
    const p = get().projects.find((x) => x.id === id)
    if (p?.remoteId) {
      get().toast('info', '远程项目由远端 notesd 管理，可断开其远程连接或使用屏蔽')
      return
    }
    try {
      await api('DELETE', `/api/projects/${id}`)
      const r = await api<{ projects: Project[] }>('GET', '/api/projects')
      const localProjects = r.projects ?? []
      const { activeProjectId } = get()
      set({ localProjects, projects: mergeProjects(localProjects, get().remotes, get().projects) })
      if (activeProjectId === id) {
        set({ activeProjectId: null, tree: null, tabs: [], activeTabId: null, activeDoc: null, annotations: [] })
        const first = get().projects[0]
        if (first) await get().selectProject(first.id)
      }
    } catch (err) {
      get().toast('err', `移除失败：${err}`)
    }
  },

  async selectProject(id) {
    set({
      activeProjectId: id,
      tree: null,
      treeLoading: true,
      tabs: [],
      activeTabId: null,
      activeDoc: null,
      annotations: [],
      composeQuote: null
    })
    try {
      const tree = await apiFor<DocNode>(id)('GET', `/api/projects/${id}/tree`)
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
      await apiFor(id)('POST', `/api/projects/${id}/rescan`)
      const tree = await apiFor<DocNode>(id)('GET', `/api/projects/${id}/tree`)
      set({ tree, treeLoading: false })
      get().toast('ok', '已重新扫描')
    } catch (err) {
      set({ treeLoading: false })
      get().toast('err', `重新扫描失败：${err}`)
    }
  },

  async openTab(path, opts) {
    const s = get()
    const projectId = s.activeProjectId
    if (!projectId) return
    const pinned = opts?.pinned === true

    // 已开同路径标签：激活（双击则顺带固定）
    const existing = s.tabs.find((t) => t.path === path)
    if (existing) {
      if (pinned && !existing.pinned) {
        set({ tabs: s.tabs.map((t) => (t.id === existing.id ? { ...t, pinned: true } : t)) })
      }
      if (s.activeTabId !== existing.id) await get().activateTab(existing.id)
      return
    }

    if (pinned) {
      const tab: DocTab = { id: newTabId(), path, pinned: true, mode: 'read', draft: '', dirty: false, scrollTop: 0, panel: 'toc' }
      set({ tabs: [...s.tabs, tab] })
      await loadTabInto(tab, set, get)
      return
    }

    // 预览：复用现有预览标签（脏草稿需确认）
    const preview = s.tabs.find((t) => !t.pinned)
    if (preview) {
      if (preview.dirty && !window.confirm('预览标签有未保存的修改，切换文档将丢弃。继续？')) return
      const tab: DocTab = { ...preview, path, mode: 'read', draft: '', dirty: false, scrollTop: 0, panel: 'toc' }
      set({ tabs: s.tabs.map((t) => (t.id === tab.id ? tab : t)) })
      await loadTabInto(tab, set, get)
      return
    }
    const tab: DocTab = { id: newTabId(), path, pinned: false, mode: 'read', draft: '', dirty: false, scrollTop: 0, panel: 'toc' }
    set({ tabs: [...s.tabs, tab] })
    await loadTabInto(tab, set, get)
  },

  async openDoc(path) {
    await get().openTab(path, { pinned: false })
  },

  async activateTab(id) {
    const s = get()
    const target = s.tabs.find((t) => t.id === id)
    if (!target || s.activeTabId === id) return
    // 快照当前标签状态（滚动位置直接读 DOM，避免组件卸载导致监听失效）
    const cur = s.tabs.find((t) => t.id === s.activeTabId)
    const curScroll = document.querySelector('.reader-body')?.scrollTop ?? 0
    if (cur) {
      set({
        tabs: s.tabs.map((t) =>
          t.id === cur.id
            ? { ...t, mode: s.mode, draft: s.draft, dirty: s.dirty, scrollTop: curScroll }
            : t
        )
      })
    }
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer)
      autoSaveTimer = null
    }
    set({ activeTabId: id, composeQuote: null })
    await loadTabInto(target, set, get)
  },

  closeTab(id) {
    const s = get()
    const tab = s.tabs.find((t) => t.id === id)
    if (!tab) return
    if (tab.dirty && !window.confirm('该标签有未保存的修改，关闭将丢弃。继续？')) return
    const idx = s.tabs.findIndex((t) => t.id === id)
    const tabs = s.tabs.filter((t) => t.id !== id)
    if (s.activeTabId !== id) {
      set({ tabs })
      return
    }
    const next = tabs[Math.min(idx, tabs.length - 1)]
    set({ tabs, activeTabId: next?.id ?? null })
    if (next) {
      void loadTabInto(next, set, get)
    } else {
      set({ activeDoc: null, draft: '', dirty: false, annotations: [], composeQuote: null })
    }
  },

  patchActiveTab(patch) {
    const s = get()
    set({ tabs: s.tabs.map((t) => (t.id === s.activeTabId ? { ...t, ...patch } : t)) })
  },

  setFilter(f) {
    set({ filter: f })
  },

  setMode(m) {
    const s = get()
    const cur = s.tabs.find((t) => t.id === s.activeTabId)
    if (cur) set({ tabs: s.tabs.map((t) => (t.id === cur.id ? { ...t, mode: m } : t)) })
    if (m === 'edit' && s.activeDoc) set({ mode: m, draft: s.activeDoc.content, dirty: false })
    else set({ mode: m })
  },

  setDraft(d) {
    const s = get()
    const dirty = d !== s.activeDoc?.content
    const cur = s.tabs.find((t) => t.id === s.activeTabId)
    if (cur) set({ tabs: s.tabs.map((t) => (t.id === cur.id ? { ...t, draft: d, dirty } : t)) })
    set({ draft: d, dirty })
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
      await apiFor(s.activeProjectId)('PUT', `/api/projects/${s.activeProjectId}/doc`, {
        path: s.activeDoc.path,
        content: s.draft
      })
      const cur = get().tabs.find((t) => t.id === get().activeTabId)
      if (cur) {
        set({ tabs: get().tabs.map((t) => (t.id === cur.id ? { ...t, draft: s.draft, dirty: false } : t)) })
      }
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
      const r = await apiFor<{ annotations: Annotation[] }>(s.activeProjectId)(
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
      await apiFor(s.activeProjectId)('POST', `/api/projects/${s.activeProjectId}/annotations`, {
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
    await apiFor(s.activeProjectId)('PATCH', `/api/projects/${s.activeProjectId}/annotations`, {
      doc: a.doc,
      id: a.id,
      status
    })
    await get().loadAnnotations()
  },

  async deleteAnnotation(a) {
    const s = get()
    if (!s.activeProjectId) return
    await apiFor(s.activeProjectId)(
      'DELETE',
      `/api/projects/${s.activeProjectId}/annotations?doc=${encodeURIComponent(a.doc)}&id=${encodeURIComponent(a.id)}`
    )
    await get().loadAnnotations()
  }
}))

/** 把 tab 对应文档加载为当前显示（内部） */
async function loadTabInto(
  tab: DocTab,
  set: (partial: Partial<State>) => void,
  get: () => State
): Promise<void> {
  const projectId = get().activeProjectId
  if (!projectId) return
  set({
    activeTabId: tab.id,
    docLoading: true,
    activeDoc: null,
    composeQuote: null,
    mode: tab.mode,
    draft: tab.draft,
    dirty: tab.dirty
  })
  const ext = (tab.path.split('.').pop() ?? '').toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(ext)) {
    // 图片：不拉内容，直接以 /raw URL 渲染
    const doc: DocContent = { path: tab.path, ext, content: '', size: 0, mtime: '' }
    set({ activeDoc: doc, draft: '', dirty: false, docLoading: false })
    set({ annotations: [] })
    return
  }
  try {
    const doc = await apiFor<DocContent>(projectId)(
      'GET',
      `/api/projects/${projectId}/doc?path=${encodeURIComponent(tab.path)}`
    )
    const fresh = get().tabs.find((t) => t.id === tab.id)
    const useDraft = fresh?.dirty ? fresh.draft : doc.content
    set({
      activeDoc: doc,
      draft: useDraft,
      dirty: fresh?.dirty ?? false,
      docLoading: false
    })
    await get().loadAnnotations()
    // 渲染完成后恢复该标签记忆的滚动位置
    const remembered = get().tabs.find((t) => t.id === tab.id)?.scrollTop ?? 0
    if (remembered > 0) {
      setTimeout(() => {
        const body = document.querySelector('.reader-body')
        if (body) body.scrollTop = remembered
      }, 80)
    }
  } catch (err) {
    set({ docLoading: false })
    get().toast('err', `文档读取失败：${err}`)
  }
}
