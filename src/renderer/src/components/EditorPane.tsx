import { useEffect, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { keymap } from '@codemirror/view'
import { useStore } from '../store'

export default function EditorPane() {
  const ref = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const { activeDoc, setDraft, saveDoc } = useStore()

  useEffect(() => {
    if (!ref.current || !activeDoc) return
    const view = new EditorView({
      doc: activeDoc.content,
      extensions: [
        basicSetup,
        markdown(),
        keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              void useStore.getState().saveDoc()
              return true
            }
          }
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) setDraft(u.state.doc.toString())
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '13.5px' },
          '.cm-scroller': { fontFamily: "'JetBrains Mono', Consolas, monospace", lineHeight: '1.75' },
          '.cm-content': { padding: '16px 20px' },
          '&.cm-focused': { outline: 'none' }
        })
      ],
      parent: ref.current
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // 仅在新文档时重建编辑器
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDoc?.path])

  return (
    <div className="editor-pane">
      <div className="editor-cm" ref={ref} />
    </div>
  )
}
