// Go sidecar 构建脚本（幂等）：优先使用项目内便携工具链 .toolchain/go，其次系统 PATH 中的 go。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'sidecar', 'bin')
const out = join(outDir, 'notesd.exe')

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
console.log('[build-sidecar] go build → sidecar/bin/notesd.exe')
execFileSync(go, ['build', '-o', out, '.'], { cwd: join(root, 'sidecar'), stdio: 'inherit' })
console.log('[build-sidecar] 完成')
