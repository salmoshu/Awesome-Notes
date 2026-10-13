import { useEffect, useState } from 'react'
import { useStore, type AppView } from '../store'
import Logo from './Logo'

const VIEWS: { key: AppView; label: string }[] = [
  { key: 'history', label: '历史' },
  { key: 'architecture', label: '架构' },
  { key: 'code', label: '代码' },
  { key: 'docs', label: '文档' }
]

export default function TitleBar() {
  const b = window.timber
  const openSettings = useStore((s) => s.openSettings)
  const annPanelOpen = useStore((s) => s.annPanelOpen)
  const activeDoc = useStore((s) => s.activeDoc)
  const toggleAnnPanel = useStore((s) => s.toggleAnnPanel)
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const [version, setVersion] = useState('')

  // 标题区版本号（Electron 环境从主进程取；纯 Web 预览不显示）
  useEffect(() => {
    let mounted = true
    b?.appVersion()
      .then((v) => {
        if (mounted) setVersion(v)
      })
      .catch(() => {})
    return () => {
      mounted = false
    }
  }, [b])

  return (
    <header className="titlebar">
      <div className="tb-drag">
        <Logo size={18} />
        <span className="tb-name">Timber</span>
        {version && <span className="tb-version">{`v${version}`}</span>}
      </div>
      {/* 主视图切换（历史/架构/代码/文档），拖拽区外才可点击 */}
      <nav className="tb-views">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            className={`tb-view ${view === v.key ? 'active' : ''}`}
            onClick={() => setView(v.key)}
          >
            {v.label}
          </button>
        ))}
      </nav>
      <div className="tb-btns">
        <button
          className={`tb-set ${annPanelOpen && activeDoc ? 'on' : ''}`}
          onClick={toggleAnnPanel}
          title={`右侧边栏（目录 / 标注）${activeDoc ? '' : '：打开文档后可用'}`}
        >
          ▤
        </button>
        <button className="tb-set" onClick={openSettings} title="设置">
          ⚙
        </button>
        {b && (
          <>
            <button onClick={() => b.winMinimize()} title="最小化">—</button>
            <button onClick={() => b.winToggleMaximize()} title="最大化/还原">▢</button>
            <button className="tb-close" onClick={() => b.winClose()} title="关闭">✕</button>
          </>
        )}
      </div>
    </header>
  )
}
