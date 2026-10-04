import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { UpdateStatusEvent, UpdaterPrefs } from '@shared/types'
import { useStore } from '../store'
import { loadUpdaterPrefs, saveUpdaterPrefs } from '../utils/updater-prefs'

type Section = 'appearance' | 'reading' | 'editor' | 'version'

const SECTIONS: Array<{ key: Section; icon: string; label: string }> = [
  { key: 'appearance', icon: '🎨', label: '外观' },
  { key: 'reading', icon: '📖', label: '阅读与批注' },
  { key: 'editor', icon: '✏️', label: '编辑' },
  { key: 'version', icon: '⟳', label: '版本' }
]

/** 设置页：左侧分区块菜单 + 右侧卡片内容区（结构对齐 Awesome-Resume 设置页） */
export default function SettingsModal() {
  const { settingsOpen, closeSettings, settings, setSetting } = useStore()
  const [section, setSection] = useState<Section>('appearance')

  // ---- 版本区状态 ----
  const bridge = window.awesomeNotes
  const [appVersion, setAppVersion] = useState('')
  const [updaterState, setUpdaterState] = useState<UpdateStatusEvent | null>(null)
  const [updaterPrefs, setUpdaterPrefs] = useState<UpdaterPrefs>(loadUpdaterPrefs)
  const [checking, setChecking] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [notes, setNotes] = useState<string | null>(null)
  const [notesLoading, setNotesLoading] = useState(false)

  useEffect(() => {
    if (!settingsOpen) return
    bridge?.appVersion().then(setAppVersion).catch(() => {})
    setUpdaterPrefs(loadUpdaterPrefs())
    if (!bridge) return
    // 设置页打开期间常驻订阅更新事件，保证进「版本」区时状态是热的
    return bridge.onUpdateStatus((e) => {
      setUpdaterState((prev) =>
        e.type === 'download-progress' || e.type === 'update-downloaded'
          ? { ...e, version: e.version ?? prev?.version, releaseNotes: prev?.releaseNotes }
          : e
      )
      if (e.type === 'checking') {
        setChecking(true)
      } else {
        setChecking(false)
        if (e.type !== 'download-progress') setDownloading(false)
      }
    })
  }, [settingsOpen, bridge])

  // Esc 关闭
  useEffect(() => {
    if (!settingsOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettings()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsOpen, closeSettings])

  if (!settingsOpen) return null

  const handlePrefChange = (key: keyof UpdaterPrefs, value: boolean) => {
    const next = { ...updaterPrefs, [key]: value }
    setUpdaterPrefs(next)
    saveUpdaterPrefs(next)
  }

  const handleIgnoreVersion = () => {
    if (!updaterState?.version) return
    const next = { ...updaterPrefs, ignoredVersion: updaterState.version }
    setUpdaterPrefs(next)
    saveUpdaterPrefs(next)
    useStore.getState().toast('info', `已忽略 v${updaterState.version}，出现更新版本时会再次提醒`)
  }

  // 版本区单按钮状态机：检查更新 → 立即下载（自动下载关闭时）→ 立即重启更新
  const handleUpdateAction = async () => {
    if (!bridge) {
      useStore.getState().toast('info', '纯 Web 预览模式不支持检查更新')
      return
    }
    if (updaterState?.type === 'update-downloaded') {
      await bridge.updaterQuitAndInstall()
      return
    }
    if (updaterState?.type === 'update-available' && !updaterPrefs.autoDownload) {
      if (downloading) return
      setDownloading(true)
      try {
        await bridge.updaterDownload()
      } catch {
        setDownloading(false)
      }
      return
    }
    setChecking(true)
    try {
      await bridge.updaterCheck()
    } catch (err) {
      setChecking(false)
      const raw = String(err instanceof Error ? err.message : err)
      const msg = raw.includes('Error:') ? raw.split('Error:').pop()!.trim() : raw
      useStore.getState().toast('info', msg)
    }
  }

  const handleShowCurrentNotes = async () => {
    setNotesOpen(true)
    setNotesLoading(true)
    try {
      setNotes((await bridge?.getCurrentReleaseNotes()) ?? null)
    } catch {
      setNotes(null)
    } finally {
      setNotesLoading(false)
    }
  }

  const downloaded = updaterState?.type === 'update-downloaded'
  const downloadingNow =
    updaterState?.type === 'download-progress' ||
    downloading ||
    (updaterState?.type === 'update-available' && updaterPrefs.autoDownload)

  return (
    <div className="settings-mask" onClick={closeSettings}>
      <div className="settings" onClick={(e) => e.stopPropagation()}>
        <div className="st-side">
          <div className="st-title">设置</div>
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              className={`st-item ${section === s.key ? 'active' : ''}`}
              onClick={() => setSection(s.key)}
            >
              <span className="st-icon">{s.icon}</span>
              {s.label}
            </button>
          ))}
          <div className="st-version">v{appVersion || '…'}</div>
        </div>

        <div className="st-body">
          <button className="st-close" onClick={closeSettings} title="关闭 (Esc)">
            ✕
          </button>

          {section === 'appearance' && (
            <div className="st-card">
              <div className="st-card-title">外观</div>

              <div className="st-row">
                <div className="st-label">主题</div>
                <div className="seg">
                  <button
                    className={settings.theme === 'light' ? 'active' : ''}
                    onClick={() => setSetting('theme', 'light')}
                  >
                    浅色
                  </button>
                  <button
                    className={settings.theme === 'dark' ? 'active' : ''}
                    onClick={() => setSetting('theme', 'dark')}
                  >
                    深色
                  </button>
                </div>
              </div>

              <div className="st-row">
                <div className="st-label">正文字号</div>
                <div className="st-control">
                  <input
                    type="range"
                    min={13}
                    max={18}
                    step={1}
                    value={settings.fontSize}
                    onChange={(e) => setSetting('fontSize', Number(e.target.value))}
                  />
                  <span className="st-value">{settings.fontSize}px</span>
                </div>
                <div className="st-hint">作用于 Markdown 阅读区正文</div>
              </div>

              <div className="st-row">
                <div className="st-label">阅读区宽度</div>
                <div className="seg">
                  {[70, 80, 90, 100].map((w) => (
                    <button
                      key={w}
                      className={settings.contentWidth === w ? 'active' : ''}
                      onClick={() => setSetting('contentWidth', w)}
                    >
                      {w === 100 ? '全宽' : `${w}%`}
                    </button>
                  ))}
                </div>
                <div className="st-hint">按阅读区宽度的百分比控制内容行宽</div>
              </div>

              <div className="st-row">
                <div className="st-label">正文字体</div>
                <div className="seg">
                  <button
                    className={!settings.serifFont ? 'active' : ''}
                    onClick={() => setSetting('serifFont', false)}
                  >
                    无衬线
                  </button>
                  <button
                    className={settings.serifFont ? 'active' : ''}
                    onClick={() => setSetting('serifFont', true)}
                  >
                    衬线
                  </button>
                </div>
              </div>
            </div>
          )}

          {section === 'reading' && (
            <div className="st-card">
              <div className="st-card-title">阅读与批注</div>

              <div className="st-row">
                <div className="st-label">打开文档默认模式</div>
                <div className="seg">
                  <button
                    className={settings.defaultMode === 'read' ? 'active' : ''}
                    onClick={() => setSetting('defaultMode', 'read')}
                  >
                    阅读
                  </button>
                  <button
                    className={settings.defaultMode === 'edit' ? 'active' : ''}
                    onClick={() => setSetting('defaultMode', 'edit')}
                  >
                    编辑
                  </button>
                </div>
              </div>

              <div className="st-row">
                <div className="st-label">默认展开批注面板</div>
                <button
                  className={`switch ${settings.annPanelDefaultOpen ? 'on' : ''}`}
                  onClick={() => setSetting('annPanelDefaultOpen', !settings.annPanelDefaultOpen)}
                >
                  <span className="switch-dot" />
                </button>
                <div className="st-hint">打开文档时自动带出右侧批注面板</div>
              </div>
            </div>
          )}

          {section === 'editor' && (
            <div className="st-card">
              <div className="st-card-title">编辑</div>

              <div className="st-row">
                <div className="st-label">自动保存</div>
                <button
                  className={`switch ${settings.autoSave ? 'on' : ''}`}
                  onClick={() => setSetting('autoSave', !settings.autoSave)}
                >
                  <span className="switch-dot" />
                </button>
                <div className="st-hint">停止输入后自动落盘；Ctrl+S 手动保存始终可用</div>
              </div>

              {settings.autoSave && (
                <div className="st-row">
                  <div className="st-label">自动保存延迟</div>
                  <div className="seg">
                    {[1000, 2000, 3000].map((ms) => (
                      <button
                        key={ms}
                        className={settings.autoSaveDelayMs === ms ? 'active' : ''}
                        onClick={() => setSetting('autoSaveDelayMs', ms)}
                      >
                        {ms / 1000}s
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {section === 'version' && (
            <div className="st-card">
              <div className="st-card-title">版本</div>

              <div className="st-row">
                <span className="st-label">
                  当前版本 <span className="tag">v{appVersion || '…'}</span>
                </span>
                <div className="st-control" style={{ gap: 8 }}>
                  <button className="btn-ghost sm" onClick={() => void handleShowCurrentNotes()}>
                    查看当前版本信息
                  </button>
                  <button
                    className={downloaded ? 'btn-danger sm' : 'btn-primary sm'}
                    disabled={checking || downloadingNow}
                    onClick={() => void handleUpdateAction()}
                  >
                    {downloaded
                      ? '立即重启更新'
                      : downloadingNow
                        ? '下载中…'
                        : checking
                          ? '检查中…'
                          : updaterState?.type === 'update-available'
                            ? '立即下载'
                            : '检查更新'}
                  </button>
                  {updaterState?.type === 'update-available' && (
                    <button className="btn-ghost sm" onClick={handleIgnoreVersion}>
                      忽略此版本
                    </button>
                  )}
                </div>
              </div>

              {/* 更新状态区：随事件推送变化 */}
              {updaterState?.type === 'update-available' && (
                <div className="st-row">
                  <div className="st-hint">
                    发现新版本 <span className="tag">v{updaterState.version}</span>
                    {updaterPrefs.autoDownload ? '，正在后台下载…' : ''}
                  </div>
                  {updaterState.releaseNotes && (
                    <div className="st-notes">{updaterState.releaseNotes}</div>
                  )}
                </div>
              )}
              {updaterState?.type === 'download-progress' && (
                <div className="st-row">
                  <div className="uc-progress" style={{ marginTop: 0 }}>
                    <div
                      className="uc-progress-bar"
                      style={{ width: `${updaterState.percent ?? 0}%` }}
                    />
                  </div>
                </div>
              )}
              {updaterState?.type === 'update-not-available' && (
                <div className="st-row">
                  <div className="st-hint">当前已是最新版本</div>
                </div>
              )}
              {updaterState?.type === 'update-downloaded' && (
                <div className="st-row">
                  <div className="st-hint">
                    新版本 v{updaterState.version} 已下载完成；现在重启立即更新，或退出应用时自动安装
                  </div>
                </div>
              )}
              {updaterState?.type === 'error' && (
                <div className="st-row">
                  <div className="st-hint" style={{ color: 'var(--danger)' }}>
                    检查更新失败：{updaterState.message}（更新源托管在 GitHub
                    Releases，网络受限时可能无法访问）
                  </div>
                </div>
              )}

              <div className="st-divider" />

              <div className="st-row">
                <div className="st-label">自动更新</div>
                <div className="st-col">
                  <label className="st-switch-row">
                    <button
                      className={`switch ${updaterPrefs.autoCheck ? 'on' : ''}`}
                      onClick={() => handlePrefChange('autoCheck', !updaterPrefs.autoCheck)}
                    >
                      <span className="switch-dot" />
                    </button>
                    启动时自动检查更新
                  </label>
                  <label className="st-switch-row">
                    <button
                      className={`switch ${updaterPrefs.autoDownload ? 'on' : ''}`}
                      onClick={() => handlePrefChange('autoDownload', !updaterPrefs.autoDownload)}
                    >
                      <span className="switch-dot" />
                    </button>
                    发现新版本后自动下载
                  </label>
                </div>
              </div>

              <div className="st-hint" style={{ marginTop: 12 }}>
                手动下载安装包时，若 Windows 提示"已保护你的电脑"，请点击"更多信息 → 仍要运行"；推荐直接使用应用内更新。
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 当前版本更新日志弹框（release-notes.md 中当前版本小节） */}
      {notesOpen && (
        <div className="st-notes-mask" onClick={() => setNotesOpen(false)}>
          <div className="st-notes-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-notes-title">当前版本 v{appVersion} 更新日志</div>
            {notesLoading ? (
              <div className="st-hint">读取中…</div>
            ) : notes ? (
              <div className="st-notes-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{notes}</ReactMarkdown>
              </div>
            ) : (
              <div className="st-hint">未找到当前版本的更新日志</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
