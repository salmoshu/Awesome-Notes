import { useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useStore } from '../store'
import type { DocNode, Project } from '@shared/types'
import ContextMenu, { type MenuItem } from './ContextMenu'
import GitPanel from './GitPanel'
import SearchPanel from './SearchPanel'
import {
  blockPath,
  hiddenProjectIds,
  hideProject,
  isBlocked,
  isExactBlocked,
  projectAlias,
  setProjectAlias,
  unblockPath,
  unhideProject
} from '../utils/local-store'

type TreeTab = 'docs' | 'search' | 'git'

function extIcon(ext?: string): string {
  switch (ext) {
    case '.md':
    case '.markdown':
    case '.mdown':
    case '.mkd':
      return 'M↓'
    case '.html':
    case '.htm':
      return '<>'
    default:
      return '≡'
  }
}

function extClass(ext?: string): string {
  if (ext === '.md' || ext === '.markdown' || ext === '.mdown' || ext === '.mkd') return 'ext-md'
  if (ext === '.html' || ext === '.htm') return 'ext-html'
  return 'ext-txt'
}

function matchFilter(node: DocNode, f: string): boolean {
  if (!f) return true
  if (node.name.toLowerCase().includes(f)) return true
  return (node.children ?? []).some((c) => matchFilter(c, f))
}

interface TreeCtx {
  projectId: string
  onMenu(e: ReactMouseEvent, node: DocNode, exactBlocked: boolean): void
}

