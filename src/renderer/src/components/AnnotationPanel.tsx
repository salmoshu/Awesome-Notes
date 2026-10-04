import { useState } from 'react'
import { useStore } from '../store'
import type { Annotation } from '@shared/types'

function fmtTime(s: string): string {
  try {
    const d = new Date(s)
    return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return s
  }
}

export default function AnnotationPanel() {
  const {
    annotations,
    composeQuote,
    setComposeQuote,
    createAnnotation,
    setAnnStatus,
    deleteAnnotation,
    activeDoc,
    projects,
    activeProjectId,
    toast
  } = useStore()
  const [draft, setDraft] = useState('')
  const [locating, setLocating] = useState<string | null>(null)

  const project = projects.find((p) => p.id === activeProjectId)

  const copyAnnAddress = async (a: Annotation) => {
    if (!project) return
    const absDoc = `${project.path}\\${a.doc.replace(/\//g, '\\')}`
    const annFile = `${project.path}\\.awesome-notes\\annotations.json`
    const text = [
      '[Awesome-Notes 批注任务]',
      `链接: awesome-notes://${project.name}/${a.doc}#${a.id}`,
      `文档: ${absDoc}`,
      `批注库: ${annFile}`,
      `批注ID: ${a.id}`,
      `引用: ${a.quote}`,
      `要求: ${a.text}`
    ].join('\n')
    await navigator.clipboard.writeText(text)
    toast('ok', '批注地址已复制，可发给 agent 执行')
  }

  const locate = (a: Annotation) => {
    const el = document.querySelector(`mark.ann-mark[data-ann-id="${a.id}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('flash')
      setTimeout(() => el.classList.remove('flash'), 1600)
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
        <span>批注</span>
        <span className="ap-count">
          {open.length} 待处理 · {done.length} 已完成
        </span>
      </div>

      {composeQuote && (
        <div className="ap-compose">
          <div className="ap-quote" title={composeQuote.quote}>
            “{composeQuote.quote.length > 90 ? composeQuote.quote.slice(0, 90) + '…' : composeQuote.quote}”
          </div>
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="批注内容：告诉 agent 要做什么修改…"
            rows={3}
          />
          <div className="ap-compose-ops">
            <button
              className="btn-primary sm"
              disabled={!draft.trim()}
              onClick={() => {
                void createAnnotation(draft.trim())
                setDraft('')
              }}
            >
              保存批注
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
            本文档暂无批注。
            <br />
            在阅读模式下选中文字即可添加。
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
            <div className="ap-card-text">{a.text}</div>
            <div className="ap-card-meta">
              <span className={`ap-status ${a.status}`}>{a.status === 'open' ? '待处理' : '已完成'}</span>
              <span className="ap-time">{fmtTime(a.updatedAt)}</span>
            </div>
            <div className="ap-card-ops">
              <button onClick={() => locate(a)} title="在正文中定位">◎ 定位</button>
              <button onClick={() => void copyAnnAddress(a)} title="复制批注地址（发给 agent）">
                ⧉ 地址
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
                  if (window.confirm('删除这条批注？')) void deleteAnnotation(a)
                }}
                title="删除"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
