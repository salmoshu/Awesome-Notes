import { useCallback, useRef, useState } from 'react'
import { useStore } from '../store'
import MarkdownView, { selectionAnchor } from './MarkdownView'
import EditorPane from './EditorPane'

export default function Reader() {
  const {
    activeDoc,
    docLoading,
    mode,
    setMode,
    dirty,
    saving,
    saveDoc,
    annotations,
    annPanelOpen,
    toggleAnnPanel,
    setComposeQuote,
    projects,
    activeProjectId,
    toast
  } = useStore()

  const proseWrapRef = useRef<HTMLDivElement>(null)
  const [pop, setPop] = useState<{ x: number; y: number } | null>(null)

  const openCount = annotations.filter((a) => a.status === 'open').length
  const isMd = activeDoc && ['md', 'markdown', 'mdown', 'mkd'].includes(activeDoc.ext)
  const isHtml = activeDoc && ['html', 'htm'].includes(activeDoc.ext)
  const project = projects.find((p) => p.id === activeProjectId)

  const onMouseUp = useCallback(() => {
    const wrap = proseWrapRef.current
    if (!wrap) return
    const prose = wrap.querySelector('.prose') as HTMLElement | null
    if (!prose) return
    const anchor = selectionAnchor(prose)
    if (!anchor) {
      setPop(null)
      return
    }
    const sel = window.getSelection()!
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    const wrapRect = wrap.getBoundingClientRect()
    setPop({ x: rect.left - wrapRect.left + rect.width / 2, y: rect.top - wrapRect.top - 8 })
    ;(onMouseUp as unknown as { _anchor?: unknown })._anchor = anchor
  }, [])

  const startCompose = () => {
    const anchor = (onMouseUp as unknown as { _anchor?: { quote: string; prefix: string; suffix: string } })._anchor
    if (anchor) setComposeQuote(anchor)
    setPop(null)
    window.getSelection()?.removeAllRanges()
  }

  const copyDocAddress = async () => {
    if (!project || !activeDoc) return
    const abs = `${project.path}\\${activeDoc.path.replace(/\//g, '\\')}`
    const text = [
      '[Awesome-Notes 文档]',
      `链接: awesome-notes://${project.name}/${activeDoc.path}`,
      `文档: ${abs}`,
      `项目: ${project.path}`
    ].join('\n')
    await navigator.clipboard.writeText(text)
    toast('ok', '文档地址已复制，可发给 agent')
  }

  if (!activeDoc) {
    return (
      <div className="reader-empty">
        {docLoading ? (
          <div className="re-hint">读取中…</div>
        ) : (
          <>
            <div className="re-logo">📖</div>
            <div className="re-title">从左侧选择一篇文档开始阅读</div>
            <div className="re-hint">
              支持 Markdown / HTML / TXT；选中文字即可批注，批注地址可复制给 agent 执行修改。
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="reader">
      <div className="reader-toolbar">
        <div className="rt-path" title={activeDoc.path}>
          {activeDoc.path}
        </div>
        <div className="rt-ops">
          {(isMd || activeDoc.ext === 'txt') && (
            <div className="seg">
              <button className={mode === 'read' ? 'active' : ''} onClick={() => setMode('read')}>
                阅读
              </button>
              <button className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>
                编辑{dirty ? ' •' : ''}
              </button>
            </div>
          )}
          {mode === 'edit' && (
            <button className="btn-save" disabled={!dirty || saving} onClick={() => void saveDoc()}>
              {saving ? '保存中…' : dirty ? '保存 (Ctrl+S)' : '已保存'}
            </button>
          )}
          <button className="rt-btn" onClick={() => void copyDocAddress()} title="复制文档地址（发给 agent）">
            ⧉ 地址
          </button>
          <button
            className={`rt-btn ${annPanelOpen ? 'active' : ''}`}
            onClick={toggleAnnPanel}
            title="批注面板"
          >
            💬 批注{openCount > 0 ? ` (${openCount})` : ''}
          </button>
        </div>
      </div>

      <div className="reader-body" ref={proseWrapRef} onMouseUp={onMouseUp}>
        {mode === 'edit' ? (
          <EditorPane />
        ) : isMd ? (
          <MarkdownView
            content={activeDoc.content}
            annotations={annotations}
            onSelectAnn={() => {
              if (!annPanelOpen) toggleAnnPanel()
            }}
          />
        ) : isHtml ? (
          <iframe className="html-view" sandbox="" srcDoc={activeDoc.content} title={activeDoc.path} />
        ) : (
          <pre className="txt-view">{activeDoc.content}</pre>
        )}

        {pop && mode === 'read' && isMd && (
          <button
            className="ann-pop"
            style={{ left: pop.x, top: pop.y }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={startCompose}
          >
            💬 添加批注
          </button>
        )}
      </div>
    </div>
  )
}
