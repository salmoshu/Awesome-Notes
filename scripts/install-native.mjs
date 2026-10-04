// 原生依赖就绪脚本（postinstall，幂等）：electron 运行时缺失时从 npmmirror 下载并解压。
// 参考 Awesome-Resume 同名脚本（本项目无 better-sqlite3，只保留 electron 部分）。
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const electronPkgPath = require.resolve('electron/package.json')
const electronVersion = JSON.parse(readFileSync(electronPkgPath, 'utf8')).version
const electronDir = dirname(electronPkgPath)
const distDir = join(electronDir, 'dist')
const exePath = join(distDir, 'electron.exe')

if (existsSync(exePath)) {
  console.log('[install-native] electron 运行时已就绪')
} else {
  console.log(`[install-native] 下载 electron v${electronVersion}（npmmirror）…`)
  const zipUrl = `https://cdn.npmmirror.com/binaries/electron/${electronVersion}/electron-v${electronVersion}-win32-x64.zip`
  rmSync(distDir, { recursive: true, force: true })
  mkdirSync(distDir, { recursive: true })
  const localZip = join(distDir, 'electron.zip')
  execFileSync('curl', ['-fSL', '--retry', '3', '-o', localZip, zipUrl], { stdio: 'inherit' })
  // Windows 10+ 自带 bsdtar 支持 zip；Git Bash 的 GNU tar 不支持且会误解盘符
  const bsdTar = 'C:\\Windows\\System32\\tar.exe'
  execFileSync(existsSync(bsdTar) ? bsdTar : 'tar', ['-xf', 'electron.zip'], { cwd: distDir, stdio: 'inherit' })
  rmSync(localZip, { force: true })
  writeFileSync(join(electronDir, 'path.txt'), 'electron.exe')
  console.log('[install-native] electron 运行时安装完成')
}
