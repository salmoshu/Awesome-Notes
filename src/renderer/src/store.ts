import { create } from 'zustand'
import type { Project, RemoteConfig } from '@shared/types'
import type { Annotation, DocContent, DocNode } from '@shared/types'
import { api, apiWith, apiInfo } from './api'
import {
  establishRemote,
  loadRemotes,
  reestablishRemote,
  remoteBase,
  saveRemotes,
  syncRemoteProjects,
  teardownRemote,
  type ConnectParams,
  type LogLine
} from './utils/remote'
import { applyAppearance, loadSettings, saveSettings, type AppSettings } from './utils/settings'
import { DOC_FORMAT_GROUPS } from '@shared/types'

/** 当前设置选中的扩展名列表（拼到 tree/rescan/search 请求） */
function extsList(): string[] {
  const keys = useStore.getState().settings.docFormats
  return DOC_FORMAT_GROUPS.filter((g) => keys.includes(g.key)).flatMap((g) => g.exts)
}

function extsQuery(): string {
  const exts = extsList()
  return exts.length > 0 ? `&exts=${encodeURIComponent(exts.join(','))}` : ''
}

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
  /** 已加载的文档内容缓存（切回标签即时呈现，后台校验新鲜度） */
  doc?: DocContent
}

export interface Toast {
  id: number
  kind: 'ok' | 'err' | 'info'
  text: string
}

/** 项目工作区缓存：切换项目时保存/还原打开的文档标签状态（会话内有效） */
const projectWorkspaces = new Map<string, { tabs: DocTab[]; activeTabId: string | null }>()

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
  connectRemote(params: ConnectParams, onLog?: (l: LogLine) => void): Promise<string>
  reconnectRemote(remoteId: string): Promise<void>
  /** 断开连接：远程条目保留在列表中（未连接占位，可 ⟳ 重连），其项目从列表消失 */
  disconnectRemote(remoteId: string): void
  /** 从列表移除：远程条目彻底移除，不再呈现（不影响远端文件） */
  removeRemote(remoteId: string): void
  /** 在已连接的远程上导入目录为项目 */
  importRemoteProject(remoteId: string, path: string): Promise<void>
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
  /** 固定标签（双击标签名，等效文件树双击） */
  pinTab(id: string): void
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
  /** 编辑批注内容（引用锚点不变） */
  editAnnotation(a: Annotation, text: string): Promise<void>
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

