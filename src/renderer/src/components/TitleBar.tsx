import { useEffect, useState } from 'react'
import { useStore } from '../store'
import Logo from './Logo'

export default function TitleBar() {
  const b = window.awesomeNotes
  const openSettings = useStore((s) => s.openSettings)
  const annPanelOpen = useStore((s) => s.annPanelOpen)
  const activeDoc = useStore((s) => s.activeDoc)
  const toggleAnnPanel = useStore((s) => s.toggleAnnPanel)
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
        <span className="tb-name">Awesome-Notes</span>
        {version && <span className="tb-version">{`v${version}`}</span>}
      </div>
      <div className="tb-btns">
        <button
          className={`tb-set ${annPanelOpen && activeDoc ? 'on' : ''}`}
          onClick={toggleAnnPanel}
          title={`右侧边栏（目录 / 批注）${activeDoc ? '' : '：打开文档后可用'}`}
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
