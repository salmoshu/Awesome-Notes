// 远程连接：zcode 式接入 —— WSL/SSH 由本地 sidecar 自动部署并启动远端 notesd
// （NDJSON 流式回报进度），Docker/自定义 直连已有 notesd 地址。
// 连接配置持久化在 localStorage；应用重启后 connected=false，在侧栏显示未连接占位，由用户点击 ⟳ 手动重连。
import type { Project, RemoteConfig, RemoteProjectInfo, SshConfig } from '@shared/types'
import { api, apiInfo, apiWith } from '../api'

const REMOTES_KEY = 'awesome-notes-remotes'

export interface LogLine {
  step?: string
  level: 'info' | 'ok' | 'err'
  msg: string
}

export type ConnectParams =
  | { kind: 'wsl'; name?: string; distro: string }
  | { kind: 'ssh'; name?: string; ssh: SshConfig }
  | { kind: 'docker' | 'custom'; name?: string; host: string; port: number; token: string }

export interface SetupResult {
  host: string
  port: number
  token: string
  version: string
  connId?: string
}

export function loadRemotes(): RemoteConfig[] {
  try {
    const raw = localStorage.getItem(REMOTES_KEY)
    if (raw) {
      const list = JSON.parse(raw) as RemoteConfig[]
      // 重启后一律视为未连接，由 init 重新握手；旧数据无 kind 视为 custom
      return list.map((r) => ({ ...r, kind: r.kind ?? 'custom', connected: false, lastError: undefined }))
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

function newToken(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

/** 自动接入：调本地 sidecar /api/remote/setup，NDJSON 流式回报进度 */
export async function setupRemote(
  req:
    | { kind: 'wsl'; token: string; wsl: { distro: string } }
    | { kind: 'ssh'; token: string; ssh: SshConfig },
  onLog: (l: LogLine) => void
): Promise<SetupResult> {
  const { base, token } = await apiInfo()
  const r = await fetch(base + '/api/remote/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Notes-Token': token },
    body: JSON.stringify(req)
  })
  if (!r.ok || !r.body) {
    const d = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(d.error ?? `HTTP ${r.status}`)
  }
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let result: SetupResult | null = null
  let fail: string | null = null
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (!line) continue
      const j = JSON.parse(line) as {
        done?: boolean
        ok?: boolean
        error?: string
        result?: SetupResult
        step?: string
        level?: LogLine['level']
        msg?: string
      }
      if (j.done) {
        if (j.ok && j.result) result = j.result
        else fail = j.error ?? '连接失败'
      } else if (j.msg) {
        onLog({ step: j.step, level: j.level ?? 'info', msg: j.msg })
      }
    }
  }
  if (fail) throw new Error(fail)
  if (!result) throw new Error('连接中断（未收到完成消息）')
  return result
}

/** 断开自动接入的连接（关闭 sidecar 持有的 wsl.exe / ssh 会话与转发） */
export async function teardownRemote(connId: string): Promise<void> {
  try {
    await api('POST', '/api/remote/teardown', { connId })
  } catch {
    /* sidecar 重启后句柄本就没了 */
  }
}

/** 远端项目列表 → 本地快照（断开后侧栏按原项目名占位；重连同步时刷新） */
function snapProjects(list: Project[]): RemoteProjectInfo[] {
  return list.map((p) => ({ id: p.id, name: p.name, path: p.path, docCount: p.docCount }))
}

/** 握手：健康检查 + 拉取远端项目列表（项目列表仅用于老数据迁移时一次性采纳） */
async function handshake(remote: RemoteConfig): Promise<{ remote: RemoteConfig; projects: Project[] }> {
  const r = await apiWith<{ projects: Project[] }>(remoteBase(remote), remote.token, 'GET', '/api/projects')
  const raw = r.projects ?? []
  return {
    remote: { ...remote, connected: true, lastError: undefined, projects: snapProjects(raw) },
    projects: raw.map((p) => ({ ...p, id: `${remote.id}:${p.id}`, remoteId: remote.id }))
  }
}

/** 连接后同步项目：本地清单为真相（远端 notesd 只是壳）。
 *  新建连接 projectPaths 已初始化为 []，不采纳远端存量（远端注册表只是历史导入的镜像，
 *  全量采纳会让项目"凭空出现"）；仅老数据（projectPaths 缺失）首连一次性采纳远端已注册项目。
 *  之后按本地清单逐个幂等注册（项目 id 由路径 sha1 派生，跨会话稳定），路径失效的跳过但保留在清单中 */
