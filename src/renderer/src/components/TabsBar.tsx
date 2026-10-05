import { type ReactNode } from 'react'
import { useStore } from '../store'

/** 文档标签栏（VSCode 语义：斜体 = 预览标签，随单击复用；双击固定）；
 *  children 渲染为行右端操作区（阅读|原文 / 保存等，参考 VSCode markdown 插件） */
export default function TabsBar({ children }: { children?: ReactNode }) {
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
          <button
            className={`tab-close ${t.dirty ? 'dirty' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              closeTab(t.id)
            }}
            title={t.dirty ? '未保存 · 点击关闭（丢弃需确认）' : '关闭 (Ctrl+W)'}
          >
            <span className="tc-dot">●</span>
            <span className="tc-x">✕</span>
          </button>
        </div>
      ))}
      {children && <div className="tabs-actions">{children}</div>}
    </div>
  )
}
