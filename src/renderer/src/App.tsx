import { useEffect } from 'react'
import { useStore } from './store'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import Reader from './components/Reader'
import AnnotationPanel from './components/AnnotationPanel'
import Toasts from './components/Toasts'
import UpdateCard from './components/UpdateCard'
import SettingsModal from './components/SettingsModal'
import ExternalPage from './components/ExternalPage'
import AddProjectDialog from './components/AddProjectDialog'
import Logo from './components/Logo'

export default function App() {
  const { init, ready, fatalError, annPanelOpen, activeDoc, extPageUrl, closeExtPage } = useStore()

  useEffect(() => {
    void init()
  }, [init])

  // 主进程拦截到的外链（导航 / window.open）转应用内浮层；浮层未挂载也能收到
  useEffect(() => window.awesomeNotes?.onOpenExternalPage((url) => useStore.getState().openExtPage(url)), [])

  // 标签快捷键（主进程 before-input-event 拦截后转发）：Ctrl+W 关闭、Ctrl+Tab 切换
  useEffect(
    () =>
      window.awesomeNotes?.onTabShortcut((kind) => {
        const s = useStore.getState()
        if (kind === 'close' && s.activeTabId) s.closeTab(s.activeTabId)
        else if (kind === 'next' && s.tabs.length > 1) {
          const idx = s.tabs.findIndex((t) => t.id === s.activeTabId)
          void s.activateTab(s.tabs[(idx + 1) % s.tabs.length].id)
        }
      }),
    []
  )

  if (!ready) {
    return (
      <div className="boot">
        <Logo size={56} />
        <div className="boot-text">Awesome-Notes 正在启动…</div>
      </div>
    )
  }

  if (fatalError) {
    return (
      <div className="boot">
        <Logo size={56} />
        <div className="boot-text">sidecar 服务连接失败</div>
        <div className="boot-err">{fatalError}</div>
        <div className="boot-hint">
          纯 Web 预览模式需先手动启动 sidecar：
          <code>sidecar/bin/notesd.exe -addr 127.0.0.1:37123 -token dev-token -data ./sidecar/data</code>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <TitleBar />
      <div className="app-body">
        <Sidebar />
        <main className="reader-wrap">
          <Reader />
        </main>
        {annPanelOpen && activeDoc && <AnnotationPanel />}
      </div>
      <Toasts />
      <UpdateCard />
      <SettingsModal />
      <AddProjectDialog />
      {extPageUrl && <ExternalPage url={extPageUrl} onClose={closeExtPage} />}
    </div>
  )
}
