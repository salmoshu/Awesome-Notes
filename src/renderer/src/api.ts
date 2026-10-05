// sidecar HTTP API 封装。
// Electron 模式下经 preload 桥拿 base/token；纯 Web 预览（dev:web）回退到
// 手动启动的 sidecar（127.0.0.1:37123 / dev-token）。
// 远程项目经 apiWith() 走远端 notesd（见 utils/remote.ts 的 apiRoute）。
import type { ApiInfo } from '@shared/types'

let cached: ApiInfo | null = null

export async function apiInfo(): Promise<ApiInfo> {
  if (cached) return cached
  if (window.awesomeNotes) {
    const info = await window.awesomeNotes.getApiInfo()
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
  const r = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Notes-Token': token
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
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
