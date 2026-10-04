// electron-builder 程序化入口：绕过 CLI 的 argv 解析
//（本机开发环境的 node 运行时不按常规填充 process.argv，CLI 会把脚本路径误判为参数；
//  程序化 API 在任意 node 运行时下行为一致，普通终端与 Kimi 运行时均可使用）
// 用法：node scripts/run-electron-builder.cjs [--publish]
const { build, Platform } = require('electron-builder')

const publish = process.argv.includes('--publish') ? 'always' : 'never'

build({
  targets: Platform.WINDOWS.createTarget(['nsis']),
  publish
})
  .then((artifacts) => {
    console.log('构建完成，产物：')
    for (const a of artifacts) console.log('  ' + a)
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
