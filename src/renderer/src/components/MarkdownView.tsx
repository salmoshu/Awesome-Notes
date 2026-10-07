import { useEffect, useRef, useState } from 'react'
import Vditor from 'vditor'
import hljs from 'highlight.js/lib/common'
import 'vditor/dist/index.css'
import 'vditor/dist/js/icons/ant.js'
import 'vditor/dist/js/i18n/zh_CN.js'
import luteUrl from 'vditor/dist/js/lute/lute.min.js?url'
import type { Annotation } from '@shared/types'
import { useStore, rawBaseFor, origProjectId } from '../store'
import { systemPrefersDark } from '../utils/settings'
import { collectText, findAnnotationRange, setTextHighlight } from '../utils/textRanges'

interface Props {
  annotations: Annotation[]
  onSelectAnn: (id: string) => void
}

/** 文档相对链接解析为项目内路径；越界返回 null。 */
export function resolveDocLink(fromPath: string, href: string): string | null {
  let path = href.split('#')[0].split('?')[0]
  try { path = decodeURIComponent(path) } catch { /* 保留原值 */ }
  if (!path || /^([a-z]+:)?\/\//i.test(path)) return null
  const segments = [...fromPath.split('/').slice(0, -1), ...path.split('/')]
  const result: string[] = []
  for (const segment of segments) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (!result.length) return null
      result.pop()
    } else result.push(segment)
  }
  return result.join('/')
}

const LINKABLE_EXTS = [
  '.md', '.markdown', '.mdown', '.mkd', '.html', '.htm', '.txt',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico',
  '.json', '.yaml', '.yml', '.xml', '.log', '.csv'
]

function openLink(href: string): void {
  const state = useStore.getState()
  // GFM 自动链接可能把紧随 URL 的中文标点并入地址。
  if (/^https?:/i.test(href)) {
    let cleaned = href
    try { cleaned = decodeURIComponent(href) } catch { /* 保留原值 */ }
    cleaned = cleaned.split(/[\u3000-\u303f\u3040-\u30ff\u4e00-\u9fff\uff00-\uffef]/)[0]
      .replace(/[.,;:!?)\]}>～]+$/g, '')
    state.openExtPage(cleaned || href)
    return
  }
  if (!href || href.startsWith('#') || /^[a-z]+:/i.test(href) || !state.activeDoc) return
  const resolved = resolveDocLink(state.activeDoc.path, href)
  if (!resolved) {
    state.toast('info', `无法解析链接目标：${href}（超出项目范围）`)
  } else if (!LINKABLE_EXTS.some((ext) => resolved.toLowerCase().endsWith(ext))) {
    state.toast('info', '暂不支持预览该类型文件（支持文档 / 图片 / 常见文本）')
  } else void state.openDoc(resolved)
}

// Markdown 解析器也随应用内置。先完成加载，避免快速切换模式时销毁半初始化实例。
let luteReady: Promise<void> | undefined
function loadLute(): Promise<void> {
  if (!luteReady) {
    luteReady = new Promise<void>((resolve, reject) => {
      if (document.getElementById('vditorLuteScript')) { resolve(); return }
      const script = document.createElement('script')
      script.src = luteUrl
      script.onload = () => { script.id = 'vditorLuteScript'; resolve() }
      script.onerror = () => { script.remove(); reject(new Error('Markdown 解析器加载失败')) }
      document.head.appendChild(script)
    }).catch((error) => { luteReady = undefined; throw error })
  }
  return luteReady
}

/**
 * 软换行连写：源码在段内手动换行（如长列表项折行）时，Lute 渲染出的 "\n"
 * 在 white-space:normal 下显示为空格，中文语境观感错误。渲染方向把与 CJK
 * 相邻的 "\n" 包进隐藏的占位 span（视觉上直接连写），西文之间保留折叠空格；
 * 序列化方向再还原为 "\n"，保证源码的换行结构在保存/撤销/复制时不丢失。
 * code/textarea 等预格式内容里的换行不动。
 */
const SOFTBREAK_SPAN = '<span data-an-softbreak>\n</span>'
const SOFTBREAK_SPAN_RE = /<span data-an-softbreak(?:="")?>([^<]*)<\/span>/g

/** 序列化/Spin 前：占位 span 还原为 "\n" */
function unwrapSoftBreaks(html: string): string {
  return html.includes('data-an-softbreak') ? html.replace(SOFTBREAK_SPAN_RE, '$1') : html
}

