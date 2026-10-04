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
