import { useState, type FormEvent } from 'react'
import { useStore } from '../store'

/** 远程连接对话框（参考 ZCode：主机 / 端口 + 连接按钮），管理已存远程的重连与断开 */
export default function RemoteDialog() {
  const { remoteDialogOpen, closeRemoteDialog, remotes, connectRemote, reconnectRemote, disconnectRemote } =
    useStore()
  const [host, setHost] = useState('')
  const [port, setPort] = useState('37123')
  const [token, setToken] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState<'wsl' | 'docker' | 'ssh' | 'custom'>('wsl')

  const KIND_INFO: Record<string, { label: string; tip: string; hostHint: string }> = {
    wsl: {
      label: 'WSL',
      tip: '在 WSL 内运行 notesd（sidecar/bin/notesd.exe 对应 Linux 版），WSL2 端口默认转发到 localhost',
      hostHint: 'localhost'
    },
    docker: {
      label: 'Docker',
      tip: '容器内运行 notesd 并映射端口（docker run -p <端口>:<端口>），连接映射后的 localhost 端口',
      hostHint: 'localhost'
    },
    ssh: {
      label: 'SSH',
      tip: '远端机器运行 notesd，需端口网络可达；不可达时可先建隧道：ssh -L 37123:127.0.0.1:37123 <用户>@<主机>',
      hostHint: ''
    },
    custom: { label: '自定义', tip: '任意可达的 notesd 地址', hostHint: '' }
  }
  const info = KIND_INFO[kind]

  const pickKind = (k: typeof kind): void => {
    setKind(k)
    if (KIND_INFO[k].hostHint) setHost(KIND_INFO[k].hostHint)
  }

  if (!remoteDialogOpen) return null

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!host.trim() || busy) return
    setBusy(true)
    try {
      await connectRemote(host.trim(), Number(port) || 37123, token.trim(), name)
      setHost('')
      setToken('')
      setName('')
    } catch {
      /* toast 已提示 */
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-mask" onClick={closeRemoteDialog}>
      <div className="remote-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="rd-title">远程连接</div>
        <div className="rd-sub">连接远端机器上运行的 notesd 服务，阅读远端项目文档</div>

        <div className="rd-kinds">
          {(['wsl', 'docker', 'ssh', 'custom'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={`rd-kind ${kind === k ? 'active' : ''}`}
              onClick={() => pickKind(k)}
            >
              {KIND_INFO[k].label}
            </button>
          ))}
        </div>
        <div className="rd-tip">{info.tip}</div>

        <form className="rd-form" onSubmit={(e) => void onSubmit(e)}>
          <label className="rd-row">
            <span>名称</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="可选，如：公司服务器" spellCheck={false} />
          </label>
          <label className="rd-row">
            <span>主机</span>
            <input value={host} onChange={(e) => setHost(e.target.value)} placeholder={info.hostHint || '例如：127.0.0.1'} spellCheck={false} autoFocus />
          </label>
          <label className="rd-row">
            <span>端口</span>
            <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="37123" spellCheck={false} />
          </label>
          <label className="rd-row">
            <span>令牌</span>
            <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="访问令牌（X-Notes-Token）" spellCheck={false} />
          </label>
          <button className="btn-primary rd-connect" type="submit" disabled={busy || !host.trim()}>
            {busy ? '连接中…' : '连接'}
          </button>
        </form>

        {remotes.length > 0 && (
          <>
            <div className="rd-divider" />
            <div className="rd-list-title">已保存的远程（重启应用后需重新连接）</div>
            <div className="rd-list">
              {remotes.map((r) => (
                <div key={r.id} className={`rd-item ${r.connected ? '' : 'off'}`}>
                  <span className="rd-dot" title={r.connected ? '已连接' : '未连接'} />
                  <span className="rd-name" title={r.lastError ?? r.name}>
                    {r.name}
                  </span>
                  <span className="rd-host">{r.host}:{r.port}</span>
                  <span className="rd-ops">
                    {!r.connected && (
                      <button onClick={() => void reconnectRemote(r.id)}>重连</button>
                    )}
                    <button className="danger" onClick={() => disconnectRemote(r.id)}>断开</button>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        <button className="st-close" onClick={closeRemoteDialog} title="关闭 (Esc)">
          ✕
        </button>
      </div>
    </div>
  )
}