function TreeNode({ node, depth, ctx }: { node: DocNode; depth: number; ctx: TreeCtx }) {
  const { activeDoc, openDoc, filter } = useStore()
  // 默认全部折叠，由用户自行展开
  const [open, setOpen] = useState(false)
  const f = filter.trim().toLowerCase()
  if (!matchFilter(node, f)) return null

  const blocked = isBlocked(ctx.projectId, node.path)
  const exactBlocked = isExactBlocked(ctx.projectId, node.path)

  if (node.type === 'doc') {
    const active = activeDoc?.path === node.path
    return (
      <button
        className={`tree-doc ${active ? 'active' : ''} ${blocked ? 'blocked' : ''}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => {
          if (blocked) return
          void openDoc(node.path)
        }}
        onContextMenu={(e) => ctx.onMenu(e, node, exactBlocked)}
        title={node.path}
      >
        <span className={`doc-icon ${extClass(node.ext)}`}>{extIcon(node.ext)}</span>
        <span className="doc-name">{node.name}</span>
      </button>
    )
  }

  return (
    <div>
      <button
        className={`tree-dir ${blocked ? 'blocked' : ''}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => {
          if (blocked) return
          setOpen(!open)
        }}
        onContextMenu={(e) => ctx.onMenu(e, node, exactBlocked)}
      >
        <span className={`dir-arrow ${open && !blocked ? 'open' : ''}`}>▸</span>
        <span className="dir-name">{node.name}</span>
        <span className="dir-count">{countDocs(node)}</span>
      </button>
      {open && !blocked && node.children?.map((c) => (
        <TreeNode key={c.path} node={c} depth={depth + 1} ctx={ctx} />
      ))}
    </div>
  )
}

function countDocs(node: DocNode): number {
  if (node.type === 'doc') return 1
  return (node.children ?? []).reduce((acc, c) => acc + countDocs(c), 0)
}

export default function Sidebar() {
  const {
    projects,
    activeProjectId,
    selectProject,
    removeProject,
    importProject,
    rescan,
    tree,
    treeLoading,
    filter,
    setFilter,
    toast
  } = useStore()

  const [projCollapsed, setProjCollapsed] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [tab, setTab] = useState<TreeTab>('docs')
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [storeRev, setStoreRev] = useState(0) // 别名/屏蔽变更后强制重渲染
  const bump = () => setStoreRev((v) => v + 1)

  const active = useMemo(
    () => projects.find((p) => p.id === activeProjectId),
    [projects, activeProjectId]
  )
  const hiddenIds = useMemo(() => hiddenProjectIds(), [storeRev])
  const displayName = (p: Project) => projectAlias(p.id) ?? p.name

  const onImport = async () => {
    if (window.awesomeNotes) {
      const path = await window.awesomeNotes.selectFolder()
      if (path) await importProject(path)
    } else {
      const path = window.prompt('纯 Web 预览模式：请输入项目目录的绝对路径')
      if (path) await importProject(path)
    }
  }

  const onRemove = async (p: Project) => {
    if (window.confirm(`确定从列表移除「${displayName(p)}」？（不会删除磁盘文件）`)) {
      await removeProject(p.id)
    }
  }

  const onRename = (p: Project) => {
    const next = window.prompt('项目显示名称（留空恢复默认）', displayName(p))
    if (next === null) return
    setProjectAlias(p.id, next.trim() === '' ? null : next.trim())
    bump()
    toast('ok', next.trim() === '' ? '已恢复默认名称' : '已更名（仅本机显示）')
  }

  const projectMenu = (e: ReactMouseEvent, p: Project): void => {
    e.preventDefault()
    const hidden = hiddenIds.includes(p.id)
    const items: MenuItem[] = [
      { key: 'open', label: '打开项目', onClick: () => void selectProject(p.id) },
      { key: 'rename', label: '重命名…', onClick: () => onRename(p) },
      {
        key: 'abs',
        label: '复制绝对路径',
        onClick: () => {
          navigator.clipboard.writeText(p.path)
          toast('ok', '绝对路径已复制')
        }
      },
      {
        key: 'rel',
        label: '复制相对路径（文件夹名）',
        onClick: () => {
          navigator.clipboard.writeText(p.name)
          toast('ok', '相对路径已复制')
        }
      },
      {
        key: 'hide',
        label: hidden ? '取消屏蔽' : '屏蔽（从列表隐藏）',
        separatorBefore: true,
        onClick: () => {
          if (hidden) {
            unhideProject(p.id)
            bump()
            return
          }
          if (p.id === activeProjectId) {
            toast('info', '当前项目使用中，请先切换到其他项目再屏蔽')
            return
          }
          hideProject(p.id)
          bump()
        }
      },
      {
        key: 'remove',
        label: '从列表移除…',
        danger: true,
        onClick: () => void onRemove(p)
      }
    ]
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  const treeMenu = (e: ReactMouseEvent, node: DocNode, exactBlocked: boolean): void => {
    e.preventDefault()
    if (!active) return
    const abs = `${active.path}\\${node.path.replace(/\//g, '\\')}`
    const items: MenuItem[] = []
    if (node.type === 'doc') {
      items.push({
        key: 'open',
        label: '打开文档',
        onClick: () => void useStore.getState().openDoc(node.path)
      })
    }
    items.push({
      key: 'reldoc',
      label: '复制相对路径',
      onClick: () => {
        navigator.clipboard.writeText(node.path)
        toast('ok', '相对路径已复制')
      }
    })
    items.push({
      key: 'absdoc',
      label: '复制绝对路径',
      onClick: () => {
        navigator.clipboard.writeText(abs)
        toast('ok', '绝对路径已复制')
      }
    })
    items.push({
      key: 'block',
      label: exactBlocked ? '取消屏蔽' : '屏蔽',
      danger: !exactBlocked,
      separatorBefore: true,
      onClick: () => {
        if (exactBlocked) {
          unblockPath(active.id, node.path)
          toast('ok', `已取消屏蔽「${node.name}」`)
        } else {
          blockPath(active.id, node.path)
          toast('ok', `已屏蔽「${node.name}」`)
        }
        bump()
      }
    })
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  const visibleProjects = projects.filter((p) => showHidden || !hiddenIds.includes(p.id))
  const hiddenCount = projects.filter((p) => hiddenIds.includes(p.id)).length

  return (
    <aside className="sidebar">
      <div className="sb-projects">
        <button className="sb-proj-toggle" onClick={() => setProjCollapsed(!projCollapsed)}>
          <span className={`dir-arrow ${!projCollapsed ? 'open' : ''}`}>▸</span>
          项目（{visibleProjects.length}）
          {hiddenCount > 0 && (
            <span
              className="sb-hidden-count"
              title="显示/隐藏被屏蔽的项目"
              onClick={(e) => {
                e.stopPropagation()
                setShowHidden(!showHidden)
              }}
            >
              屏蔽 {hiddenCount}
            </span>
          )}
        </button>
        {!projCollapsed && (
          <div className="sb-proj-list">
            {projects.length === 0 && (
              <div className="sb-empty">
                还没有项目。
                <br />
                导入一个包含 Markdown / HTML 文档的目录开始阅读。
              </div>
            )}
            {visibleProjects.map((p) => {
              const hidden = hiddenIds.includes(p.id)
              return (
                <button
                  key={p.id}
                  className={`proj-item ${p.id === activeProjectId ? 'active' : ''} ${hidden ? 'blocked' : ''}`}
                  onClick={() => void selectProject(p.id)}
                  onContextMenu={(e) => projectMenu(e, p)}
                  title={`${displayName(p)}\n${p.path}\n（右键：更名/屏蔽/复制路径/移除）`}
                >
                  <span className="proj-name">{displayName(p)}</span>
                  <span className="proj-count">{p.docCount} 篇</span>
                </button>
              )
            })}
            <button className="proj-import" onClick={() => void onImport()}>
              ＋ 导入项目
            </button>
          </div>
        )}
      </div>

      {active && (
        <>
          <div className="sb-proj-head">
            <div className="sb-proj-name" title={active.path}>
              {displayName(active)}
            </div>
            <div className="sb-proj-ops">
              <button onClick={() => void rescan()} title="重新扫描文档">⟳</button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(active.path)
                  toast('ok', '项目路径已复制')
                }}
                title="复制项目路径"
              >
                ⧉
              </button>
              <button onClick={() => void onRemove(active)} title="从列表移除">✕</button>
            </div>
          </div>

          <div className="sb-tabs">
            <button
              className={tab === 'docs' ? 'active' : ''}
              onClick={() => setTab('docs')}
            >
              文档
            </button>
            <button
              className={tab === 'search' ? 'active' : ''}
              onClick={() => setTab('search')}
            >
              搜索
            </button>
            <button className={tab === 'git' ? 'active' : ''} onClick={() => setTab('git')}>
              Git
            </button>
          </div>

          {tab === 'docs' ? (
            <>
              <div className="sb-filter">
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="过滤文档名…"
                  spellCheck={false}
                />
              </div>
              <div className="sb-tree">
                {treeLoading && <div className="sb-empty">扫描中…</div>}
                {!treeLoading && tree && (tree.children?.length ?? 0) === 0 && (
                  <div className="sb-empty">未找到 Markdown / HTML / TXT 文档</div>
                )}
                {!treeLoading &&
                  tree?.children?.map((c) => (
                    <TreeNode
                      key={c.path}
                      node={c}
                      depth={0}
                      ctx={{ projectId: active.id, onMenu: treeMenu }}
                    />
                  ))}
              </div>
            </>
          ) : tab === 'search' ? (
            <div className="sb-tree git-tree">
              <SearchPanel projectId={active.id} />
            </div>
          ) : (
            <div className="sb-tree git-tree">
              <GitPanel projectId={active.id} />
            </div>
          )}
        </>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </aside>
  )
}