/** 提取标签名（开闭都返回纯名字，如 </pre> → pre）。 */
function tagName(part: string): string {
  const m = /^<\/?\s*([a-zA-Z][a-zA-Z0-9:-]*)/.exec(part)
  return m ? m[1].toLowerCase() : ''
}

const PRELIKE = new Set(['pre', 'textarea', 'script'])
/** CJK 及全角标点：与中文相邻的软换行直接连写，不加空格 */
const CJK_CHAR = /[\u2e80-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef\u3000-\u303f]/

/**
 * 文本片段内的软换行逐个判定：换行两侧任一侧是 CJK（含全角标点）则包进
 * 隐藏占位 span（视觉连写）；两侧都是西文时保留 "\n"，由 white-space
 * 折叠成一个空格，避免英文单词被硬拼在一起。
 */
function joinSoftBreaks(part: string): string {
  return part.replace(/\n/g, (_nl, offset: number, whole: string): string => {
    const prev = whole.slice(0, offset).replace(/\s+$/, '').slice(-1)
    const nextMatch = /\S/.exec(whole.slice(offset + 1))
    const next = nextMatch ? nextMatch[0] : ''
    const cjkSide = (c: string): boolean => !!c && CJK_CHAR.test(c)
    return cjkSide(prev) || cjkSide(next) ? SOFTBREAK_SPAN : '\n'
  })
}

function wrapSoftBreaks(html: string): string {
  if (!html.includes('\n')) return html
  const parts = html.split(/(<[^>]*>)/)
  let preDepth = 0
  let out = ''
  for (const part of parts) {
    if (part.startsWith('<')) {
      // 闭合标签（</pre>）的 tag 名以 "/" 开头，必须先剥掉再比对；
      // 否则 preDepth 只增不减，第一个代码块之后的所有软换行都会漏包
      // （v0.4.4 修复：列表 / 引用块内换行渲染成空格的根因）。
      if (PRELIKE.has(tagName(part))) {
        preDepth = part[1] === '/' ? Math.max(0, preDepth - 1) : preDepth + 1
      }
      out += part
    } else if (preDepth === 0 && part.includes('\n')) {
      out += joinSoftBreaks(part)
    } else {
      out += part
    }
  }
  return out
}

