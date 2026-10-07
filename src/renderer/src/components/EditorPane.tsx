import { useStore } from '../store'

/** 原文模式：直接编辑 Markdown 源码或纯文本，与阅读模式共用草稿。 */
export default function EditorPane() {
  const draft = useStore((s) => s.draft)

  return (
    <div className="editor-pane">
      <textarea
        className="editor-plain"
        aria-label="原文编辑器"
        value={draft}
        spellCheck={false}
        onChange={(e) => useStore.getState().setDraft(e.target.value)}
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
