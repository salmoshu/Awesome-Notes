// 架构矩阵（DSM 依赖结构矩阵）：行=依赖方 from、列=被依赖 to，
// 单元格填色深浅按连接数；循环依赖环上的组件名与边经 insights 接口取数高亮
// （insights 不可用时仅省略高亮与环计数，矩阵本体照常渲染）。
import { useEffect, useMemo, useState } from 'react'
import type { ArchSpec } from '@shared/types'
import { archInsights } from '../api'
import { apiCallFor, useStore } from '../store'
import { archErrorText } from './ArchitectureView'

interface Props {
  /** 快照 ref（矩阵为单 ref 视图） */
  refName: string
  /** 刷新代际：变化即丢弃缓存重拉 */
  refreshSeq: number
}

/** 单元格连接数：spec 的 connections 已按 (from,to) 聚合，label 形如 "×N"（N>1 时才有） */
function connCount(label?: string): number {
  const m = /^×(\d+)$/.exec(label ?? '')
  return m ? parseInt(m[1], 10) : 1
}

export default function ArchMatrix({ refName, refreshSeq }: Props) {
  const activeProjectId = useStore((s) => s.activeProjectId)
  const ensureArchSpec = useStore((s) => s.ensureArchSpec)
  const [spec, setSpec] = useState<ArchSpec | null>(null)
  // null = insights 未取到（端点缺失或失败），此时不做环高亮、摘要不含环计数
  const [cycles, setCycles] = useState<string[][] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const id = activeProjectId
    if (!id) return
    let stale = false
    setLoading(true)
    setError(null)
    void (async () => {
      const r = await ensureArchSpec(refName)
      if (stale) return
      if (!r.ok) {
        setError(archErrorText(r.error))
        setSpec(null)
        setCycles(null)
        setLoading(false)
        return
      }
      setSpec(r.spec)
      try {
        const ins = await archInsights(id, refName, apiCallFor(id))
        if (!stale) setCycles(ins.ok ? ins.cycles : null)
      } catch {
        if (!stale) setCycles(null)
      }
      if (!stale) setLoading(false)
    })()
    return () => {
      stale = true
    }
  }, [activeProjectId, refName, refreshSeq, ensureArchSpec])

  const matrix = useMemo(() => {
    const comps = (spec?.components ?? []).map((c) => ({ id: c.id, label: c.label ?? c.id }))
    const idx = new Map(comps.map((c, i) => [c.id, i]))
    // `${row}:${col}` → 连接数（row 依赖 col）
    const cells = new Map<string, number>()
    let conns = 0
    for (const c of spec?.connections ?? []) {
      const i = idx.get(c.from)
      const j = idx.get(c.to)
      if (i === undefined || j === undefined) continue
      cells.set(`${i}:${j}`, connCount(c.label))
      conns++
    }
    // 环内组件集合与环上边集合（相邻节点对）
    const cycleComps = new Set<string>()
    const cycleCells = new Set<string>()
    for (const cyc of cycles ?? []) {
      for (let k = 0; k < cyc.length; k++) {
        cycleComps.add(cyc[k])
        if (k + 1 < cyc.length) {
          const i = idx.get(cyc[k])
          const j = idx.get(cyc[k + 1])
          if (i !== undefined && j !== undefined) cycleCells.add(`${i}:${j}`)
        }
      }
    }
    return { comps, cells, conns, cycleComps, cycleCells }
  }, [spec, cycles])

  if (loading) return <div className="hv-loading">架构矩阵加载中…</div>
  if (error) return <div className="hv-empty">{error}</div>
  if (!spec || matrix.comps.length === 0) return <div className="hv-empty">该 ref 未分析出组件</div>

  return (
    <div className="av-matrix-wrap">
      <div className="av-matrix-summary">
        {matrix.comps.length} 组件 · {matrix.conns} 连接
        {cycles !== null && ` · ${cycles.length} 环`}
      </div>
      <div className="av-matrix-scroll">
        <table className="av-matrix">
          <thead>
            <tr>
              <th className="am-corner" />
              {matrix.comps.map((c) => (
                <th
                  key={c.id}
                  className={matrix.cycleComps.has(c.id) ? 'am-cycle' : ''}
                  title={c.id}
                >
                  <span>{c.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.comps.map((row, i) => (
              <tr key={row.id}>
                <th
                  className={matrix.cycleComps.has(row.id) ? 'am-cycle' : ''}
                  title={row.id}
                >
                  {row.label}
                </th>
                {matrix.comps.map((col, j) => {
                  if (i === j) return <td key={col.id} className="am-diag" />
                  const n = matrix.cells.get(`${i}:${j}`)
                  // 深浅档：×1 浅、×2-4 中、≥5 深
                  const lvl = n === undefined ? 0 : n >= 5 ? 3 : n >= 2 ? 2 : 1
                  const cls = [
                    lvl > 0 ? `am-hit am-l${lvl}` : '',
                    matrix.cycleCells.has(`${i}:${j}`) ? 'am-on-cycle' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')
                  return (
                    <td
                      key={col.id}
                      className={cls || undefined}
                      title={n !== undefined ? `${row.label} → ${col.label} ×${n}` : undefined}
                    >
                      {n !== undefined && n >= 2 ? `×${n}` : ''}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
