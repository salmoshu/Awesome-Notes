import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import MarkdownView, { selectionAnchor } from './MarkdownView'
import EditorPane from './EditorPane'
import Logo from './Logo'
import TabsBar from './TabsBar'
import FindBar from './FindBar'
import { scrollToEl } from '../utils/scroll'
import { rawBaseFor, origProjectId } from '../store'

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico']

/** 在 .prose 内查找关键词首个出现处，滚动并短暂高亮 */
function locateKeyword(keyword: string): boolean {
  const prose = document.querySelector('.prose')
  if (!prose) return false
  const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT)
  const needle = keyword.toLowerCase()
  let n = walker.nextNode() as Text | null
  while (n) {
    const idx = (n.nodeValue ?? '').toLowerCase().indexOf(needle)
    if (idx >= 0) {
      const mid = n.splitText(idx)
      mid.splitText(needle.length)
      const mark = document.createElement('mark')
      mark.className = 'search-hit'
      mid.parentNode?.replaceChild(mark, mid)
      mark.appendChild(mid)
      scrollToEl(mark, { center: true })
      setTimeout(() => {
        const parent = mark.parentNode
        if (!parent) return
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
        parent.removeChild(mark)
        parent.normalize?.()
      }, 2400)
      return true
    }
    n = walker.nextNode() as Text | null
  }
  return false
}

export default function Reader() {
  const {
    activeDoc,
    docLoading,
    mode,
    setMode,
    pendingLocate,
    dirty,
    saving,
    saveDoc,
    annotations,
    annPanelOpen,
    toggleAnnPanel,
    setComposeQuote,
    projects,
    activeProjectId,
    activeTabId,
    toast
  } = useStore()

  const proseWrapRef = useRef<HTMLDivElement>(null)
  const [pop, setPop] = useState<{ x: number; y: number; below?: boolean } | null>(null)
  const [rawBase, setRawBase] = useState('')
  const [findOpen, setFindOpen] = useState(false)

  // HTML 文档经 sidecar /raw 以真实 URL 加载（远程项目走远端 base）
  useEffect(() => {
    void rawBaseFor(activeProjectId).then(setRawBase)
  }, [activeProjectId])

  // Ctrl+F 打开文档内查找
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setFindOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 搜索结果跳转：文档渲染完成后滚动到关键词命中处
  useEffect(() => {
    if (!pendingLocate || !activeDoc || mode !== 'read') return
    if (pendingLocate.path !== activeDoc.path) return
    const kw = pendingLocate.keyword
    const t = setTimeout(() => {
      useStore.getState().setPendingLocate(null)
      if (!locateKeyword(kw)) {
        useStore.getState().toast('info', '已打开文档，但未能定位到关键词位置')
      }
    }, 350)
    return () => clearTimeout(t)
  }, [activeDoc, mode, pendingLocate])

  const openCount = annotations.filter((a) => a.status === 'open').length
  const isImage = activeDoc && IMAGE_EXTS.includes(activeDoc.ext)
  const isMd = activeDoc && ['md', 'markdown', 'mdown', 'mkd'].includes(activeDoc.ext)
  const isHtml = activeDoc && ['html', 'htm'].includes(activeDoc.ext)
  const project = projects.find((p) => p.id === activeProjectId)

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    // 双击用于块原位编辑（detail >= 2），不弹批注气泡
    if (e.detail > 1) {
      setPop(null)
      return
    }
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
    // 气泡挂在滚动容器内（position:absolute），需把视口坐标换算成内容坐标（补 scrollTop）
    const x = rect.left - wrapRect.left + rect.width / 2
    const aboveTop = rect.top - wrapRect.top
    const below = aboveTop < 48
    const y = below
      ? rect.bottom - wrapRect.top + wrap.scrollTop + 10
      : aboveTop + wrap.scrollTop - 10
    setPop({ x, y, below })
    ;(onMouseUp as unknown as { _anchor?: unknown })._anchor = anchor
  }, [])

  const startCompose = () => {
    const anchor = (onMouseUp as unknown as { _anchor?: { quote: string; prefix: string; suffix: string } })._anchor
    if (anchor) setComposeQuote(anchor)
    setPop(null)
    window.getSelection()?.removeAllRanges()
  }


  if (!activeDoc) {
    return (
      <div className="reader-empty">
        {docLoading ? (
          <div className="re-hint">读取中…</div>
        ) : (
          <>
            <Logo size={72} />
          </>
        )}
      </div>
    )
  }

  // 面包屑分段（VSCode 风格：目录 › 目录 › 文件）
  const crumbs = activeDoc.path.split('/')

  return (
    <div className="reader">
      <TabsBar>
        {(isMd || activeDoc.ext === 'txt') && (
          <div className="seg">
            <button className={mode === 'read' ? 'active' : ''} onClick={() => setMode('read')}>
              阅读
            </button>
            <button className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>
              原文{dirty ? ' •' : ''}
            </button>
          </div>
        )}
        {mode === 'edit' && (
          <button className="btn-save" disabled={!dirty || saving} onClick={() => void saveDoc()}>
            {saving ? '保存中…' : dirty ? '保存 (Ctrl+S)' : '已保存'}
          </button>
        )}
      </TabsBar>

      <div className="rt-breadcrumb" title={activeDoc.path}>
        {crumbs.map((c, i) => (
          <span key={i} className="crumb">
            {c}
            {i < crumbs.length - 1 && <span className="crumb-sep">›</span>}
          </span>
        ))}
      </div>

      {findOpen && <FindBar onClose={() => setFindOpen(false)} />}

      <div
        className="reader-body"
        ref={proseWrapRef}
        onMouseUp={onMouseUp}
      >
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
        ) : isImage ? (
          <div className="img-view-wrap">
            <img
              className="img-view"
              src={`${rawBase}/raw/${origProjectId(activeProjectId ?? '')}/${activeDoc.path
                .split('/')
                .map(encodeURIComponent)
                .join('/')}`}
              alt={activeDoc.path}
            />
          </div>
        ) : isHtml ? (
          rawBase && (
            <iframe
              className="html-view"
              sandbox="allow-scripts allow-forms allow-popups allow-same-origin allow-modals"
              src={`${rawBase}/raw/${origProjectId(activeProjectId ?? '')}/${activeDoc.path
                .split('/')
                .map(encodeURIComponent)
                .join('/')}`}
              title={activeDoc.path}
            />
          )
        ) : (
          <pre className="txt-view">{activeDoc.content}</pre>
        )}

        {pop && mode === 'read' && isMd && (
          <button
            className={`ann-pop ${pop.below ? 'below' : ''}`}
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
