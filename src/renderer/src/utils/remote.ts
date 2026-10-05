// 远程连接：连接远端机器上运行的 notesd 服务，浏览/阅读远端项目文档。
// 连接配置持久化在 localStorage；应用重启后 connected=false，需重新连接（init 时自动尝试）。
import type { Project, RemoteConfig } from '@shared/types'
import { apiWith } from '../api'

const REMOTES_KEY = 'awesome-notes-remotes'

export function loadRemotes(): RemoteConfig[] {
  try {
    const raw = localStorage.getItem(REMOTES_KEY)
    if (raw) {
      const list = JSON.parse(raw) as RemoteConfig[]
      // 重启后一律视为未连接，由 init 重新握手
      return list.map((r) => ({ ...r, connected: false, lastError: undefined }))
    }
  } catch {
    /* 损坏数据忽略 */
  }
  return []
}

export function saveRemotes(list: RemoteConfig[]): void {
  localStorage.setItem(REMOTES_KEY, JSON.stringify(list))
}

export function remoteBase(r: RemoteConfig): string {
  return `http://${r.host}:${r.port}`
}

function newId(): string {
  return 'rm-' + Math.random().toString(36).slice(2, 10)
}

/** 握手：健康检查 + 拉取远端项目列表 */
export async function connectRemote(
  host: string,
  port: number,
  token: string,
  name?: string
): Promise<{ remote: RemoteConfig; projects: Project[] }> {
  const probe: RemoteConfig = {
    id: newId(),
    name: name?.trim() || `${host}:${port}`,
    host: host.trim(),
    port,
    token: token.trim(),
    connected: false
  }
  await apiWith(remoteBase(probe), probe.token, 'GET', '/api/health')
  const r = await apiWith<{ projects: Project[] }>(
    remoteBase(probe),
    probe.token,
    'GET',
    '/api/projects'
  )
  const remote = { ...probe, connected: true }
  const projects = (r.projects ?? []).map((p) => ({
    ...p,
    id: `${remote.id}:${p.id}`,
    remoteId: remote.id
  }))
  return { remote, projects }
}

/** 已连接远程的项目列表刷新 */
export async function refreshRemote(
  remote: RemoteConfig
): Promise<{ remote: RemoteConfig; projects: Project[] }> {
  const r = await apiWith<{ projects: Project[] }>(
    remoteBase(remote),
    remote.token,
    'GET',
    '/api/projects'
  )
  return {
    remote: { ...remote, connected: true, lastError: undefined },
    projects: (r.projects ?? []).map((p) => ({
      ...p,
      id: `${remote.id}:${p.id}`,
      remoteId: remote.id
    }))
  }
}
