// 把 Vditor 按需加载的渲染库（mermaid / katex / echarts 等）复制到渲染层 public 目录，
// 使 Vditor 的 cdn 选项指向本地文件，离线/打包环境下也能渲染图表与数学公式。
// 输出目录已 gitignore（node_modules 为真相，postinstall/predev/prebuild 都会执行本脚本）。
// 注意：本机 node 的 cpSync(recursive) 会静默崩溃，这里手写递归复制（readdir + copyFile）。
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const srcBase = resolve(root, 'node_modules/vditor/dist/js')
const destBase = resolve(root, 'src/renderer/public/vditor-libs/dist/js')

// 与 Vditor processCode/markdown 渲染器一一对应；plantuml 需在线服务、mathjax 与 KaTeX
// 二选一（默认 KaTeX）、highlight.js 由 npm 包直接引入，均不复制。
const LIBS = [
  'mermaid',
  'katex',
  'echarts',
  'flowchart.js',
  'graphviz',
  'markmap',
  'wavedrom',
  'smiles-drawer',
  'abcjs'
]

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name)
    const d = join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(s, d)
    } else if (entry.isFile()) {
      copyFileSync(s, d)
    }
  }
}

if (!existsSync(srcBase)) {
  console.error('[copy-vditor-libs] 未找到 node_modules/vditor，请先 pnpm install')
  process.exit(1)
}

rmSync(destBase, { recursive: true, force: true })
let done = 0
for (const lib of LIBS) {
  const src = resolve(srcBase, lib)
  if (!existsSync(src)) {
    console.warn(`[copy-vditor-libs] 跳过缺失库：${lib}`)
    continue
  }
  copyDir(src, resolve(destBase, lib))
  done++
}
console.log(`[copy-vditor-libs] 已复制 ${done} 个渲染库到 src/renderer/public/vditor-libs/`)
