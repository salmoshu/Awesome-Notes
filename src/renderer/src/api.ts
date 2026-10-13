// sidecar HTTP API 封装。
// Electron 模式下经 preload 桥拿 base/token；纯 Web 预览（dev:web）回退到
// 手动启动的 sidecar（127.0.0.1:37123 / dev-token）。
// 远程项目经 apiWith() 走远端 timberd（见 utils/remote.ts 的 apiRoute）。
import type { ApiInfo, ArchRefs, ArchResult, ArchSpec, CommitDetail, CommitInfo } from '@shared/types'

let cached: ApiInfo | null = null

export async function apiInfo(): Promise<ApiInfo> {
  if (cached) return cached
  if (window.timber) {
    const info = await window.timber.getApiInfo()
    if (info) {
      cached = info
      return info
    }
  }
  // 纯 Web 预览回退
  cached = { base: 'http://127.0.0.1:37123', token: 'dev-token' }
  return cached
}

export async function apiWith<T = unknown>(
  base: string,
  token: string,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  let r: Response
  try {
    r = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Timber-Token': token
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } catch (e) {
    if (e instanceof TypeError) {
      throw new Error('本地 timberd 服务不可用（连接失败）；若刚被关闭会自动重启恢复，请稍候重试')
    }
    throw e
  }
  const data = (await r.json().catch(() => ({}))) as T & { error?: string }
  if (!r.ok) {
    throw new Error(data.error ?? `HTTP ${r.status}`)
  }
  return data
}

export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const { base, token } = await apiInfo()
  return apiWith<T>(base, token, method, path, body)
}

// sidecar 自动重启后地址可能变化，热更新缓存
window.timber?.onApiInfoChanged?.((info) => {
  cached = info
})

/** API 调用器签名（本地 api / 远程 apiFor 均可注入） */
export type ApiCall = <T = unknown>(method: string, path: string, body?: unknown) => Promise<T>

/** git log 分页列表 */
export async function gitLog(
  id: string,
  skip = 0,
  limit = 100,
  call: ApiCall = api
): Promise<{ commits: CommitInfo[]; total: number }> {
  return call<{ commits: CommitInfo[]; total: number }>(
    'GET',
    `/api/projects/${id}/git/log?limit=${limit}&skip=${skip}`
  )
}

/** git show 提交详情 */
export async function gitShow(id: string, sha: string, call: ApiCall = api): Promise<CommitDetail> {
  return call<CommitDetail>('GET', `/api/projects/${id}/git/show/${encodeURIComponent(sha)}`)
}

/** 架构快照可选 ref（HEAD + branches + tags） */
export async function archRefs(id: string, call: ApiCall = api): Promise<ArchRefs> {
  return call<ArchRefs>('GET', `/api/projects/${id}/arch/refs`)
}

/**
 * 架构 spec：成功响应为 spec JSON 本体（顶层含 diagram_type），
 * 失败为 { ok:false, error }（如 no-source/no-commits/not-a-repo），统一规整为 ArchResult。
 */
export async function archSpec(id: string, ref: string, call: ApiCall = api): Promise<ArchResult> {
  const data = await call<Record<string, unknown>>(
    'GET',
    `/api/projects/${id}/arch/spec?ref=${encodeURIComponent(ref)}`
  )
  if (typeof data.diagram_type === 'string') return { ok: true, spec: data as unknown as ArchSpec }
  // 错误响应形态 { ok:false, error }（no-source/no-commits/not-a-repo 等）
  const err = 'error' in data ? data.error : undefined
  return { ok: false, error: typeof err === 'string' ? err : 'unknown' }
}
