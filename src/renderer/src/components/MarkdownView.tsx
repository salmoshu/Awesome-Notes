import { useEffect, useMemo, useRef, useState, type AnchorHTMLAttributes, type ImgHTMLAttributes } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { Annotation } from '@shared/types'
import { useStore, rawBaseFor, origProjectId } from '../store'

interface Props {
  content: string
  annotations: Annotation[]
  onSelectAnn: (id: string) => void
}

/** GFM 自动链接只裁剪 ASCII 标点，中文句号/逗号乃至后随文字会被并入 URL ——
 *  在第一个 CJK 字符处截断，再剥掉尾部 ASCII 标点 */
const CJK_IN_URL = /[\u3000-\u303f\u3040-\u30ff\u4e00-\u9fff\uff00-\uffef]/
const TRAILING_PUNCT = /[.,;:!?)\]}>～]+$/g

/** 中文排版：源码中的折行只是编排（软换行），阅读渲染不应变成空格 ——
 *  CJK 字符相邻的 \n 直接拼接；英文之间的换行仍保留为空格 */
const CJK_EDGE = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/

interface MdNode {
  type?: string
  value?: string
  children?: MdNode[]
}

function remarkCjkSoftBreaks() {
  return (tree: MdNode) => {
    const walk = (node: MdNode): void => {
      if (node.type === 'text' && typeof node.value === 'string' && node.value.includes('\n')) {
        node.value = node.value.replace(/(\S)\n/g, (m, prev: string, offset: number, whole: string) => {
          const next = whole.charAt(offset + m.length)
          return CJK_EDGE.test(prev) || CJK_EDGE.test(next) ? prev : `${prev} `
        })
      }
      node.children?.forEach(walk)
    }
    walk(tree)
  }
}

function cleanLinkText(s: string): string {
  const m = s.match(CJK_IN_URL)
  let t = m && m.index !== undefined ? s.slice(0, m.index) : s
  t = t.replace(TRAILING_PUNCT, '')
  return t || s
}

/** 文档相对链接（../light_language.md）解析为项目内相对路径；越界返回 null */
export function resolveDocLink(fromPath: string, href: string): string | null {
  let h = href.split('#')[0].split('?')[0]
  try {
    h = decodeURIComponent(h)
  } catch {
    /* 保留原值 */
  }
  if (!h || /^([a-z]+:)?\/\//i.test(h)) return null
  const segs = [...fromPath.split('/').slice(0, -1), ...h.split('/')]
  const out: string[] = []
  for (const seg of segs) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      // 已在项目根再向上 = 越界
      if (out.length === 0) return null
      out.pop()
      continue
    }
    out.push(seg)
  }
  return out.join('/')
}

const LINKABLE_EXTS = [
  '.md', '.markdown', '.mdown', '.mkd', '.html', '.htm', '.txt',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico',
  '.json', '.yaml', '.yml', '.xml', '.log', '.csv'
]

/** Markdown 中的相对图片重写为 sidecar /raw 真实 URL */
function MarkdownImg({
  src,
  alt,
  ...rest
}: React.ImgHTMLAttributes<HTMLImageElement>): JSX.Element {
  const projectId = useStore((st) => st.activeProjectId)
  const docPath = useStore((st) => st.activeDoc?.path)
  const [rawBase, setRawBase] = useState('')
  useEffect(() => {
    void rawBaseFor(projectId).then(setRawBase)
  }, [projectId])
  if (typeof src !== 'string' || /^(https?:|data:|blob:)/i.test(src) || !docPath || !rawBase) {
    return <img src={src} alt={alt} {...rest} />
  }
  const resolved = resolveDocLink(docPath, src)
  if (!resolved) return <img src={src} alt={alt} {...rest} />
  return (
    <img
      src={`${rawBase}/raw/${origProjectId(projectId ?? '')}/${resolved}`}
      alt={alt}
      {...rest}
    />
  )
}

function openRelativeLink(href: string): void {
  const st = useStore.getState()
  if (!st.activeDoc) return
  const resolved = resolveDocLink(st.activeDoc.path, href)
  if (!resolved || resolved.startsWith('..')) {
    st.toast('info', `无法解析链接目标：${href}（超出项目范围）`)
    return
  }
  const name = resolved.split('/').pop() ?? ''
  if (!LINKABLE_EXTS.some((ext) => name.toLowerCase().endsWith(ext))) {
    st.toast('info', '暂不支持预览该类型文件（支持文档 / 图片 / 常见文本）')
    return
  }
  void st.openDoc(resolved)
}

/** react-markdown 传入的 href 已被 URI 编码（。→ %E3%80%82），先解码再清洗 */
function cleanHref(raw: string): string {
  let s = raw
  try {
    s = decodeURIComponent(raw)
  } catch {
    /* 保留原值 */
  }
  return cleanLinkText(s)
}

