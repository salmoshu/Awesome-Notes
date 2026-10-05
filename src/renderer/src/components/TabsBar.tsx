import { useStore } from '../store'

/** 文档标签栏（VSCode 语义：斜体 = 预览标签，随单击复用；双击固定） */
export default function TabsBar() {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const { activateTab, closeTab, pinTab } = useStore.getState()

  if (tabs.length === 0) return null

  return (
    <div className="tabs-bar">
      {tabs.map((t) => (
        <div
          key={t.id}
          className={`doc-tab ${t.id === activeTabId ? 'active' : ''} ${t.pinned ? '' : 'preview'}`}
          onClick={() => void activateTab(t.id)}
          onDoubleClick={() => pinTab(t.id)}
          onMouseDown={(e) => {
            // 中键关闭（VSCode 直觉）
            if (e.button === 1) {
              e.preventDefault()
              closeTab(t.id)
            }
          }}
          title={`${t.path}\n（双击固定标签）`}
        >
          <span className="tab-name">{t.path.split('/').pop()}</span>
          {t.dirty && <span className="tab-dirty">●</span>}
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation()
              closeTab(t.id)
            }}
            title="关闭 (Ctrl+W)"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
