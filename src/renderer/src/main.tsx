import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './prose.css'

// 版本标记（vite define 注入）：供打包脚本校验 bundle 新鲜度、也便于运行时排查
document.documentElement.dataset.appVersion = __APP_VERSION__

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
