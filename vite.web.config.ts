// 纯 Web 预览配置（不启动 Electron）：配合手动启动的 sidecar 使用。
// sidecar 启动示例：sidecar/bin/notesd.exe -addr 127.0.0.1:37123 -token dev-token -data ./sidecar/data
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'))

export default defineConfig({
  root: resolve('src/renderer'),
  resolve: { alias: { '@shared': resolve('src/shared') } },
  plugins: [react()],
  server: { port: 7100 },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) }
})