/** 两个远程配置是否指向同一目标（防重复连接导致项目翻倍） */
function sameRemoteTarget(a: RemoteConfig, b: RemoteConfig): boolean {
  if ((a.kind ?? 'custom') !== (b.kind ?? 'custom')) return false
  if (a.kind === 'wsl' && b.kind === 'wsl') return (a.wsl?.distro ?? '') === (b.wsl?.distro ?? '')
  if (a.kind === 'ssh' && b.kind === 'ssh')
    return a.ssh?.host === b.ssh?.host && a.ssh?.user === b.ssh?.user
  return a.host === b.host && a.port === b.port
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

  async connectRemote(params, onLog) {
    try {
      const { remote } = await establishRemote(params, onLog)
      // 同一目标（发行版/主机/端口）重复连接时沿用旧配置 id 与本地项目清单，
      // 避免出现双份远程，也保证本地移除过的项目不会"复活"
      const dup = get().remotes.find((r) => r.id !== remote.id && sameRemoteTarget(r, remote))
      if (dup) {
        remote.id = dup.id
        // 沿用已存条目的本地项目清单；已存条目缺该字段（v0.3.11 前的老数据）时保持
        // undefined，由 syncRemoteProjects 首连一次性采纳远端注册表完成迁移
        remote.projectPaths = dup.projectPaths
      }
      const synced = await syncRemoteProjects(remote)
      const remotes = [...get().remotes.filter((r) => r.id !== synced.remote.id), synced.remote]
      saveRemotes(remotes)
      set({
        remotes,
        projects: mergeProjects(get().localProjects, remotes, [
          ...get().projects.filter((p) => p.remoteId && p.remoteId !== synced.remote.id),
          ...synced.projects
        ])
      })
      get().toast('ok', `已连接 ${synced.remote.name}（${synced.projects.length} 个项目）`)
      return synced.remote.id
    } catch (err) {
      get().toast('err', `连接失败：${err}`)
      throw err
    }
  },

  async reconnectRemote(remoteId) {
    const remote = get().remotes.find((r) => r.id === remoteId)
    if (!remote) return
    try {
      const { remote: ok } = await reestablishRemote(remote)
      const synced = await syncRemoteProjects(ok)
      const remotes = get().remotes.map((r) => (r.id === remoteId ? synced.remote : r))
      saveRemotes(remotes)
      set({
        remotes,
        projects: mergeProjects(get().localProjects, remotes, [
          ...get().projects.filter((p) => p.remoteId && p.remoteId !== remoteId),
          ...synced.projects
        ])
      })
      get().toast('ok', `${synced.remote.name} 已重新连接`)
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
    const remote = get().remotes.find((r) => r.id === remoteId)
    if (!remote) return
    if (remote.connId) void teardownRemote(remote.connId)
    // 断开但保留条目：标为未连接占位，项目随 mergeProjects 过滤消失，可 ⟳ 重连
    const remotes = get().remotes.map((r) =>
      r.id === remoteId ? { ...r, connected: false, lastError: undefined, connId: undefined } : r
    )
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
    get().toast('info', `已断开 ${remote.name}，需要时可点击 ⟳ 重新连接`)
  },

  removeRemote(remoteId) {
    const remote = get().remotes.find((r) => r.id === remoteId)
    if (remote?.connId) void teardownRemote(remote.connId)
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
    if (remote) get().toast('ok', `已从列表移除 ${remote.name}`)
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
      // 远程连接不自动重连：重启后保持未连接占位，由用户点击 ⟳ 手动重连（zcode 式）
      set({ localProjects, projects: mergeProjects(localProjects, get().remotes, []), ready: true })
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
      // POST 响应即完整项目信息，本地合并，省去整表重拉
      const localProjects = [...get().localProjects.filter((x) => x.id !== p.id), p]
      set({ localProjects, projects: mergeProjects(localProjects, get().remotes, get().projects) })
      get().toast('ok', `已导入 ${p.name}（${p.docCount} 篇文档）`)
      void get().selectProject(p.id)
    } catch (err) {
      get().toast('err', `导入失败：${err}`)
    }
  },

  async importRemoteProject(remoteId, path) {
    const remote = get().remotes.find((r) => r.id === remoteId)
    if (!remote) return
    try {
      const p = await apiWith<Project>(remoteBase(remote), remote.token, 'POST', '/api/projects', { path })
      // 本地合成远程项目条目，省去整表重拉
      const composed: Project = { ...p, id: `${remoteId}:${p.id}`, remoteId }
      // 记入本地项目清单与快照（本地为真相，重连时按清单恢复，断开后按原名占位）
      const remotes = get().remotes.map((r) =>
        r.id === remoteId
          ? {
              ...r,
              projectPaths: [...new Set([...(r.projectPaths ?? []), p.path])],
              projects: [
                ...(r.projects ?? []).filter((x) => x.id !== p.id),
                { id: p.id, name: p.name, path: p.path, docCount: p.docCount }
              ]
            }
          : r
      )
      saveRemotes(remotes)
      set({
        remotes,
        projects: mergeProjects(get().localProjects, remotes, [
          ...get().projects.filter((x) => x.remoteId && x.id !== composed.id),
          composed
        ])
      })
      get().toast('ok', `已导入 ${p.name}（${p.docCount} 篇文档）`)
      void get().selectProject(composed.id)
    } catch (err) {
      get().toast('err', `导入失败：${err}`)
      throw err
    }
  },

  async removeProject(id) {
    const p = get().projects.find((x) => x.id === id)
    // 在线远程项目取自项目列表；已断开连接的离线占位项目从连接快照中解析
    const snapRemote = p?.remoteId
      ? undefined
      : get().remotes.find((r) => (r.projects ?? []).some((sp) => `${r.id}:${sp.id}` === id))
    const remoteId = p?.remoteId ?? snapRemote?.id
    if (remoteId) {
      const path =
        p?.path ?? snapRemote?.projects?.find((sp) => `${snapRemote.id}:${sp.id}` === id)?.path
      // 本地清单为真相：从本地清单删除即不再呈现；在线时顺带尽力远端注销（远端 notesd 只是壳）
      if (get().remotes.find((r) => r.id === remoteId)?.connected) {
        try {
          await apiFor(id)('DELETE', `/api/projects/${id}`)
        } catch {
          /* 远端不可达不阻断本地移除 */
        }
      }
      const remotes = get().remotes.map((r) =>
        r.id === remoteId
          ? {
              ...r,
              projectPaths: (r.projectPaths ?? []).filter((x) => x !== path),
              projects: (r.projects ?? []).filter((sp) => `${r.id}:${sp.id}` !== id)
            }
          : r
      )
      saveRemotes(remotes)
      projectWorkspaces.delete(id)
      const activeId = get().activeProjectId
      set({ remotes, projects: get().projects.filter((x) => x.id !== id) })
      if (activeId === id) {
        set({ activeProjectId: null, tree: null, tabs: [], activeTabId: null, activeDoc: null, annotations: [] })
        const first = get().projects[0]
        if (first) await get().selectProject(first.id)
      }
      get().toast('ok', '已从列表移除')
      return
    }
    try {
      await api('DELETE', `/api/projects/${id}`)
      projectWorkspaces.delete(id)
      // 本地过滤，省去整表重拉
      const localProjects = get().localProjects.filter((x) => x.id !== id)
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
    const s = get()
    if (id === s.activeProjectId) return
    // 保存当前项目的工作区（打开的标签 + 活动标签状态）
    if (s.activeProjectId && s.tabs.length > 0) {
      const curScroll = document.querySelector('.reader-body')?.scrollTop ?? 0
      const tabs = s.tabs.map((t) =>
        t.id === s.activeTabId
          ? { ...t, mode: s.mode, draft: s.draft, dirty: s.dirty, scrollTop: curScroll }
          : t
      )
      projectWorkspaces.set(s.activeProjectId, { tabs, activeTabId: s.activeTabId })
    }
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
      const tree = await apiFor<DocNode>(id)('GET', `/api/projects/${id}/tree?${extsQuery().slice(1)}`)
      set({ tree, treeLoading: false })
    } catch (err) {
      set({ treeLoading: false })
      get().toast('err', `文档树加载失败：${err}`)
    }
    // 还原该项目上次的工作区
    const ws = projectWorkspaces.get(id)
    if (ws && ws.tabs.length > 0) {
      set({ tabs: ws.tabs, activeTabId: ws.activeTabId })
      const target = ws.tabs.find((t) => t.id === ws.activeTabId) ?? ws.tabs[0]
      if (target) await loadTabInto(target, set, get)
    }
  },

  async rescan() {
    const id = get().activeProjectId
    if (!id) return
    set({ treeLoading: true })
    try {
      await apiFor(id)('POST', `/api/projects/${id}/rescan`, { exts: extsList() })
      const tree = await apiFor<DocNode>(id)('GET', `/api/projects/${id}/tree?${extsQuery().slice(1)}`)
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
      const tab: DocTab = { ...preview, path, mode: 'read', draft: '', dirty: false, scrollTop: 0, panel: 'toc', doc: undefined }
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

  pinTab(id) {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, pinned: true } : t)) }))
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
        // 同步标签内容缓存（保存后即最新）
        cacheTabDoc(cur.id, { ...s.activeDoc, content: s.draft }, set, get)
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

  async editAnnotation(a, text) {
    const s = get()
    if (!s.activeProjectId) return
    try {
      await apiFor(s.activeProjectId)('PATCH', `/api/projects/${s.activeProjectId}/annotations`, {
        doc: a.doc,
        id: a.id,
        text
      })
      await get().loadAnnotations()
      get().toast('ok', '批注已更新')
    } catch (err) {
      get().toast('err', `批注更新失败：${err}`)
    }
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

/** 把 tab 对应文档加载为当前显示（内部）。
 *  有缓存：立即呈现（切换无白闪），随后后台拉取校验新鲜度；
 *  无缓存：首载走 loading，完成后写入标签缓存。 */
async function loadTabInto(
  tab: DocTab,
  set: (partial: Partial<State>) => void,
  get: () => State
): Promise<void> {
  const projectId = get().activeProjectId
  if (!projectId) return
  const ext = (tab.path.split('.').pop() ?? '').toLowerCase()
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(ext)
  const cached = isImage
    ? ({ path: tab.path, ext, content: '', size: 0, mtime: '' } as DocContent)
    : tab.doc

  set({
    activeTabId: tab.id,
    docLoading: !cached,
    activeDoc: cached ?? null,
    composeQuote: null,
    mode: tab.mode,
    draft: tab.dirty ? tab.draft : (cached?.content ?? tab.draft),
    dirty: tab.dirty
  })

  if (cached) {
    // 图片：不拉内容也不校验
    if (isImage) {
      set({ annotations: [] })
      cacheTabDoc(tab.id, cached, set, get)
      return
    }
    await get().loadAnnotations()
    restoreScroll(tab, get)
  }

  try {
    const doc = await apiFor<DocContent>(projectId)(
      'GET',
      `/api/projects/${projectId}/doc?path=${encodeURIComponent(tab.path)}`
    )
    cacheTabDoc(tab.id, doc, set, get)
    const fresh = get().tabs.find((t) => t.id === tab.id)
    if (!fresh) return
    if (!cached) {
      // 首载完成：呈现并恢复滚动位置
      const useDraft = fresh.dirty ? fresh.draft : doc.content
      set({ activeDoc: doc, draft: useDraft, dirty: fresh.dirty, docLoading: false })
      await get().loadAnnotations()
      restoreScroll(fresh, get)
    } else if (!fresh.dirty && (doc.mtime !== cached.mtime || doc.size !== cached.size)) {
      // 外部修改过：静默更新内容（不打扰未保存草稿）
      set({ activeDoc: doc, draft: doc.content, dirty: false })
    }
  } catch (err) {
    if (!cached) {
      set({ docLoading: false })
      get().toast('err', `文档读取失败：${err}`)
    }
    // 有缓存时后台校验失败保持现状（如远程刚断开）
  }
}

/** 文档内容写入标签缓存 */
function cacheTabDoc(
  tabId: string,
  doc: DocContent,
  set: (partial: Partial<State>) => void,
  get: () => State
): void {
  set({ tabs: get().tabs.map((t) => (t.id === tabId ? { ...t, doc } : t)) })
}

/** 恢复标签记忆的滚动位置（渲染完成后执行） */
function restoreScroll(tab: DocTab, get: () => State): void {
  const remembered = get().tabs.find((t) => t.id === tab.id)?.scrollTop ?? 0
  if (remembered > 0) {
    setTimeout(() => {
      const body = document.querySelector('.reader-body')
      if (body) body.scrollTop = remembered
    }, 80)
  }
}
