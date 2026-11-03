import { useCallback, useEffect, useMemo, useState } from 'react'
import { SUBJECT_META } from '../data/demo'
import {
  loadPracticeAttempts,
  PRACTICE_SYNC_EVENT,
} from '../lib/practiceResults'
import type { Classroom, PracticeAttempt } from '../types'

interface PracticeRecordsProps {
  classrooms: Classroom[]
  initialClassId: string
  onClose: () => void
}

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(milliseconds: number) {
  const seconds = Math.round(milliseconds / 1000)
  if (seconds < 60) return `${seconds} 秒`
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

export function PracticeRecords({
  classrooms,
  initialClassId,
  onClose,
}: PracticeRecordsProps) {
  const [classId, setClassId] = useState(initialClassId)
  const [attempts, setAttempts] = useState<PracticeAttempt[]>([])
  const [source, setSource] = useState<'server' | 'local' | 'merged'>('local')
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    const result = await loadPracticeAttempts({ classId, limit: 120 })
    setAttempts(result.attempts)
    setSource(result.source)
    setPendingCount(result.pendingCount)
    setLoading(false)
  }, [classId])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    const handleAutoSync = () => {
      void reload()
    }
    window.addEventListener(PRACTICE_SYNC_EVENT, handleAutoSync)
    return () => window.removeEventListener(PRACTICE_SYNC_EVENT, handleAutoSync)
  }, [reload])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const summary = useMemo(() => {
    const uniqueStudents = new Set(attempts.map((attempt) => attempt.studentId))
    const averageScore =
      attempts.length === 0
        ? 0
        : Math.round(
            attempts.reduce((sum, attempt) => sum + attempt.score, 0) /
              attempts.length,
          )
    return {
      uniqueStudents: uniqueStudents.size,
      averageScore,
      questionTotal: attempts.reduce(
        (sum, attempt) => sum + attempt.questionCount,
        0,
      ),
    }
  }, [attempts])

  return (
    <div className="practice-records-backdrop" role="presentation">
      <section
        className="practice-records-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="practice-records-title"
      >
        <header className="practice-records-header">
          <div>
            <span>PRACTICE DATA · 学情记录</span>
            <h1 id="practice-records-title">单人练习与测试记录</h1>
            <p>在线成绩直接写入本机 SQLite；离线成绩联网后自动补交，并在这里合并显示。</p>
          </div>
          <div className={`practice-records-source is-${source}`}>
            <i />
            <span>
              {source === 'server'
                ? 'SQLite 实时记录'
                : source === 'merged'
                  ? `SQLite + ${pendingCount} 条待补交`
                  : `当前设备缓存 · ${pendingCount} 条待补交`}
            </span>
          </div>
          <button type="button" className="practice-records-close" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="practice-records-toolbar">
          <label>
            <span>查看班级</span>
            <select
              aria-label="练习记录班级"
              value={classId}
              onChange={(event) => setClassId(event.target.value)}
            >
              {classrooms.map((classroom) => (
                <option key={classroom.id} value={classroom.id}>
                  {classroom.name}
                </option>
              ))}
            </select>
          </label>
          <div className="practice-records-summary">
            <div><strong>{attempts.length}</strong><span>场练习</span></div>
            <div><strong>{summary.uniqueStudents}</strong><span>名学生</span></div>
            <div><strong>{summary.averageScore}</strong><span>平均分</span></div>
            <div><strong>{summary.questionTotal}</strong><span>累计题目</span></div>
          </div>
          <button type="button" onClick={() => void reload()} disabled={loading}>
            {loading ? '读取中…' : '刷新记录'}
          </button>
        </div>

        <div className="practice-records-list">
          {loading ? (
            <div className="practice-records-empty">
              <span>SYNC</span>
              <strong>正在读取练习记录</strong>
              <p>优先从本机服务读取，服务不可用时显示本浏览器缓存。</p>
            </div>
          ) : attempts.length === 0 ? (
            <div className="practice-records-empty">
              <span>NO RECORD</span>
              <strong>这个班级还没有练习记录</strong>
              <p>点击主界面的“手机练习”打开学生端，选择学生后即可开始。</p>
            </div>
          ) : (
            attempts.map((attempt, index) => (
              <article key={attempt.id} className="practice-record-card">
                <span className="practice-record-order">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="practice-record-student">
                  <span>{String(attempt.studentNumber).padStart(2, '0')}</span>
                  <div>
                    <strong>{attempt.studentName}</strong>
                    <small>{attempt.className} · {formatTime(attempt.completedAt)}</small>
                  </div>
                </div>
                <div className="practice-record-pack">
                  <span>{SUBJECT_META[attempt.subject].short}</span>
                  <div>
                    <strong>{attempt.packTitle}</strong>
                    <small>
                      {attempt.mode === 'practice' ? '练习模式' : '测试模式'} · {attempt.questionCount} 题 · {formatDuration(attempt.totalElapsedMs)}
                    </small>
                  </div>
                </div>
                <div className="practice-record-result">
                  <strong>{attempt.score}</strong>
                  <span>分</span>
                  <small>{attempt.correctCount}/{attempt.questionCount} 正确</small>
                </div>
              </article>
            ))
          )}
        </div>

        <footer className="practice-records-footer">
          <span>
            记录最多展示最近 120 场；当前数据来源：
            {source === 'server'
              ? '本机 SQLite'
              : source === 'merged'
                ? '本机 SQLite 与本浏览器待同步成绩'
                : '本浏览器缓存'}。
          </span>
          <button type="button" onClick={onClose}>返回课堂</button>
        </footer>
      </section>
    </div>
  )
}
