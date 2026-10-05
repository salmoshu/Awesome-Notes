// 打包入口：sidecar 构建 → 渲染层构建 → 版本标记校验 → electron-builder。
// 自包含设计（v0.2.2/v0.2.3 事故教训：绕过 vite build 直接打包，把陈旧 out/ 流出）：
//   1. 本脚本自己执行完整构建，不存在"忘记 build"的路径；
//   2. 构建后校验最新 bundle 含当前版本号标记（__APP_VERSION__），陈旧产物直接中止。
// 用法：node scripts/run-electron-builder.cjs [--publish]   （OUTPUT_DIR 环境变量可改输出目录）
const { spawnSync } = require('node:child_process')
const { readFileSync, readdirSync, statSync } = require('node:fs')
const { join } = require('node:path')

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true })
  if (r.status !== 0) {
    console.error(`[dist] 失败：${cmd} ${args.join(' ')}`)
    process.exit(1)
  }
}

function verifyBuildStamp() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
  const dir = 'out/renderer/assets'
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'))
  if (files.length === 0) {
    console.error('[dist] 校验失败：out/renderer/assets 没有 JS 产物')
    process.exit(1)
  }
  const newest = files
    .map((f) => ({ f, m: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)[0]
  const content = readFileSync(join(dir, newest.f), 'utf-8')
  if (!content.includes(pkg.version)) {
    console.error(
      `[dist] 校验失败：渲染层 bundle（${newest.f}）不含当前版本号 ${pkg.version}，` +
        '疑似陈旧构建产物，拒绝打包。请先执行 pnpm run build 排查。'
    )
    process.exit(1)
  }
  console.log(`[dist] 版本标记校验通过：${newest.f} 含 ${pkg.version}`)
}

run('node', ['scripts/build-sidecar.mjs'])
run('npx', ['electron-vite', 'build'])
verifyBuildStamp()

const { build, Platform } = require('electron-builder')
const publish = process.argv.includes('--publish') ? 'always' : 'never'
const override = process.env.OUTPUT_DIR
  ? { config: { directories: { output: process.env.OUTPUT_DIR } } }
  : {}

build({ targets: Platform.WINDOWS.createTarget(['nsis']), publish, ...override })
  .then((artifacts) => {
    console.log('构建完成，产物：')
    for (const a of artifacts) console.log('  ' + a)
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