/** 阅读模式：保留渲染排版，正文始终可编辑，双击仅执行正常的文字选择。 */
export default function MarkdownView({ annotations, onSelectAnn }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const themeSetting = useStore((state) => state.settings.theme)
  const [sysDark, setSysDark] = useState(systemPrefersDark())
  const theme = themeSetting === 'dark' || (themeSetting === 'system' && sysDark) ? 'dark' : 'light'
  const docPath = useStore((state) => state.activeDoc?.path)
  const projectId = useStore((state) => state.activeProjectId)
  const tabId = useStore((state) => state.activeTabId)
  const annotationsRef = useRef(annotations)
  const selectRef = useRef(onSelectAnn)
  const refreshRef = useRef<(() => void) | null>(null)
  annotationsRef.current = annotations
  selectRef.current = onSelectAnn

  // 跟随系统时，系统主题切换需重建编辑器配色
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => setSysDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => { refreshRef.current?.() }, [annotations])

  useEffect(() => {
    const container = ref.current
    if (!container || !docPath || !projectId) return
    let disposed = false
    let ready = false
    let editor: Vditor | undefined
    let rawBase = ''
    let lastValue = ''
    let lastDraft = useStore.getState().draft
    let syncingFromEditor = false
    let frame = 0
    let unsubscribe: (() => void) | undefined
    let annotationRanges: { annotation: Annotation; range: Range }[] = []

    const rewriteImages = (): void => {
      if (!rawBase) return
      container.querySelectorAll('img').forEach((image) => {
        const src = image.getAttribute('src') ?? ''
        if (!src || src === image.dataset.anDisplaySrc) return
        if (/^(https?:|data:|blob:)/i.test(src)) {
          delete image.dataset.anOrigSrc
          delete image.dataset.anDisplaySrc
          return
        }
        const resolved = resolveDocLink(docPath, src)
        if (!resolved) return
        image.dataset.anOrigSrc = src
        image.src = `${rawBase}/raw/${origProjectId(projectId)}/${resolved.split('/').map(encodeURIComponent).join('/')}`
        image.dataset.anDisplaySrc = image.getAttribute('src')!
      })
    }
    const refresh = (): void => {
      const prose = container.querySelector<HTMLElement>('.prose')
      if (!prose || disposed) return
      // 块悬浮工具栏（上移/下移/删除）左移到正文左侧空白区所需的位置变量
      const wysiwyg = container.querySelector<HTMLElement>('.vditor-wysiwyg')
      wysiwyg?.style.setProperty('--prose-left', `${prose.offsetLeft}px`)
      rewriteImages()
      prose.querySelectorAll<HTMLElement>('.vditor-wysiwyg__preview code:not([data-highlighted])').forEach((code) => {
        const language = [...code.classList].find((name) => name.startsWith('language-'))?.slice(9)
        if (language && hljs.getLanguage(language)) hljs.highlightElement(code)
      })
      annotationRanges = annotationsRef.current.flatMap((annotation) => {
        const range = findAnnotationRange(prose, annotation)
        return range ? [{ annotation, range }] : []
      })
      for (const status of ['open', 'done'] as const) {
        setTextHighlight(`ann-${status}`, annotationRanges.filter((item) => item.annotation.status === status).map((item) => item.range))
      }
      window.dispatchEvent(new Event('markdown-rendered'))
    }
    refreshRef.current = refresh
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(refresh)
    })
    // 侧栏/批注面板开合、窗口缩放都会改版式；--prose-left 需同步刷新
    const resizeObserver = new ResizeObserver(() => refresh())
    resizeObserver.observe(container)

    const syncDraft = (): void => {
      const state = useStore.getState()
      if (!ready || !editor || disposed || state.activeTabId !== tabId || state.activeProjectId !== projectId) return
      const value = editor.getValue()
      rewriteImages()
      // 初始化的格式规范化不算编辑，只有正文实际变化才更新原文草稿。
      if (value === lastValue) return
      lastValue = value
      lastDraft = value
      // 标记「本次 store 变更来自编辑器自身」：订阅回调据此跳过回写，
      // 避免任何中间态触发 setValue 整体重渲染（光标会被重置到文首）。
      syncingFromEditor = true
      try {
        state.setDraft(value)
      } finally {
        syncingFromEditor = false
      }
    }
    const onInput = (event: Event): void => {
      if (!(event as InputEvent).isComposing) syncDraft()
    }
    const onClick = (event: MouseEvent): void => {
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('.prose a')
      if (link) {
        event.preventDefault()
        event.stopPropagation()
        openLink(link.getAttribute('href') ?? '')
        return
      }
      const hit = annotationRanges.find(({ range }) => [...range.getClientRects()].some((rect) =>
        event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom))
      if (hit) selectRef.current(hit.annotation.id)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        syncDraft()
        void useStore.getState().saveDoc()
      }
    }

    void loadLute().then(() => {
      if (disposed) return
      editor = new Vditor(container, {
        mode: 'wysiwyg',
        theme: theme === 'dark' ? 'dark' : 'classic',
        i18n: (window as unknown as { VditorI18n: IOptions['i18n'] }).VditorI18n,
        icon: undefined,
        _lutePath: luteUrl,
        value: useStore.getState().draft,
        height: 'auto',
        cache: { enable: false },
        toolbar: [
          'headings', 'bold', 'italic', 'strike', 'quote', '|',
          'list', 'ordered-list', 'check', 'code', 'inline-code', '|',
          'link', 'table', 'line', '|', 'undo', 'redo'
        ],
        toolbarConfig: { pin: true },
        link: { isOpen: false },
        upload: { handler: () => '暂不支持粘贴图片：请先把图片放入项目目录，再引用相对路径' },
        preview: {
          theme: { current: '' },
          hljs: { enable: false },
          markdown: { mathBlockPreview: false, mark: true }
        },
        after() {
          if (disposed || !editor) return
          // Vditor 内部的保存/撤销也会序列化 DOM。统一从副本还原图片地址，
          // 避免展示用的 /raw URL 进入 Markdown 或撤销历史。
          const lute = editor.vditor.lute
          const serialize = lute.VditorDOM2Md.bind(lute)
          lute.VditorDOM2Md = (html: string): string => {
            // 软换行占位 span 还原为 "\n"（见 wrapSoftBreaks），源码换行结构不丢失
            const src = unwrapSoftBreaks(html)
            if (!src.includes('data-an-orig-src=')) return serialize(src)
            const template = document.createElement('template')
            template.innerHTML = src
            template.content.querySelectorAll<HTMLImageElement>('img[data-an-orig-src]').forEach((image) => {
              if (image.getAttribute('src') === image.dataset.anDisplaySrc) {
                image.setAttribute('src', image.dataset.anOrigSrc!)
              }
              delete image.dataset.anOrigSrc
              delete image.dataset.anDisplaySrc
            })
            return serialize(template.innerHTML)
          }
          // 整篇渲染方向（setValue/初始渲染/粘贴）：软换行 "\n" 包进隐藏占位 span
          const renderDom = lute.Md2VditorDOM.bind(lute)
          lute.Md2VditorDOM = (markdown: string): string => wrapSoftBreaks(renderDom(markdown))
          // 块级重渲染方向（输入后的 DOM→DOM spin）：先还原占位再重新包裹
          const spin = lute.SpinVditorDOM.bind(lute)
          lute.SpinVditorDOM = (html: string): string => wrapSoftBreaks(spin(unwrapSoftBreaks(html)))
          const prose = container.querySelector<HTMLElement>('.vditor-wysiwyg > .vditor-reset')
          prose?.classList.add('prose')
          prose?.setAttribute('aria-label', '阅读模式编辑器')
          lastValue = editor.getValue()
          // 初次渲染发生在上面的补丁安装之前，重渲染一次让软换行占位生效
          editor.setValue(lastValue, true)
          lastValue = editor.getValue()
          ready = true
          observer.observe(container, { childList: true, characterData: true, subtree: true })
          container.addEventListener('input', onInput)
          container.addEventListener('compositionend', syncDraft)
          container.addEventListener('focusout', syncDraft)
          container.addEventListener('keydown', onKeyDown)
          container.addEventListener('click', onClick, true)
          unsubscribe = useStore.subscribe((state) => {
            if (
              disposed ||
              !editor ||
              syncingFromEditor ||
              state.activeTabId !== tabId ||
              state.activeProjectId !== projectId ||
              state.draft === lastDraft
            ) return
            lastDraft = state.draft
            editor.setValue(state.draft, true)
            lastValue = editor.getValue()
            refresh()
          })
          void rawBaseFor(projectId).then((base) => {
            if (disposed) return
            rawBase = base
            refresh()
          }).catch(() => {})
          refresh()
        },
        input: syncDraft,
        blur: syncDraft
      })
    }).catch((error) => {
      if (!disposed) useStore.getState().toast('err', `阅读编辑器初始化失败：${error}`)
    })

    return () => {
      syncDraft()
      disposed = true
      refreshRef.current = null
      unsubscribe?.()
      observer.disconnect()
      resizeObserver.disconnect()
      cancelAnimationFrame(frame)
      container.removeEventListener('input', onInput)
      container.removeEventListener('compositionend', syncDraft)
      container.removeEventListener('focusout', syncDraft)
      container.removeEventListener('keydown', onKeyDown)
      container.removeEventListener('click', onClick, true)
      setTextHighlight('ann-open', [])
      setTextHighlight('ann-done', [])
      setTextHighlight('ann-flash', [])
      try { editor?.destroy() } catch { /* 半初始化实例不能影响应用卸载 */ }
    }
  }, [docPath, projectId, tabId, theme])

  return <div className="markdown-editor" ref={ref} />
}

/** 计算选区在渲染全文中的 quote/prefix/suffix。 */
export function selectionAnchor(container: HTMLElement): { quote: string; prefix: string; suffix: string } | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !container.contains(selection.anchorNode) || !container.contains(selection.focusNode)) return null
  const range = selection.getRangeAt(0)
  const text = collectText(container)
  const offsetAt = (atStart: boolean): number => {
    const point = range.cloneRange()
    point.collapse(atStart)
    let offset = 0
    for (const node of text.nodes) {
      if (point.comparePoint(node, node.length) <= 0) offset += node.length
      else {
        if (node === point.startContainer) offset += point.startOffset
        break
      }
    }
    return offset
  }
  const start = offsetAt(true)
  const end = offsetAt(false)
  const quote = text.full.slice(start, end)
  if (!quote.trim()) return null
  return { quote, prefix: text.full.slice(Math.max(0, start - 40), start), suffix: text.full.slice(end, end + 40) }
}
