import { useCallback, useEffect, useState } from 'react'
import type { BackupInfo, ServerAdminStatus } from '../types'

interface ServerAdminPanelProps {
  onClose: () => void
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatUptime(totalSeconds: number) {
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  return `${Math.max(1, minutes)} 分钟`
}

function formatDate(value: string | null | undefined) {
  if (!value) return '尚未生成'
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function adminRequest<T>(
  path: string,
  options: { method?: string } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.method && options.method !== 'GET'
        ? { 'X-XYZ-Request': '1' }
        : {}),
    },
  })
  if (!response.ok) {
    let message = `服务响应异常（${response.status}）`
    try {
      const payload = await response.json() as { error?: unknown }
      if (typeof payload.error === 'string') message = payload.error
    } catch {
      // Keep the generic response status.
    }
    throw new Error(message)
  }
  return await response.json() as T
}

export function ServerAdminPanel({ onClose }: ServerAdminPanelProps) {
  const [status, setStatus] = useState<ServerAdminStatus | null>(null)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [backingUp, setBackingUp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextStatus, nextBackups] = await Promise.all([
        adminRequest<ServerAdminStatus>('/api/admin/status'),
        adminRequest<BackupInfo[]>('/api/admin/backups'),
      ])
      setStatus(nextStatus)
      setBackups(nextBackups)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取服务器状态')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const createBackup = async () => {
    if (backingUp) return
    setBackingUp(true)
    setError(null)
    setNotice(null)
    try {
      const created = await adminRequest<BackupInfo>('/api/admin/backups', {
        method: 'POST',
      })
      setNotice(`已生成备份：${created.name}`)
      await reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '手动备份失败')
    } finally {
      setBackingUp(false)
    }
  }

  const latest = status?.latestBackup ?? backups[0] ?? null
  const databaseTotal = (status?.databaseBytes ?? 0) + (status?.walBytes ?? 0)

  return (
    <div className="server-admin-backdrop" role="presentation">
      <section
        className="server-admin-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="server-admin-title"
      >
        <header className="server-admin-header">
          <div>
            <span>SERVER OPS · 本机服务运维</span>
            <h1 id="server-admin-title">这台笔记本的运行状态</h1>
            <p>查看 SQLite、自动备份与运行时长；所有数据只保存在这台服务器笔记本。</p>
          </div>
          <div className={`server-admin-live ${status?.autoBackup ? 'is-active' : ''}`}>
            <i />
            <span>{loading ? '正在连接' : error ? '连接异常' : '服务在线'}</span>
            {!loading && status && <strong>v{status.version}</strong>}
          </div>
          <button type="button" className="server-admin-close" onClick={onClose}>
            关闭
          </button>
        </header>

        <main className="server-admin-body">
          <section className="server-admin-hero">
            <div className="server-admin-hero-copy">
              <span>UPTIME · 连续运行</span>
              <strong>{status ? formatUptime(status.uptimeSeconds) : '读取中'}</strong>
              <p>
                {status
                  ? `自 ${formatDate(status.startedAt)} 启动 · ${status.service}`
                  : '正在读取本机服务信息'}
              </p>
            </div>
            <div className="server-admin-backup-action">
              <span>AUTO BACKUP</span>
              <strong>{status?.autoBackup ? '自动备份已开启' : '自动备份未开启'}</strong>
              <small>最近：{formatDate(latest?.modifiedAt)}</small>
              <button
                type="button"
                onClick={() => void createBackup()}
                disabled={backingUp || loading || !status?.autoBackup}
              >
                {backingUp ? '正在生成备份…' : '立即备份现在'}
                <i aria-hidden="true">↗</i>
              </button>
            </div>
          </section>

          <section className="server-admin-metrics" aria-label="服务器数据概况">
            <article>
              <span>SQLITE 数据</span>
              <strong>{formatBytes(databaseTotal)}</strong>
              <small>主库 {formatBytes(status?.databaseBytes ?? 0)} · WAL {formatBytes(status?.walBytes ?? 0)}</small>
            </article>
            <article>
              <span>备份数量</span>
              <strong>{status?.backupCount ?? 0}</strong>
              <small>默认保留最近 30 份</small>
            </article>
            <article>
              <span>最近备份</span>
              <strong>{latest ? formatBytes(latest.sizeBytes) : '暂无'}</strong>
              <small>{latest ? formatDate(latest.modifiedAt) : '首次自动备份尚未完成'}</small>
            </article>
            <article>
              <span>运行环境</span>
              <strong>本机存储</strong>
              <small>不依赖 Cloudflare 才能上课</small>
            </article>
          </section>

          <section className="server-admin-storage">
            <div className="server-admin-section-heading">
              <div>
                <span>STORAGE MAP · 数据位置</span>
                <strong>数据与备份目录</strong>
              </div>
              <button type="button" onClick={() => void reload()} disabled={loading}>
                {loading ? '刷新中…' : '刷新状态'}
              </button>
            </div>
            <div className="server-admin-path-grid">
              <div>
                <span>数据库</span>
                <code>{status?.databasePath ?? '读取中…'}</code>
              </div>
              <div>
                <span>备份目录</span>
                <code>{status?.backupDir || '尚未启用自动备份'}</code>
              </div>
            </div>
          </section>

          <section className="server-admin-history">
            <div className="server-admin-section-heading">
              <div>
                <span>BACKUP HISTORY · 快照记录</span>
                <strong>最近的数据库备份</strong>
              </div>
              <span>{backups.length} 份快照</span>
            </div>
            <div className="server-admin-backup-list">
              {loading ? (
                <div className="server-admin-empty">
                  <span>SYNC</span>
                  <strong>正在读取备份记录</strong>
                </div>
              ) : backups.length === 0 ? (
                <div className="server-admin-empty">
                  <span>NO SNAPSHOT</span>
                  <strong>还没有备份</strong>
                  <p>点击“立即备份现在”生成第一份安全快照。</p>
                </div>
              ) : (
                backups.slice(0, 10).map((backup, index) => (
                  <article key={backup.name}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <strong>{backup.name}</strong>
                      <small>{formatDate(backup.modifiedAt)}</small>
                    </div>
                    <b>{formatBytes(backup.sizeBytes)}</b>
                  </article>
                ))
              )}
            </div>
          </section>
        </main>

        <footer className="server-admin-footer">
          <div>
            {error && <span className="server-admin-error" role="alert">{error}</span>}
            {notice && <span className="server-admin-notice" role="status">{notice}</span>}
            {!error && !notice && <span>备份文件不会通过公网自动下载，请在这台笔记本的数据目录中管理。</span>}
          </div>
          <button type="button" onClick={onClose}>返回课堂</button>
        </footer>
      </section>
    </div>
  )
}
