import { useEffect, useState } from 'react'
import { useStore } from '../store'
import {
  buildTocFromSource,
  scrollToHeading,
  scrollToSourceHeading,
  type TocEntry
} from './AnnotationPanel'

interface Tick extends TocEntry {
  /** 章节在全文滚动高度中的位置比例（0–1） */
  ratio: number
}

/** 全屏专注模式右侧的「钢琴条」：每个刻度对应一个章节在全文中的位置，
 *  悬浮显示章节名、点击跳转；底部把手展开目录 / 批注浮层或退出全屏。 */
export default function PianoRail() {
  const activeDoc = useStore((s) => s.activeDoc)
  const mode = useStore((s) => s.mode)
  const draft = useStore((s) => s.draft)
  const annotations = useStore((s) => s.annotations)
  const zenPanel = useStore((s) => s.zenPanel)
  const setZenPanel = useStore((s) => s.setZenPanel)
  const setZenMode = useStore((s) => s.setZenMode)
  const [ticks, setTicks] = useState<Tick[]>([])

  const isMd = !!activeDoc && ['md', 'markdown', 'mdown', 'mkd'].includes(activeDoc.ext)

  useEffect(() => {
    if (!isMd) {
      setTicks([])
      return
    }
    let dead = false
    const compute = (): void => {
      if (dead) return
      const body = document.querySelector<HTMLElement>('.reader-body')
      if (!body) return
      const total = body.scrollHeight
      if (total <= 0) return
      if (mode === 'source') {
        // 源码模式：编辑器随内容自增高，按行号折算位置比例
        const ta = document.querySelector<HTMLTextAreaElement>('.editor-plain')
        if (!ta) return
        const lineHeight = Number.parseFloat(getComputedStyle(ta).lineHeight) || 24
        const padTop = Number.parseFloat(getComputedStyle(ta).paddingTop) || 0
        const taTop = ta.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop
        setTicks(
          buildTocFromSource(draft).map((t) => ({
            ...t,
            ratio: (taTop + padTop + (t.line ?? 0) * lineHeight) / total
          }))
        )
        return
      }
      const prose = document.querySelector('.prose')
      if (!prose) return
      const bodyTop = body.getBoundingClientRect().top
      setTicks(
        [...prose.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((el) => ({
          level: Number(el.tagName.slice(1)),
          text: (el.textContent ?? '').trim(),
          ratio: (el.getBoundingClientRect().top - bodyTop + body.scrollTop) / total
        }))
      )
    }
    compute()
    // Vditor 异步初始化 / 图表渲染撑高正文后重算
    const t = window.setTimeout(compute, 400)
    window.addEventListener('markdown-rendered', compute)
    window.addEventListener('resize', compute)
    const body = document.querySelector('.reader-body')
    const ro = new ResizeObserver(compute)
    if (body) ro.observe(body)
    return () => {
      dead = true
      window.clearTimeout(t)
      window.removeEventListener('markdown-rendered', compute)
      window.removeEventListener('resize', compute)
      ro.disconnect()
    }
  }, [isMd, mode, activeDoc?.path, draft])

  const jump = (tick: Tick): void => {
    if (mode === 'source') scrollToSourceHeading(tick)
    else scrollToHeading(tick)
  }

  const togglePanel = (p: 'toc' | 'ann'): void => setZenPanel(zenPanel === p ? null : p)

  return (
    <div className="piano-rail">
      {isMd && (
        <div className="pr-ticks">
          {ticks.map((t, i) => (
            <button
              key={i}
              className={`pr-tick lv${t.level}`}
              style={{ top: `${Math.min(99, Math.max(0.5, t.ratio * 100))}%` }}
              title={t.text || '(无标题)'}
              aria-label={`跳转到：${t.text}`}
              onClick={() => jump(t)}
            />
          ))}
        </div>
      )}
      <div className="pr-ops">
        {isMd && (
          <button
            className={zenPanel === 'toc' ? 'active' : ''}
            onClick={() => togglePanel('toc')}
            title="目录"
          >
            目
          </button>
        )}
        <button
          className={zenPanel === 'ann' ? 'active' : ''}
          onClick={() => togglePanel('ann')}
          title={annotations.length ? `批注（${annotations.length} 条）` : '批注'}
        >
          注
          {annotations.length > 0 && <span className="pr-badge">{annotations.length}</span>}
        </button>
        <button onClick={() => setZenMode(false)} title="退出全屏专注 (Esc)">
          ×
        </button>
      </div>
    </div>
  )
}
