import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import type { DocNode } from '@shared/types'

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

function TreeNode({ node, depth }: { node: DocNode; depth: number }) {
  const { activeDoc, openDoc, filter } = useStore()
  const [open, setOpen] = useState(depth < 2)
  const f = filter.trim().toLowerCase()
  if (!matchFilter(node, f)) return null

  if (node.type === 'doc') {
    const active = activeDoc?.path === node.path
    return (
      <button
        className={`tree-doc ${active ? 'active' : ''}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => void openDoc(node.path)}
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
        className="tree-dir"
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => setOpen(!open)}
      >
        <span className={`dir-arrow ${open ? 'open' : ''}`}>▸</span>
        <span className="dir-name">{node.name}</span>
        <span className="dir-count">{countDocs(node)}</span>
      </button>
      {open && node.children?.map((c) => <TreeNode key={c.path} node={c} depth={depth + 1} />)}
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
    toast,
    checkUpdate,
    updateChecking,
    openSettings
  } = useStore()
  const [version, setVersion] = useState('')

  const active = useMemo(() => projects.find((p) => p.id === activeProjectId), [projects, activeProjectId])

  // 应用版本（Electron 环境从主进程取；纯 Web 预览显示 dev）
  useEffect(() => {
    let mounted = true
    if (window.awesomeNotes) {
      window.awesomeNotes.appVersion().then((v) => {
        if (mounted) setVersion(`v${v}`)
      })
    } else {
      setVersion('web 预览')
    }
    return () => {
      mounted = false
    }
  }, [])

  const onImport = async () => {
    if (window.awesomeNotes) {
      const path = await window.awesomeNotes.selectFolder()
      if (path) await importProject(path)
    } else {
      const path = window.prompt('纯 Web 预览模式：请输入项目目录的绝对路径')
      if (path) await importProject(path)
    }
  }

  const onRemove = async () => {
    if (!active) return
    if (window.confirm(`确定从列表移除「${active.name}」？（不会删除磁盘文件）`)) {
      await removeProject(active.id)
    }
  }

  return (
    <aside className="sidebar">
      <div className="sb-actions">
        <button className="btn-primary" onClick={() => void onImport()}>
          ＋ 导入项目
        </button>
      </div>

      <div className="sb-projects">
        {projects.length === 0 && (
          <div className="sb-empty">
            还没有项目。
            <br />
            导入一个包含 Markdown / HTML 文档的目录开始阅读。
          </div>
        )}
        {projects.map((p) => (
          <button
            key={p.id}
            className={`proj-item ${p.id === activeProjectId ? 'active' : ''}`}
            onClick={() => void selectProject(p.id)}
            title={p.path}
          >
            <span className="proj-name">{p.name}</span>
            <span className="proj-count">{p.docCount} 篇</span>
          </button>
        ))}
      </div>

      {active && (
        <>
          <div className="sb-proj-head">
            <div className="sb-proj-name" title={active.path}>
              {active.name}
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
              <button onClick={() => void onRemove()} title="从列表移除">✕</button>
            </div>
          </div>
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
              tree?.children?.map((c) => <TreeNode key={c.path} node={c} depth={0} />)}
          </div>
        </>
      )}

      <div className="sb-footer">
        <span className="sb-version">{version}</span>
        <button
          className="sb-update"
          onClick={() => void checkUpdate()}
          disabled={updateChecking}
          title="检查是否有新版本"
        >
          {updateChecking ? '检查中…' : '⟳ 检查更新'}
        </button>
        <button className="sb-update" onClick={openSettings} title="设置">
          ⚙ 设置
        </button>
      </div>
    </aside>
  )
}
