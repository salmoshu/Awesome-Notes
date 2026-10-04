import { useStore } from '../store'

export default function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.kind === 'ok' ? '✓' : t.kind === 'err' ? '✕' : 'ℹ'} {t.text}
        </div>
      ))}
    </div>
  )
}
