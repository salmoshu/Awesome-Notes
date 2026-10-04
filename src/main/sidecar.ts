// Go sidecar 生命周期管理：启动（自动分配端口 + 随机令牌）、就绪探测、退出清理。
import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { ApiInfo } from '@shared/types'

let child: ChildProcess | null = null

export async function startSidecar(): Promise<ApiInfo> {
  const token = randomBytes(16).toString('hex')
  const exe = app.isPackaged
    ? join(process.resourcesPath, 'sidecar', 'notesd.exe')
    : join(app.getAppPath(), 'sidecar', 'bin', 'notesd.exe')
  if (!existsSync(exe)) {
    throw new Error(`sidecar 二进制不存在：${exe}（请先执行 pnpm build:sidecar）`)
  }
  const dataDir = join(app.getPath('userData'), 'sidecar-data')

  child = spawn(exe, ['-addr', '127.0.0.1:0', '-token', token, '-data', dataDir], {
    stdio: ['ignore', 'pipe', 'inherit']
  })

  const port = await new Promise<number>((resolve, reject) => {
    let buf = ''
    const timer = setTimeout(() => reject(new Error('sidecar 启动超时（10s）')), 10_000)
    child!.stdout!.on('data', (d) => {
      buf += d.toString()
      const m = buf.match(/NOTESD_READY port=(\d+)/)
      if (m) {
        clearTimeout(timer)
        resolve(parseInt(m[1], 10))
      }
    })
    child!.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`sidecar 过早退出 code=${code}`))
    })
    child!.on('error', reject)
  })

  child.on('exit', (code) => {
    console.warn(`[sidecar] exited code=${code}`)
    child = null
  })

  return { base: `http://127.0.0.1:${port}`, token }
}

export function stopSidecar(): void {
  try {
    child?.kill()
  } catch {
    /* ignore */
  }
  child = null
}
