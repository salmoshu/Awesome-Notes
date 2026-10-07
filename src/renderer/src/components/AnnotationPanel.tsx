import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { ANNOTATION_KIND_LABELS, type Annotation, type AnnotationKind, type DocContent } from '@shared/types'
import { scrollToEl } from '../utils/scroll'
import { findAnnotationRange, scrollToRange, setTextHighlight } from '../utils/textRanges'

function fmtTime(s: string): string {
  try {
    const d = new Date(s)
    return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return s
  }
}

function kindOf(a: Annotation): AnnotationKind {
  return a.kind ?? 'annotation'
}

interface TocEntry {
  level: number
  text: string
  /** 编辑（原文）模式：标题在源码中的行号（0 起） */
  line?: number
}

/** 从已渲染的 .prose 提取标题目录（阅读模式） */
function buildToc(): TocEntry[] {
  const prose = document.querySelector('.prose')
  if (!prose) return []
  return [...prose.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((el) => ({
    level: Number(el.tagName.slice(1)),
    text: (el.textContent ?? '').trim()
  }))
}

/** 从 Markdown 源码提取标题目录（编辑模式）：标题行 #.. 逐行扫描，
 *  代码围栏内的 # 不算标题 */
function buildTocFromSource(src: string): TocEntry[] {
  const out: TocEntry[] = []
  let fence = false
  src.split('\n').forEach((raw, line) => {
    if (/^\s*(```|~~~)/.test(raw)) fence = !fence
    if (fence) return
    const m = /^(#{1,6})\s+(.*)$/.exec(raw)
    if (m) out.push({ level: m[1].length, text: m[2].trim(), line })
  })
  return out
}

/** 点击目录项时现查标题节点（避免持有被重渲染替换的旧引用），滚动并返回元素 */
function scrollToHeading(entry: TocEntry): Element | null {
  const prose = document.querySelector('.prose')
  if (!prose) return null
  const el = [...prose.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(
    (h) => Number(h.tagName.slice(1)) === entry.level && (h.textContent ?? '').trim() === entry.text
  )
  if (!el) return null
  scrollToEl(el)
  return el
}

/** 编辑模式：把源码编辑器滚动到标题行并选中该行（textarea 内的定位跳转） */
function scrollToSourceHeading(entry: TocEntry): boolean {
  const textarea = document.querySelector<HTMLTextAreaElement>('.editor-plain')
  if (!textarea || entry.line === undefined) return false
  const lines = textarea.value.split('\n')
  let start = 0
  for (let i = 0; i < entry.line; i++) start += lines[i].length + 1
  const end = start + (lines[entry.line]?.length ?? 0)
  textarea.focus()
  textarea.setSelectionRange(start, end)
  const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 24
  textarea.scrollTop = Math.max(0, entry.line * lineHeight - textarea.clientHeight / 3)
  return true
}

/** 编辑模式：在源码中定位批注引用文本，选中并滚动 */
function locateInSource(quote: string): boolean {
  const textarea = document.querySelector<HTMLTextAreaElement>('.editor-plain')
  if (!textarea) return false
  const idx = textarea.value.indexOf(quote)
  if (idx < 0) return false
  textarea.focus()
  textarea.setSelectionRange(idx, idx + quote.length)
  const before = textarea.value.slice(0, idx)
  const line = before.split('\n').length - 1
  const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 24
  textarea.scrollTop = Math.max(0, line * lineHeight - textarea.clientHeight / 3)
  return true
}

function TocView({ activeDoc, mode }: { activeDoc: DocContent | null; mode: string }) {
  const draft = useStore((s) => s.draft)
  const [toc, setToc] = useState<TocEntry[]>([])
  const [activeText, setActiveText] = useState('')

  // 阅读模式：文档/模式变化后重建；正文直接编辑或异步初始化后实时更新目录。
  // （编辑模式由下方源码提取 effect 负责，这里若不跳过，60ms 后会把源码目录清空）
  useEffect(() => {
    if (mode === 'source') return
    const t = setTimeout(() => setToc(buildToc()), 60)
    const refresh = (): void => setToc(buildToc())
    window.addEventListener('markdown-rendered', refresh)
    return () => {
      clearTimeout(t)
      window.removeEventListener('markdown-rendered', refresh)
    }
  }, [activeDoc?.path, activeDoc?.content, mode])

  useEffect(() => {
    if (mode === 'source') setToc(buildTocFromSource(draft))
  }, [mode, draft, activeDoc?.path])

  // 滚动时高亮当前所在章节（阅读模式取视口内最后一个标题；编辑模式按行号推算）
  useEffect(() => {
    const body = document.querySelector('.reader-body')
    if (!body || toc.length === 0) return
    const onScroll = (): void => {
      if (mode === 'source') {
        const textarea = document.querySelector<HTMLTextAreaElement>('.editor-plain')
        if (!textarea) return
        const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 24
        const cur = Math.floor((textarea.scrollTop + textarea.clientHeight / 2) / lineHeight)
        let current = ''
        for (const h of toc) {
          if (h.line !== undefined && h.line <= cur) current = h.text
        }
        setActiveText(current)
        return
      }
      const headings = document.querySelectorAll('.prose h1,.prose h2,.prose h3,.prose h4,.prose h5,.prose h6')
      const line = body.getBoundingClientRect().top + 80
      let current = ''
      for (const h of headings) {
        if (h.getBoundingClientRect().top <= line) current = (h.textContent ?? '').trim()
        else break
      }
      setActiveText(current)
    }
    const target = mode === 'source' ? document.querySelector('.editor-plain') : body
    target?.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => target?.removeEventListener('scroll', onScroll)
  }, [toc, mode])

  if (toc.length === 0) {
    return <div className="ap-empty">当前文档没有可用的标题目录。</div>
  }

  return (
    <div className="toc-list">
      {toc.map((h, i) => (
        <button
          key={i}
          className={`toc-item lv${h.level} ${activeText === h.text ? 'active' : ''}`}
          style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
          title={h.text}
          onClick={() => {
            if (mode === 'source') scrollToSourceHeading(h)
            else scrollToHeading(h)
            setActiveText(h.text)
          }}
        >
          {h.text || '(无标题)'}
        </button>
      ))}
    </div>
  )
}

export default function AnnotationPanel() {
  const {
    annotations,
    composeQuote,
    setComposeQuote,
    createAnnotation,
    setAnnStatus,
    editAnnotation,
    deleteAnnotation,
    activeDoc,
    projects,
    activeProjectId,
    toast,
    mode
  } = useStore()
  const [draft, setDraft] = useState('')
  const [kind, setKind] = useState<AnnotationKind>('annotation')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [locating, setLocating] = useState<string | null>(null)
  // 面板页签随文档标签记忆（默认目录）；划词批注时自动切回标注
  const storedPanel = useStore((st) => st.tabs.find((t) => t.id === st.activeTabId)?.panel)
  const [tab, setTab] = useState<'toc' | 'ann'>(storedPanel ?? 'toc')

  // 标签类型可直接从右侧侧边栏选择历史标签（当前文档用过的）
  const knownTags = useMemo(
    () => [...new Set(annotations.filter((a) => kindOf(a) === 'tag').map((a) => a.text.trim()).filter(Boolean))],
    [annotations]
  )

  useEffect(() => {
    if (storedPanel) setTab(storedPanel)
  }, [storedPanel])

  const switchTab = (next: 'toc' | 'ann'): void => {
    setTab(next)
    useStore.getState().patchActiveTab({ panel: next })
  }

  useEffect(() => {
    if (composeQuote) switchTab('ann')
  }, [composeQuote])

  /** 批量复制：当前文档全部标注（格式化，可直接交给 agent） */
  const copyAllAnnotations = async (): Promise<void> => {
    if (!project || annotations.length === 0) return
    const annFile = `${project.path}\\.awesome-notes\\annotations.json`
    const body = annotations
      .map((a, i) =>
        [
          `## 标注 ${i + 1}（${ANNOTATION_KIND_LABELS[kindOf(a)]} · ${a.status === 'open' ? '待处理' : '已完成'}）`,
          `链接: awesome-notes://${project.name}/${a.doc}#${a.id}`,
          `文档: ${project.path}\\${a.doc.replace(/\//g, '\\')}`,
          `标注ID: ${a.id}`,
          `引用: ${a.quote}`,
          `内容: ${a.text}`
        ].join('\n')
      )
      .join('\n\n')
    const text = [
      `[Awesome-Notes 标注任务 · ${project.name} / ${activeDoc?.path ?? ''} · 共 ${annotations.length} 条]`,
      `标注库: ${annFile}`,
      '',
      body
    ].join('\n')
    await navigator.clipboard.writeText(text)
    toast('ok', `已复制 ${annotations.length} 条标注（可整体发给 agent）`)
  }

  const copyAnnFileAddress = async (): Promise<void> => {
    if (!project) return
    const annFile = `${project.path}\\.awesome-notes\\annotations.json`
    await navigator.clipboard.writeText(annFile)
    toast('ok', '标注库地址已复制')
  }

  const project = projects.find((p) => p.id === activeProjectId)

  const copyAnnAddress = async (a: Annotation) => {
    if (!project) return
    const absDoc = `${project.path}\\${a.doc.replace(/\//g, '\\')}`
    const annFile = `${project.path}\\.awesome-notes\\annotations.json`
    const text = [
      '[Awesome-Notes 标注任务]',
      `链接: awesome-notes://${project.name}/${a.doc}#${a.id}`,
      `文档: ${absDoc}`,
      `标注库: ${annFile}`,
      `标注ID: ${a.id}`,
      `类型: ${ANNOTATION_KIND_LABELS[kindOf(a)]}`,
      `引用: ${a.quote}`,
      `内容: ${a.text}`
    ].join('\n')
    await navigator.clipboard.writeText(text)
    toast('ok', '标注地址已复制，可发给 agent 执行')
  }

  const locate = (a: Annotation) => {
    // 编辑模式：源码 textarea 内定位引用文本（目录/批注在原文模式同样可用）
    if (mode === 'source') {
      if (locateInSource(a.quote)) {
        setLocating(a.id)
        setTimeout(() => setLocating(null), 1600)
      } else {
        toast('info', '未能在源码中定位引用（文档可能已编辑）')
      }
      return
    }
    const prose = document.querySelector<HTMLElement>('.prose')
    const range = prose && findAnnotationRange(prose, a)
    if (range) {
      scrollToRange(range)
      setTextHighlight('ann-flash', [range])
      setTimeout(() => setTextHighlight('ann-flash', []), 1600)
      setLocating(a.id)
      setTimeout(() => setLocating(null), 1600)
    } else {
      toast('info', '未能在正文中定位锚点（文档可能已编辑）')
    }
  }

  const open = annotations.filter((a) => a.status === 'open')
  const done = annotations.filter((a) => a.status === 'done')

  return (
    <aside className="ann-panel">
      <div className="ap-head">
        <div className="ap-tabs">
          <button className={tab === 'toc' ? 'active' : ''} onClick={() => switchTab('toc')}>
            目录
          </button>
          <button className={tab === 'ann' ? 'active' : ''} onClick={() => switchTab('ann')}>
            标注 {annotations.length > 0 ? `(${annotations.length})` : ''}
          </button>
        </div>
        {tab === 'ann' && (
          <span className="ap-count">
            {open.length} 待处理 · {done.length} 已完成
          </span>
        )}
      </div>

      {tab === 'toc' && (
        <div className="ap-body">
          <TocView activeDoc={activeDoc} mode={mode} />
        </div>
      )}

      {tab === 'ann' && (
        <div className="ap-body">
          {annotations.length > 0 && (
            <div className="ap-batch-ops">
              <button onClick={() => void copyAllAnnotations()} title="复制当前文档全部标注（整体发给 agent）">
                ⧉ 复制全部标注
              </button>
              <button onClick={() => void copyAnnFileAddress()} title="复制标注库文件地址">
                ▤ 标注库地址
              </button>
            </div>
          )}
          {composeQuote && (
            <div className="ap-compose">
              <div className="ap-quote" title={composeQuote.quote}>
                “{composeQuote.quote.length > 90 ? composeQuote.quote.slice(0, 90) + '…' : composeQuote.quote}”
              </div>
              <div className="ap-kinds">
                {(['tag', 'note', 'annotation'] as const).map((k) => (
                  <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
                    {ANNOTATION_KIND_LABELS[k]}
                  </button>
                ))}
              </div>
              {kind === 'tag' && knownTags.length > 0 && (
                <div className="ap-tags">
                  {knownTags.map((t) => (
                    <button
                      key={t}
                      className="ap-tag-chip"
                      title="点击用该标签标注选中文字"
                      onClick={() => {
                        void createAnnotation(t, 'tag')
                        setDraft('')
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
              <textarea
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={
                  kind === 'tag'
                    ? '标签名（可直接点上方历史标签）…'
                    : kind === 'note'
                      ? '笔记：记录你的思考与备忘…'
                      : '批注内容：告诉 agent 要做什么修改…'
                }
                rows={kind === 'tag' ? 1 : 3}
              />
              <div className="ap-compose-ops">
                <button
                  className="btn-primary sm"
                  disabled={!draft.trim()}
                  onClick={() => {
                    void createAnnotation(draft.trim(), kind)
                    setDraft('')
                  }}
                >
                  保存{ANNOTATION_KIND_LABELS[kind]}
                </button>
                <button className="btn-ghost sm" onClick={() => setComposeQuote(null)}>
                  取消
                </button>
              </div>
            </div>
          )}

          <div className="ap-list">
          {annotations.length === 0 && !composeQuote && (
            <div className="ap-empty">
              本文档暂无标注。
              <br />
              选中正文或源码中的文字即可添加标签 / 笔记 / 批注。
            </div>
          )}
        {annotations.map((a) => (
          <div
            key={a.id}
            className={`ap-card ${a.status} ${locating === a.id ? 'locating' : ''}`}
            id={`ap-${a.id}`}
          >
            <div className="ap-card-quote" title={a.quote}>
              “{a.quote.length > 70 ? a.quote.slice(0, 70) + '…' : a.quote}”
            </div>
            {editing?.id === a.id ? (
              <div className="ap-edit">
                <textarea
                  autoFocus
                  rows={3}
                  value={editing.text}
                  onChange={(e) => setEditing({ id: a.id, text: e.target.value })}
                  spellCheck={false}
                />
                <div className="ap-card-ops">
                  <button
                    disabled={!editing.text.trim()}
                    onClick={() => {
                      void editAnnotation(a, editing.text.trim())
                      setEditing(null)
                    }}
                    title="保存修改"
                  >
                    ✓ 保存
                  </button>
                  <button onClick={() => setEditing(null)} title="放弃修改">
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <div className="ap-card-text">{a.text}</div>
            )}
            <div className="ap-card-meta">
              <span className={`ap-kind ${kindOf(a)}`}>
                {kindOf(a) === 'tag' ? '🏷 ' : kindOf(a) === 'note' ? '📝 ' : ''}{ANNOTATION_KIND_LABELS[kindOf(a)]}
              </span>
              <span className={`ap-status ${a.status}`}>{a.status === 'open' ? '待处理' : '已完成'}</span>
              <span className="ap-time">{fmtTime(a.updatedAt)}</span>
            </div>
            {editing?.id !== a.id && (
              <div className="ap-card-ops">
                <button onClick={() => locate(a)} title="在正文中定位">◎ 定位</button>
                <button onClick={() => void copyAnnAddress(a)} title="复制标注地址（发给 agent）">
                  ⧉ 地址
                </button>
                <button onClick={() => setEditing({ id: a.id, text: a.text })} title="编辑标注内容">
                  ✎ 编辑
                </button>
                <button
                  onClick={() => void setAnnStatus(a, a.status === 'open' ? 'done' : 'open')}
                  title="切换状态"
                >
                  {a.status === 'open' ? '✓ 完成' : '↺ 重开'}
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    if (window.confirm('删除这条标注？')) void deleteAnnotation(a)
                  }}
                  title="删除"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        ))}
          </div>
        </div>
      )}
    </aside>
  )
}