function MarkdownAnchor({
  href,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement>): JSX.Element {
  const cleaned = typeof href === 'string' ? cleanHref(href) : href
  const external = typeof cleaned === 'string' && /^https?:/i.test(cleaned)
  const label = typeof children === 'string' ? cleanLinkText(children) : children
  return (
    <a
      href={cleaned}
      {...rest}
      onClick={(e) => {
        if (external) {
          e.preventDefault()
          useStore.getState().openExtPage(cleaned as string)
          return
        }
        // 相对文档链接：应用内打开（打不开只提示，不再跳空白页）
        if (typeof cleaned === 'string' && cleaned && !cleaned.startsWith('#') && !/^[a-z]+:/i.test(cleaned)) {
          e.preventDefault()
          openRelativeLink(cleaned)
        }
      }}
    >
      {label}
    </a>
  )
}

/** 收集容器内所有文本节点与拼接全文 */
function collectText(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const el = n.parentElement
      if (!el) return NodeFilter.FILTER_REJECT
      const tag = el.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'MARK' || tag === 'TEXTAREA') return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    }
  })
  const nodes: Text[] = []
  let n = walker.nextNode()
  while (n) {
    nodes.push(n as Text)
    n = walker.nextNode()
  }
  let full = ''
  const starts: number[] = []
  for (const t of nodes) {
    starts.push(full.length)
    full += t.data
  }
  return { nodes, starts, full }
}

/** 在拼接全文中为批注选锚：quote 出现位置中 prefix/suffix 匹配度最高者 */
function locate(full: string, a: Annotation): [number, number] | null {
  if (!a.quote) return null
  let best: [number, number] | null = null
  let bestScore = -1
  let idx = full.indexOf(a.quote)
  while (idx >= 0) {
    let score = 0
    const before = full.slice(Math.max(0, idx - a.prefix.length), idx)
    const after = full.slice(idx + a.quote.length, idx + a.quote.length + a.suffix.length)
    if (a.prefix && before === a.prefix) score += 2
    if (a.suffix && after === a.suffix) score += 2
    if (score > bestScore) {
      bestScore = score
      best = [idx, idx + a.quote.length]
    }
    idx = full.indexOf(a.quote, idx + 1)
  }
  return best
}

/** 把 [s, e) 区间跨文本节点包裹成 <mark> */
function wrapRange(nodes: Text[], starts: number[], s: number, e: number, a: Annotation, onClick: (id: string) => void) {
  for (let i = 0; i < nodes.length; i++) {
    const ns = starts[i]
    const ne = ns + nodes[i].data.length
    if (ne <= s || ns >= e) continue
    const node = nodes[i]
    const localS = Math.max(0, s - ns)
    const localE = Math.min(node.data.length, e - ns)
    // 拆分文本节点： [before][mid][after]
    const mid = node.splitText(localS)
    mid.splitText(localE - localS)
    const mark = document.createElement('mark')
    mark.className = `ann-mark ${a.status}`
    mark.dataset.annId = a.id
    mark.title = a.text
    mark.addEventListener('click', () => onClick(a.id))
    mid.parentNode?.replaceChild(mark, mid)
    mark.appendChild(mid)
  }
}

export default function MarkdownView({ content, annotations, onSelectAnn }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  const rendered = useMemo(
    () => (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkCjkSoftBreaks]}
        rehypePlugins={[rehypeHighlight]}
        components={{ a: MarkdownAnchor, img: MarkdownImg }}
      >
        {content}
      </ReactMarkdown>
    ),
    [content]
  )

  // 渲染完成后应用批注高亮（内容或批注变化时重打）
  useEffect(() => {
    const root = ref.current
    if (!root) return
    root.querySelectorAll('mark.ann-mark').forEach((m) => {
      const parent = m.parentNode
      if (!parent) return
      while (m.firstChild) parent.insertBefore(m.firstChild, m)
      parent.removeChild(m)
      parent.normalize?.()
    })
    if (annotations.length === 0) return
    const { nodes, starts, full } = collectText(root)
    for (const a of annotations) {
      const loc = locate(full, a)
      if (loc) wrapRange(nodes, starts, loc[0], loc[1], a, onSelectAnn)
    }
  }, [content, annotations, onSelectAnn])

  return (
    <div
      className="prose"
      ref={ref}
      onDoubleClick={(e) => {
        // 双击正文进入所见即所得编辑；链接 / 批注 / 图片上的双击保留原交互
        if ((e.target as HTMLElement).closest('a, mark, img')) return
        useStore.getState().setMode('edit')
      }}
    >
      {rendered}
    </div>
  )
}

/** 计算选区在容器全文中的 quote/prefix/suffix */
export function selectionAnchor(container: HTMLElement): {
  quote: string
  prefix: string
  suffix: string
} | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed) return null
  if (!container.contains(sel.anchorNode) || !container.contains(sel.focusNode)) return null
  const range = sel.getRangeAt(0)
  // range.toString() 比 sel.toString() 更可靠（部分嵌入环境下后者为空）
  const quote = range.toString() || sel.toString()
  if (!quote.trim()) return null

  const { full } = collectText(container)
  const pre = document.createRange()
  pre.selectNodeContents(container)
  pre.setEnd(range.startContainer, range.startOffset)
  const start = pre.toString().length
  const end = start + range.toString().length
  return {
    quote,
    prefix: full.slice(Math.max(0, start - 40), start),
    suffix: full.slice(end, end + 40)
  }
}
