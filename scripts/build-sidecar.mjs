// Go sidecar 构建脚本（幂等）：优先使用项目内便携工具链 .toolchain/go，其次系统 PATH 中的 go。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'sidecar', 'bin')

function findGo() {
  const local = join(root, '.toolchain', 'go', 'bin', 'go.exe')
  if (existsSync(local)) return local
  try {
    execFileSync('go', ['version'], { stdio: 'pipe' })
    return 'go'
  } catch {
    return null
  }
}

const go = findGo()
if (!go) {
  console.warn('[build-sidecar] 未找到 go 工具链，跳过 sidecar 构建（阅读器将无法扫描/批注）')
  process.exit(0)
}

mkdirSync(outDir, { recursive: true })

// Windows 本地服务 + Linux amd64/arm64 部署包（WSL/SSH 远程接入时推送到远端运行）
const targets = [
  { out: 'notesd.exe', env: {} },
  { out: 'notesd-linux-amd64', env: { GOOS: 'linux', GOARCH: 'amd64', CGO_ENABLED: '0' } },
  { out: 'notesd-linux-arm64', env: { GOOS: 'linux', GOARCH: 'arm64', CGO_ENABLED: '0' } }
]

for (const t of targets) {
  console.log(`[build-sidecar] go build → sidecar/bin/${t.out}`)
  execFileSync(go, ['build', '-o', join(outDir, t.out), '.'], {
    cwd: join(root, 'sidecar'),
    stdio: 'inherit',
    env: { ...process.env, GOTOOLCHAIN: 'local', ...t.env }
  })
}
console.log('[build-sidecar] 完成')
