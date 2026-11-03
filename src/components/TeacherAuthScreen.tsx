import { useState, type FormEvent } from 'react'
import {
  AuthRequestError,
  loginTeacher,
  setupTeacherPassword,
} from '../lib/auth'

type AuthMode = 'login' | 'setup' | 'setup-blocked'

interface TeacherAuthScreenProps {
  mode: AuthMode
  serverLabel: string
  onAuthenticated: () => Promise<void>
  onRetry: () => void
}

export function TeacherAuthScreen({
  mode,
  serverLabel,
  onAuthenticated,
  onRetry,
}: TeacherAuthScreenProps) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isSetup = mode === 'setup'
  const blocked = mode === 'setup-blocked'

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting || blocked) return
    setError(null)
    if (password.length < 8) {
      setError('密码至少需要 8 个字符。')
      return
    }
    if (isSetup && password !== confirmPassword) {
      setError('两次输入的密码不一致。')
      return
    }
    setSubmitting(true)
    try {
      if (isSetup) await setupTeacherPassword(password)
      else await loginTeacher(password)
      await onAuthenticated()
    } catch (reason) {
      if (reason instanceof AuthRequestError) {
        setError(reason.message)
      } else {
        setError('无法连接本机服务，请确认服务端正在运行。')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="teacher-auth-screen">
      <div className="teacher-auth-grid" aria-hidden="true" />
      <section className="teacher-auth-story">
        <div className="teacher-auth-brand">
          <span className="brand-split"><i /><i /></span>
          <div>
            <strong>题场</strong>
            <span>TEACHER CONSOLE</span>
          </div>
        </div>
        <div className="teacher-auth-hero-copy">
          <span>CLASSROOM ARENA · 教师工作台</span>
          <h1>上课即开场，<br /><em>好题随时上场。</em></h1>
          <p>题库、班级、课堂 PK 与手机练习集中在这一台办公室笔记本中。学生入口保持轻量，教师数据单独上锁。</p>
        </div>
        <div className="teacher-auth-features">
          <div><strong>01</strong><span>题库与题包</span><small>只允许教师修改</small></div>
          <div><strong>02</strong><span>班级与成绩</span><small>本机 SQLite 保存</small></div>
          <div><strong>03</strong><span>学生练习</span><small>独立公开入口</small></div>
        </div>
        <div className="teacher-auth-server">
          <i />
          <span>当前入口</span>
          <strong>{serverLabel}</strong>
        </div>
      </section>

      <section className="teacher-auth-card">
        <div className="teacher-auth-lock" aria-hidden="true">
          <span />
          <i />
        </div>
        <div className="teacher-auth-heading">
          <span>{blocked ? 'SETUP LOCKED' : isSetup ? 'FIRST RUN' : 'WELCOME BACK'}</span>
          <h2>{blocked ? '请先在本机设置密码' : isSetup ? '设置教师密码' : '进入教师工作台'}</h2>
          <p>
            {blocked
              ? '为了安全，首次密码只能在这台服务器笔记本上设置。'
              : isSetup
                ? '这是第一次启动。设置后，题库、班级和成绩接口将被保护。'
                : '输入教师密码后继续。登录状态会在这台设备保留 30 天。'}
          </p>
        </div>

        {blocked ? (
          <div className="teacher-auth-blocked">
            <strong>在办公室笔记本上打开</strong>
            <code>http://127.0.0.1:8787</code>
            <p>完成首次设置后，再回到当前域名登录。</p>
            <button type="button" onClick={onRetry}>重新检查</button>
          </div>
        ) : (
          <form className="teacher-auth-form" onSubmit={(event) => void handleSubmit(event)}>
            <label>
              <span>{isSetup ? '新密码' : '教师密码'}</span>
              <div className="teacher-password-field">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={isSetup ? 'new-password' : 'current-password'}
                  minLength={8}
                  maxLength={128}
                  autoFocus
                  placeholder={isSetup ? '至少 8 个字符' : '输入教师密码'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                >
                  {showPassword ? '隐藏' : '显示'}
                </button>
              </div>
            </label>
            {isSetup && (
              <label>
                <span>确认密码</span>
                <div className="teacher-password-field">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    placeholder="再输入一次"
                  />
                </div>
              </label>
            )}
            {error && <div className="teacher-auth-error" role="alert">{error}</div>}
            <button
              type="submit"
              className="teacher-auth-submit"
              disabled={submitting || !password || (isSetup && !confirmPassword)}
            >
              <span>
                <small>{isSetup ? 'CREATE PASSWORD' : 'TEACHER ACCESS'}</small>
                <strong>
                  {submitting
                    ? '正在验证…'
                    : isSetup
                      ? '保存密码并进入'
                      : '登录教师工作台'}
                </strong>
              </span>
              <i aria-hidden="true">→</i>
            </button>
          </form>
        )}

        <div className="teacher-auth-footnote">
          <span>学生练习入口</span>
          <a href="/practice">打开 /practice →</a>
        </div>
      </section>
    </div>
  )
}
