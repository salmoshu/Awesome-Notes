export default function TitleBar() {
  const b = window.awesomeNotes
  return (
    <header className="titlebar">
      <div className="tb-drag">
        <span className="tb-logo">📓</span>
        <span className="tb-name">Awesome-Notes</span>
        <span className="tb-sub">项目文档阅读与批注</span>
      </div>
      {b && (
        <div className="tb-btns">
          <button onClick={() => b.winMinimize()} title="最小化">—</button>
          <button onClick={() => b.winToggleMaximize()} title="最大化/还原">▢</button>
          <button className="tb-close" onClick={() => b.winClose()} title="关闭">✕</button>
        </div>
      )}
    </header>
  )
}