export async function syncRemoteProjects(
  remote: RemoteConfig
): Promise<{ remote: RemoteConfig; projects: Project[] }> {
  const h = await handshake(remote)
  if (!remote.projectPaths) {
    return { remote: { ...h.remote, projectPaths: h.projects.map((p) => p.path) }, projects: h.projects }
  }
  const out: Project[] = []
  const snap: RemoteProjectInfo[] = []
  for (const path of remote.projectPaths) {
    try {
      const p = await apiWith<Project>(remoteBase(h.remote), h.remote.token, 'POST', '/api/projects', { path })
      out.push({ ...p, id: `${h.remote.id}:${p.id}`, remoteId: h.remote.id })
      snap.push({ id: p.id, name: p.name, path: p.path, docCount: p.docCount })
    } catch {
      /* 路径失效（已删除/暂不可读）：跳过；恢复后下次连接自动挂上 */
    }
  }
  // 快照以本地清单为准（而非握手时远端的全量注册表），断开后按原名占位
  return { remote: { ...h.remote, projects: snap }, projects: out }
}

/** 新建远程连接（统一入口）：自动接入（wsl/ssh）或直连（docker/custom）。
 *  只建立通道与健康检查；项目清单由 store 去重后调 syncRemoteProjects 同步 */
export async function establishRemote(
  params: ConnectParams,
  onLog: (l: LogLine) => void = () => {}
): Promise<{ remote: RemoteConfig }> {
  if (params.kind === 'wsl') {
    const token = newToken()
    const res = await setupRemote({ kind: 'wsl', token, wsl: { distro: params.distro } }, onLog)
    return {
      remote: {
        id: newId(),
        name: params.name?.trim() || `WSL · ${params.distro}`,
        host: res.host,
        port: res.port,
        token,
        connected: false,
        kind: 'wsl',
        connId: res.connId,
        wsl: { distro: params.distro },
        // 新连接本地项目清单从空开始（本地为真相），不采纳远端注册表存量
        projectPaths: []
      }
    }
  }
  if (params.kind === 'ssh') {
    const token = newToken()
    const res = await setupRemote({ kind: 'ssh', token, ssh: params.ssh }, onLog)
    return {
      remote: {
        id: newId(),
        name: params.name?.trim() || `${params.ssh.user}@${params.ssh.host}`,
        host: res.host,
        port: res.port,
        token,
        connected: false,
        kind: 'ssh',
        connId: res.connId,
        ssh: params.ssh,
        projectPaths: []
      }
    }
  }
  // docker / custom：直连已有 notesd
  const probe: RemoteConfig = {
    id: newId(),
    name: params.name?.trim() || `${params.host}:${params.port}`,
    host: params.host.trim(),
    port: params.port,
    token: params.token.trim(),
    connected: false,
    kind: params.kind,
    projectPaths: []
  }
  onLog({ level: 'info', msg: `健康检查 ${remoteBase(probe)} …` })
  await apiWith(remoteBase(probe), probe.token, 'GET', '/api/health')
  onLog({ level: 'ok', msg: 'notesd 可达，握手完成' })
  return { remote: probe }
}

/** 重连：wsl/ssh 需重新 setup（sidecar 重启后句柄/转发已失效），其余直接用原配置 */
export async function reestablishRemote(
  remote: RemoteConfig,
  onLog: (l: LogLine) => void = () => {}
): Promise<{ remote: RemoteConfig }> {
  if (remote.kind === 'wsl' && remote.wsl) {
    const res = await setupRemote({ kind: 'wsl', token: remote.token, wsl: remote.wsl }, onLog)
    return { remote: { ...remote, host: res.host, port: res.port, connId: res.connId } }
  }
  if (remote.kind === 'ssh' && remote.ssh) {
    const res = await setupRemote({ kind: 'ssh', token: remote.token, ssh: remote.ssh }, onLog)
    return { remote: { ...remote, host: res.host, port: res.port, connId: res.connId } }
  }
  return { remote }
}

// ---- 远程目录浏览（选择要导入的目录） ----

export interface FsEntry {
  name: string
  path: string
  hasDocs: boolean
}

export interface FsList {
  path: string
  home: string
  parent: string
  sep: string
  entries: FsEntry[]
  truncated: boolean
}

export async function fsList(remote: RemoteConfig, path: string, showAll = false): Promise<FsList> {
  return apiWith<FsList>(
    remoteBase(remote),
    remote.token,
    'GET',
    `/api/fs/list?path=${encodeURIComponent(path)}${showAll ? '&all=1' : ''}`
  )
}
