import { useEffect, useState } from 'react'
import App from './App'
import { TeacherAuthScreen } from './components/TeacherAuthScreen'
import {
  checkTeacherSession,
  logoutTeacher,
  type TeacherSessionCheck,
} from './lib/auth'
import {
  hydrateLocalCacheFromServer,
  markServerOffline,
} from './lib/serverSync'

type GateState =
  | { phase: 'checking' }
  | { phase: 'app'; authenticated: boolean }
  | {
      phase: 'auth'
      mode: 'login' | 'setup' | 'setup-blocked'
    }

export default function TeacherAppRoot() {
  const [gate, setGate] = useState<GateState>({ phase: 'checking' })

  const enterApp = async (authenticated: boolean) => {
    setGate({ phase: 'checking' })
    if (authenticated) {
      await hydrateLocalCacheFromServer()
    } else {
      markServerOffline()
    }
    setGate({ phase: 'app', authenticated })
  }

  const applySessionCheck = async (result: TeacherSessionCheck) => {
    if (result.state === 'authenticated') {
      await enterApp(true)
      return
    }
    if (result.state === 'offline') {
      await enterApp(false)
      return
    }
    setGate({ phase: 'auth', mode: result.state })
  }

  const check = async () => {
    setGate({ phase: 'checking' })
    await applySessionCheck(await checkTeacherSession())
  }

  useEffect(() => {
    void check()
  }, [])

  const handleLogout = async () => {
    await logoutTeacher()
    setGate({ phase: 'auth', mode: 'login' })
  }

  if (gate.phase === 'checking') {
    return (
      <div className="teacher-auth-screen teacher-auth-screen--checking">
        <div className="teacher-auth-grid" aria-hidden="true" />
        <div className="teacher-auth-checking-card">
          <span className="teacher-auth-spinner" aria-hidden="true" />
          <strong>正在检查教师工作台</strong>
          <p>连接本机 SQLite，并确认这台设备是否已经登录。</p>
        </div>
      </div>
    )
  }

  if (gate.phase === 'auth') {
    return (
      <TeacherAuthScreen
        mode={gate.mode}
        serverLabel={window.location.host}
        onAuthenticated={() => enterApp(true)}
        onRetry={() => void check()}
      />
    )
  }

  return <App onLogout={gate.authenticated ? handleLogout : undefined} />
}
