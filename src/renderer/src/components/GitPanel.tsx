import { useCallback, useEffect, useState } from 'react'
import type { GitChange, GitStatus } from '@shared/types'
import { apiFor } from '../store'
import { useStore } from '../store'

/** 状态码 → 徽标文案与配色（模仿 VSCode） */
const CODE_LETTER: Record<string, string> = { M: 'M', A: 'A', D: 'D', R: 'R', U: 'U', '?': 'U' }
const CODE_CLASS: Record<string, string> = {
  M: 'git-m',
  A: 'git-a',
  D: 'git-d',
  R: 'git-r',
  U: 'git-u',
  '?': 'git-u'
}

function badge(code: string): { letter: string; cls: string } {
  const c = code && code !== ' ' ? code : '?'
  return { letter: CODE_LETTER[c] ?? '·', cls: CODE_CLASS[c] ?? 'git-u' }
}

const DOC_EXTS = ['.md', '.markdown', '.mdown', '.mkd', '.html', '.htm', '.txt']

function ChangeRow({
  change,
  code,
  onOpen,
  onStage,
  onUnstage,
  onDiscard
}: {
  change: GitChange
  code: string
  onOpen(): void
  onStage(): void
  onUnstage(): void
  onDiscard(): void
}) {
  const b = badge(code)
  const name = change.path.split('/').pop() ?? change.path
  const isDoc = DOC_EXTS.some((e) => name.toLowerCase().endsWith(e))
  return (
    <div className={`git-row ${isDoc ? 'clickable' : ''}`} onClick={isDoc ? onOpen : undefined} title={change.path}>
      <span className={`git-badge ${b.cls}`}>{b.letter}</span>
      <span className="git-name">{name}</span>
      <span className="git-ops" onClick={(e) => e.stopPropagation()}>
        <button title="暂存" onClick={onStage}>＋</button>
        <button title="取消暂存" onClick={onUnstage}>－</button>
        <button className="danger" title="丢弃改动" onClick={onDiscard}>↶</button>
      </span>
    </div>
  )
}

/** 侧栏 Git 页签：状态 / 暂存 / 丢弃 / 提交 / 拉推（模仿 VSCode 源代码管理） */
export default function GitPanel({ projectId }: { projectId: string }) {
  const { openDoc, toast } = useStore()
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setStatus(await apiFor<GitStatus>(projectId)('GET', `/api/projects/${projectId}/git/status`))
    } catch (err) {
      toast('err', `git 状态获取失败：${err}`)
    } finally {
      setLoading(false)
    }
  }, [projectId, toast])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 30_000)
    return () => clearInterval(t)
  }, [refresh])

  const run = async (label: string, fn: () => Promise<unknown>): Promise<boolean> => {
    if (busy) return false
    setBusy(true)
    try {
      await fn()
      await refresh()
      return true
    } catch (err) {
      toast('err', `${label}失败：${err}`)
      return false
    } finally {
      setBusy(false)
    }
  }

  const stage = (c: GitChange) =>
    run('暂存', () => apiFor(projectId)('POST', `/api/projects/${projectId}/git/add`, { paths: [c.path] }))
  const unstage = (c: GitChange) =>
    run('取消暂存', () => apiFor(projectId)('POST', `/api/projects/${projectId}/git/reset`, { paths: [c.path] }))
  const discard = (c: GitChange) => {
    if (!window.confirm(`丢弃「${c.path}」的改动？（未提交内容将无法恢复）`)) return
    void run('丢弃', () => apiFor(projectId)('POST', `/api/projects/${projectId}/git/discard`, { paths: [c.path] }))
  }
  const commit = async () => {
    const ok = await run('提交', () =>
      apiFor(projectId)('POST', `/api/projects/${projectId}/git/commit`, { message })
    )
    if (ok) setMessage('')
  }
  const sync = (op: 'pull' | 'push') =>
    run(op === 'pull' ? '拉取' : '推送', () =>
      apiFor(projectId)('POST', `/api/projects/${projectId}/git/sync`, { op })
    )

  if (status && !status.repo) {
    return (
      <div className="git-panel">
        <div className="sb-empty">
          {status.err ?? '当前项目不在 git 仓库中（未找到 .git）。'}
        </div>
      </div>
    )
  }

  const staged = (status?.changes ?? []).filter((c) => c.index !== ' ' && c.index !== '?')
  const unstaged = (status?.changes ?? []).filter(
    (c) => c.index === '?' || c.work !== ' '
  )

  return (
    <div className="git-panel">
      <div className="git-head">
        <span className="git-branch" title="当前分支">
          ⑂ {status?.branch || '…'}
          {status && status.ahead > 0 && <span className="git-ab"> ↑{status.ahead}</span>}
          {status && status.behind > 0 && <span className="git-ab"> ↓{status.behind}</span>}
        </span>
        <span className="git-head-ops">
          <button onClick={() => void refresh()} title="刷新" disabled={loading}>
            {loading ? '…' : '⟳'}
          </button>
          <button onClick={() => void sync('pull')} title="拉取 (pull --ff-only)" disabled={busy}>
            ↓
          </button>
          <button onClick={() => void sync('push')} title="推送 (push)" disabled={busy}>
            ↑
          </button>
        </span>
      </div>

      {(staged.length > 0 || unstaged.length > 0) && (
        <div className="git-list">
          {staged.length > 0 && <div className="git-group">已暂存（{staged.length}）</div>}
          {staged.map((c) => (
            <ChangeRow
              key={'s-' + c.path}
              change={c}
              code={c.index}
              onOpen={() => void openDoc(c.path)}
              onStage={() => void stage(c)}
              onUnstage={() => void unstage(c)}
              onDiscard={() => discard(c)}
            />
          ))}
          {unstaged.length > 0 && <div className="git-group">更改（{unstaged.length}）</div>}
          {unstaged.map((c) => (
            <ChangeRow
              key={'u-' + c.path}
              change={c}
              code={c.index === '?' ? '?' : c.work}
              onOpen={() => void openDoc(c.path)}
              onStage={() => void stage(c)}
              onUnstage={() => void unstage(c)}
              onDiscard={() => discard(c)}
            />
          ))}
        </div>
      )}

      {status && staged.length === 0 && unstaged.length === 0 && (
        <div className="sb-empty">工作区干净，没有待提交的更改。</div>
      )}

      <div className="git-commit">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && message.trim()) {
              e.preventDefault()
              void commit()
            }
          }}
          placeholder={`提交信息（${staged.length} 个已暂存，Ctrl+Enter 提交）`}
          rows={2}
          spellCheck={false}
        />
        <button
          className="btn-primary sm git-commit-btn"
          disabled={busy || !message.trim() || staged.length === 0}
          onClick={() => void commit()}
        >
          提交
        </button>
      </div>
    </div>
  )
}
