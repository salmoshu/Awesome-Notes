// 客户端本地的个性化数据：项目别名 / 项目屏蔽 / 文档与文件夹屏蔽。
// 这些是“阅读偏好”而非项目数据，随应用（localStorage）持久化，不落 sidecar。
const ALIAS_PREFIX = 'awesome-notes-alias:'
const BLOCKED_DOCS_PREFIX = 'awesome-notes-blocked:'
const HIDDEN_PROJECTS_KEY = 'awesome-notes-hidden-projects'

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw) as T
  } catch {
    /* 损坏数据忽略 */
  }
  return fallback
}

function writeJSON(key: string, v: unknown): void {
  localStorage.setItem(key, JSON.stringify(v))
}

// ---- 项目别名（更名，仅影响本机显示） ----

export function projectAlias(projectId: string): string | null {
  const v = readJSON<string | null>(ALIAS_PREFIX + projectId, null)
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export function setProjectAlias(projectId: string, name: string | null): void {
  if (name === null) localStorage.removeItem(ALIAS_PREFIX + projectId)
  else writeJSON(ALIAS_PREFIX + projectId, name)
}

// ---- 项目屏蔽（从列表隐藏，可随时恢复） ----

export function hiddenProjectIds(): string[] {
  return readJSON<string[]>(HIDDEN_PROJECTS_KEY, [])
}

function saveHidden(ids: string[]): void {
  writeJSON(HIDDEN_PROJECTS_KEY, ids)
}

export function isProjectHidden(projectId: string): boolean {
  return hiddenProjectIds().includes(projectId)
}

export function hideProject(projectId: string): void {
  const ids = hiddenProjectIds()
  if (!ids.includes(projectId)) saveHidden([...ids, projectId])
}

export function unhideProject(projectId: string): void {
  saveHidden(hiddenProjectIds().filter((id) => id !== projectId))
}

// ---- 文档 / 文件夹屏蔽（相对项目根，/ 分隔；屏蔽父目录即屏蔽子树） ----

function blockedKey(projectId: string): string {
  return BLOCKED_DOCS_PREFIX + projectId
}

export function blockedPaths(projectId: string): string[] {
  return readJSON<string[]>(blockedKey(projectId), [])
}

function saveBlocked(projectId: string, paths: string[]): void {
  writeJSON(blockedKey(projectId), paths)
}

/** 自身或任一祖先被屏蔽即视为屏蔽（子路径被屏蔽不影响父文件夹本身） */
export function isBlocked(projectId: string, path: string): boolean {
  return blockedPaths(projectId).some((b) => b === path || path.startsWith(b + '/'))
}

/** 该路径是否被精确屏蔽（用于右键菜单显示“取消屏蔽”） */
export function isExactBlocked(projectId: string, path: string): boolean {
  return blockedPaths(projectId).includes(path)
}

export function blockPath(projectId: string, path: string): void {
  const paths = blockedPaths(projectId)
  if (!paths.includes(path)) saveBlocked(projectId, [...paths, path])
}

export function unblockPath(projectId: string, path: string): void {
  saveBlocked(
    projectId,
    blockedPaths(projectId).filter((p) => p !== path && !p.startsWith(path + '/'))
  )
}
