// 主进程 / preload / 渲染进程共享类型

export interface ApiInfo {
  base: string
  token: string
}

export interface Project {
  id: string
  name: string
  path: string
  addedAt: string
  docCount: number
  /** 远程项目：所属远程连接 id（本地项目无此字段） */
  remoteId?: string
}

/** 远程连接配置（连接到远端机器上运行的 notesd 服务） */
export interface RemoteConfig {
  id: string
  name: string
  host: string
  port: number
  token: string
  connected: boolean
  lastError?: string
}

export interface DocNode {
  name: string
  path: string
  type: 'dir' | 'doc'
  ext?: string
  size?: number
  children?: DocNode[]
}

export interface DocContent {
  path: string
  ext: string
  content: string
  size: number
  mtime: string
}

export type AnnotationStatus = 'open' | 'done'

export interface Annotation {
  id: string
  doc: string
  quote: string
  prefix: string
  suffix: string
  text: string
  status: AnnotationStatus
  createdAt: string
  updatedAt: string
}

// ---- Git 集成（sidecar /api/projects/:id/git/*） ----

export interface GitChange {
  /** 相对项目根（/ 分隔） */
  path: string
  /** 重命名前的路径 */
  orig?: string
  /** 暂存区状态码（M/A/D/R/U/?，空格为无变化） */
  index: string
  /** 工作区状态码 */
  work: string
}

export interface GitStatus {
  repo: boolean
  branch: string
  ahead: number
  behind: number
  changes: GitChange[]
  err?: string
}

// ---- 项目内全文搜索（sidecar /api/projects/:id/search） ----

export interface SearchMatch {
  line: number
  text: string
}

export interface SearchFileResult {
  path: string
  ext: string
  count: number
  matches: SearchMatch[]
}

export interface SearchResponse {
  query: string
  files: SearchFileResult[]
  truncated: boolean
}

// preload 暴露给渲染进程的桥
export interface AwesomeNotesBridge {
  getApiInfo(): Promise<ApiInfo>
  selectFolder(): Promise<string | null>
  revealPath(p: string): Promise<void>
  winMinimize(): void
  winToggleMaximize(): void
  winClose(): void
  platform: string
  appVersion(): Promise<string>
  updaterCheck(): Promise<void>
  updaterDownload(): Promise<void>
  updaterQuitAndInstall(): Promise<void>
  updaterSetPrefs(prefs: UpdaterPrefs): void
  onUpdateStatus(cb: (e: UpdateStatusEvent) => void): () => void
  /** 读取 release-notes.md 中当前版本小节；找不到返回 null */
  getCurrentReleaseNotes(): Promise<string | null>
  /** 应用内打开外部网页（浮层）。来自主窗口导航拦截 / window.open */
  onOpenExternalPage(cb: (url: string) => void): () => void
  /** 浮层页面主文档的 HTTP 状态（>=400 时用于展示美化错误页） */
  onExtPageStatus(cb: (e: { url: string; code: number }) => void): () => void
  /** 用系统浏览器打开（浮层右上角 ↗） */
  openInSystemBrowser(url: string): Promise<void>
  /** 标签快捷键（主进程拦截 Ctrl+W / Ctrl+Tab 后转发） */
  onTabShortcut(cb: (kind: 'close' | 'next') => void): () => void
}

// ---- 版本更新（对齐 Nav-Tools UpdateService 语义） ----

export type UpdateStatusType =
  | 'checking'
  | 'update-available'
  | 'update-not-available'
  | 'download-progress'
  | 'update-downloaded'
  | 'error'

export interface UpdateStatusEvent {
  type: UpdateStatusType
  version?: string
  releaseNotes?: string
  percent?: number
  message?: string
}

export interface UpdaterPrefs {
  autoCheck: boolean
  autoDownload: boolean
  ignoredVersion?: string
}
