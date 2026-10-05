import { useEffect, useState, type FormEvent } from 'react'
import { useStore } from '../store'
import { api } from '../api'

type Kind = 'wsl' | 'docker' | 'ssh' | 'custom'

const KIND_INFO: Record<Kind, { label: string; tip: string; hostHint: string }> = {
  wsl: {
    label: 'WSL',
    tip: '自动探测已安装的发行版并定位其文件（以本机方式直接阅读，无需在 WSL 内运行服务）',
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

/** 添加项目：本地文件夹 或 远程连接（WSL 自动探测 / Docker / SSH / 自定义） */
export default function AddProjectDialog() {
  const store = useStore()
  const {
    addProjectOpen,
    closeAddProject,
    remotes,
    connectRemote,
    reconnectRemote,
    disconnectRemote,
    importProject,
    toast
  } = store

  const [mode, setMode] = useState<'choose' | 'local' | 'remote'>('choose')
  const [kind, setKind] = useState<Kind>('wsl')

  // notesd 连接表单
  const [host, setHost] = useState('')
  const [port, setPort] = useState('37123')
  const [token, setToken] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  // WSL 探测
  const [distros, setDistros] = useState<string[]>([])
  const [distro, setDistro] = useState('')
  const [wslPath, setWslPath] = useState('')
  const [detecting, setDetecting] = useState(false)

  useEffect(() => {
    if (!addProjectOpen) {
      setMode('choose')
      setBusy(false)
    }
  }, [addProjectOpen])

  // WSL 模式：探测发行版
  useEffect(() => {
    if (addProjectOpen && mode === 'remote' && kind === 'wsl' && distros.length === 0 && !detecting) {
      setDetecting(true)
      api<{ distros: string[] }>('GET', '/api/wsl/distros')
        .then((r) => {
          const list = (r.distros ?? []).filter((d) => !d.startsWith('docker-'))
          setDistros(list)
          if (list.length > 0) pickDistro(list[0])
        })
        .catch((err) => toast('err', `WSL 探测失败：${err}`))
        .finally(() => setDetecting(false))
    }
  }, [addProjectOpen, mode, kind, distros.length, detecting, toast])

  const pickDistro = (d: string): void => {
    setDistro(d)
    setWslPath('')
    api<{ home: string; unc: string }>('GET', `/api/wsl/home?distro=${encodeURIComponent(d)}`)
      .then((r) => setWslPath(r.unc))
      .catch(() => setWslPath(`\\\\wsl.localhost\\${d}`))
  }

  const importWsl = async (): Promise<void> => {
    if (!wslPath.trim()) return
    await importProject(wslPath.trim())
    closeAddProject()
  }

  const onSubmitRemote = async (e: FormEvent): Promise<void> => {
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

  const onPickLocal = async (): Promise<void> => {
    if (window.awesomeNotes) {
      const path = await window.awesomeNotes.selectFolder()
      if (path) {
        await importProject(path)
        closeAddProject()
      }
    } else {
      const path = window.prompt('纯 Web 预览模式：请输入项目目录的绝对路径')
      if (path) {
        await importProject(path)
        closeAddProject()
      }
    }
  }

  if (!addProjectOpen) return null

  return (
    <div className="settings-mask" onClick={closeAddProject}>
      <div className="remote-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="rd-title">添加项目</div>

        {mode === 'choose' && (
          <>
            <div className="rd-choose">
              <button className="rd-choice" onClick={() => void onPickLocal()}>
                <span className="rd-choice-icon">📁</span>
                <span className="rd-choice-name">本地文件夹</span>
                <span className="rd-choice-desc">导入本机目录（含 WSL/网络路径可直接粘贴）</span>
              </button>
              <button className="rd-choice" onClick={() => setMode('remote')}>
                <span className="rd-choice-icon">🌐</span>
                <span className="rd-choice-name">远程连接</span>
                <span className="rd-choice-desc">WSL 自动探测 / Docker / SSH / 自定义 notesd</span>
              </button>
            </div>
          </>
        )}

        {mode === 'remote' && (
          <>
            <div className="rd-sub">连接远端机器上运行的 notesd 服务，或直接探测 WSL 发行版</div>
            <div className="rd-kinds">
              {(Object.keys(KIND_INFO) as Kind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`rd-kind ${kind === k ? 'active' : ''}`}
                  onClick={() => setKind(k)}
                >
                  {KIND_INFO[k].label}
                </button>
              ))}
            </div>
            <div className="rd-tip">{KIND_INFO[kind].tip}</div>

            {kind === 'wsl' ? (
              <div className="rd-form">
                {detecting && <div className="rd-sub">正在探测 WSL 发行版…</div>}
                {distros.length === 0 && !detecting && (
                  <div className="rd-sub">未探测到 WSL 发行版（docker- 后端已忽略）</div>
                )}
                {distros.length > 0 && (
                  <>
                    <label className="rd-row">
                      <span>发行版</span>
                      <select value={distro} onChange={(e) => pickDistro(e.target.value)}>
                        {distros.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="rd-row">
                      <span>项目路径</span>
                      <input
                        value={wslPath}
                        onChange={(e) => setWslPath(e.target.value)}
                        placeholder="选择发行版后自动填入家目录，可改为子目录"
                        spellCheck={false}
                      />
                    </label>
                    <button
                      className="btn-primary rd-connect"
                      disabled={!wslPath.trim()}
                      onClick={() => void importWsl()}
                    >
                      导入该目录
                    </button>
                  </>
                )}
              </div>
            ) : (
              <form className="rd-form" onSubmit={(e) => void onSubmitRemote(e)}>
                <label className="rd-row">
                  <span>名称</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="可选，如：公司服务器" spellCheck={false} />
                </label>
                <label className="rd-row">
                  <span>主机</span>
                  <input value={host} onChange={(e) => setHost(e.target.value)} placeholder={KIND_INFO[kind].hostHint || '例如：127.0.0.1'} spellCheck={false} autoFocus />
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
            )}

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
                        {!r.connected && <button onClick={() => void reconnectRemote(r.id)}>重连</button>}
                        <button className="danger" onClick={() => disconnectRemote(r.id)}>断开</button>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
            <button className="rd-back" onClick={() => setMode('choose')}>← 返回</button>
          </>
        )}

        <button className="st-close" onClick={closeAddProject} title="关闭">
          ✕
        </button>
      </div>
    </div>
  )
}
