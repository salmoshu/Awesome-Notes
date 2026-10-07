import { useEffect, useRef, useState } from 'react'
import Vditor from 'vditor'
import 'vditor/dist/index.css'
// 图标精灵与中文语言包随包内置（默认从 unpkg CDN 懒加载，会被 CSP 拦截：
// 语言包缺失时 init 不执行，编辑器报错且销毁半初始化实例会拖垮整个应用）
import 'vditor/dist/js/icons/ant.js'
import 'vditor/dist/js/i18n/zh_CN.js'
import { useStore, rawBaseFor, origProjectId } from '../store'
import { resolveDocLink } from './MarkdownView'

const MD_EXTS = ['md', 'markdown', 'mdown', 'mkd']

/** zh_CN.js 以 window.VditorI18n 形式挂全局，取出作为 i18n 选项传入 */
function vditorI18n(): IOptions['i18n'] {
  return (window as unknown as { VditorI18n: IOptions['i18n'] }).VditorI18n
}

/** 编辑面板：Markdown 用 Typora 式所见即所得（Vditor IR），纯文本用简易编辑器 */
export default function EditorPane() {
  const ext = useStore((s) => s.activeDoc?.ext ?? '')
  return MD_EXTS.includes(ext) ? <MdEditor /> : <PlainEditor />
}

/**
 * Markdown 所见即所得编辑：输入即渲染（IR 模式），变更同步草稿，Ctrl+S 保存。
 * 文档/主题切换时重建实例（草稿存于 store，重建不丢内容）。
 */
function MdEditor() {
  const ref = useRef<HTMLDivElement>(null)
  const theme = useStore((s) => s.settings.theme)
  const docPath = useStore((s) => s.activeDoc?.path)

  useEffect(() => {
    const container = ref.current
    if (!container || !docPath) return
    const st = useStore.getState()
    const projectId = st.activeProjectId ?? ''
    let rawBase = ''

    // 相对路径图片改指 sidecar /raw 真实地址才能显示；原地址记入 data 属性，
    // 取回 Markdown 前还原，避免把应用内地址写进文档
    const rewriteImages = (): void => {
      if (!rawBase) return
      container.querySelectorAll('img').forEach((img) => {
        const src = img.getAttribute('src') ?? ''
        if (!src || /^(https?:|data:|blob:)/i.test(src)) return
        const resolved = resolveDocLink(docPath, src)
        if (!resolved) return
        img.setAttribute('data-an-orig-src', src)
        img.setAttribute(
          'src',
          `${rawBase}/raw/${origProjectId(projectId)}/${resolved
            .split('/')
            .map(encodeURIComponent)
            .join('/')}`
        )
      })
    }
    const restoreImages = (): void => {
      container.querySelectorAll('img[data-an-orig-src]').forEach((img) => {
        img.setAttribute('src', img.getAttribute('data-an-orig-src') as string)
        img.removeAttribute('data-an-orig-src')
      })
    }
    const observer = new MutationObserver((records) => {
      if (records.some((r) => r.addedNodes.length > 0)) rewriteImages()
    })

    const dark = theme === 'dark'
    let vd: Vditor
    try {
      vd = new Vditor(container, {
        mode: 'ir',
        theme: dark ? 'dark' : 'classic',
        // i18n 选项一旦提供，构造函数走本地分支同步 init，不再请求 CDN 语言包
        i18n: vditorI18n(),
        // 图标精灵已在模块加载时注入，跳过 CDN icons 加载
        icon: undefined,
        value: st.draft,
        height: '100%',
        cache: { enable: false },
        toolbar: [
          'headings', 'bold', 'italic', 'strike', 'quote', '|',
          'list', 'ordered-list', 'check', 'code', 'inline-code', '|',
          'link', 'table', 'line', '|', 'undo', 'redo'
        ],
        toolbarConfig: { pin: true },
        upload: {
          // 无图床可传：拦截粘贴图片，避免 base64 直接写进文档
          handler: () => '暂不支持粘贴图片：请先把图片放入项目目录，再引用相对路径'
        },
        preview: {
          // 内容主题 / 代码高亮 / 数学渲染的 CDN 懒加载会被 CSP 拦截，全部关闭；
          // 排版由内置 vditor-reset + 应用样式覆盖，高亮在阅读模式仍生效
          theme: { current: '' },
          hljs: { enable: false },
          markdown: { mathBlockPreview: false, mark: true }
        },
        after() {
          void rawBaseFor(projectId).then((base) => {
            rawBase = base
            rewriteImages()
          })
          observer.observe(container, { childList: true, subtree: true })
        },
        input() {
          restoreImages()
          const value = vd.getValue()
          rewriteImages()
          useStore.getState().setDraft(value)
        },
        keydown(e) {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault()
            void useStore.getState().saveDoc()
          }
        }
      })
    } catch (err) {
      useStore.getState().toast('err', `编辑器初始化失败：${err}`)
      return
    }

    return () => {
      observer.disconnect()
      try {
        vd.destroy()
      } catch {
        // 半初始化实例的 destroy 可能抛异常（如 init 未完成），不能连带卸载整个应用
      }
    }
    // 仅在新文档或主题切换时重建编辑器
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docPath, theme])

  return (
    <div className="editor-pane">
      <div className="editor-vditor" ref={ref} />
    </div>
  )
}

/** 纯文本编辑：等宽字体 textarea（txt 不做 Markdown 渲染） */
function PlainEditor() {
  const docPath = useStore((s) => s.activeDoc?.path)
  const [text, setText] = useState(() => useStore.getState().draft)

  useEffect(() => {
    setText(useStore.getState().draft)
    // 仅在新文档时重置本地内容
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docPath])

  return (
    <div className="editor-pane">
      <textarea
        className="editor-plain"
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value)
          useStore.getState().setDraft(e.target.value)
        }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault()
            void useStore.getState().saveDoc()
          }
        }}
      />
    </div>
  )
}
