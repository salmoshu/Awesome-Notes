import { useCallback, useEffect, useRef, useState } from 'react'
import { scrollToEl } from '../utils/scroll'

interface Props {
  onClose(): void
}

/**
 * 文档内查找（Ctrl+F，模仿 VSCode 查找小部件）：
 * 高亮阅读区（Markdown 正文 / TXT）全部匹配，Enter/Shift+Enter 上下导航。
 * 编辑区不参与：编辑器自行管理 DOM，外部插入高亮会破坏内容与 Markdown 的同步。
 */
export default function FindBar({ onClose }: Props) {
  const [query, setQuery] = useState('')
  const [count, setCount] = useState(0)
  const [current, setCurrent] = useState(-1)
  const marksRef = useRef<HTMLElement[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const clearMarks = useCallback((): void => {
    for (const mark of marksRef.current) {
      const parent = mark.parentNode
      if (!parent) continue
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
      parent.removeChild(mark)
      parent.normalize?.()
    }
    marksRef.current = []
  }, [])

  const search = useCallback(
    (q: string): void => {
      clearMarks()
      if (!q) {
        setCount(0)
        setCurrent(-1)
        return
      }
      const container = document.querySelector('.reader-body')
      if (!container) return
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) =>
          n.parentElement?.closest('button, .find-bar, mark.find-hit, .editor-pane') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
      })
      const needle = q.toLowerCase()
      const marks: HTMLElement[] = []
      let n = walker.nextNode() as Text | null
      while (n) {
        const idx = (n.nodeValue ?? '').toLowerCase().indexOf(needle)
        if (idx >= 0 && n.parentElement) {
          const mid = n.splitText(idx)
          mid.splitText(needle.length)
          const mark = document.createElement('mark')
          mark.className = 'find-hit'
          mid.parentNode?.replaceChild(mark, mid)
          mark.appendChild(mid)
          marks.push(mark)
          // 同一文本节点只标第一个匹配，继续走后面的节点
          n = walker.nextNode() as Text | null
          continue
        }
        n = walker.nextNode() as Text | null
      }
      marksRef.current = marks
      setCount(marks.length)
      setCurrent(marks.length > 0 ? 0 : -1)
      if (marks[0]) {
        marks[0].classList.add('current')
        scrollToEl(marks[0], { center: true })
      }
    },
    [clearMarks]
  )

  const nav = useCallback(
    (dir: 1 | -1): void => {
      const marks = marksRef.current
      if (marks.length === 0) return
      const next = current < 0 ? 0 : (current + dir + marks.length) % marks.length
      marks.forEach((m, i) => m.classList.toggle('current', i === next))
      scrollToEl(marks[next], { center: true })
      setCurrent(next)
    },
    [current]
  )

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // 关闭时清理高亮
  useEffect(() => clearMarks, [clearMarks])

  // 输入防抖搜索
  useEffect(() => {
    const t = setTimeout(() => search(query.trim()), 200)
    return () => clearTimeout(t)
  }, [query, search])

  return (
    <div className="find-bar">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            nav(e.shiftKey ? -1 : 1)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
        placeholder="查找…"
        spellCheck={false}
      />
      <span className="fb-count">{count > 0 ? `${current + 1}/${count}` : query ? '无结果' : ''}</span>
      <button className="fb-btn" onClick={() => nav(-1)} title="上一个 (Shift+Enter)">↑</button>
      <button className="fb-btn" onClick={() => nav(1)} title="下一个 (Enter)">↓</button>
      <button className="fb-btn" onClick={onClose} title="关闭 (Esc)">✕</button>
    </div>
  )
}
