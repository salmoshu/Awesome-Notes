import { type ReactNode, useEffect, useRef } from 'react'
import { useStore } from '../store'

/** 文档标签栏（VSCode 语义：斜体 = 预览标签，随单击复用；双击固定）；
 *  children 渲染为行右端操作区（全屏专注 / 阅读模式|编辑模式 / 保存等）。
 *  多文档时仅 tab 区横向滚动（tab 先收缩到最小宽、再滚动），
 *  右端操作区固定在可视区，不被挤走；激活 tab 自动滚入可视范围 */
export default function TabsBar({ children }: { children?: ReactNode }) {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const { activateTab, closeTab, pinTab } = useStore.getState()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current?.querySelector('.doc-tab.active')
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTabId, tabs.length])

  if (tabs.length === 0) return null

  return (
    <div className="tabs-bar">
      <div className="tabs-scroll" ref={scrollRef}>
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
      </div>
      {children && <div className="tabs-actions">{children}</div>}
    </div>
  )
}
