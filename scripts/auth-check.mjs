import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = process.cwd()
const port = 8790
const baseUrl = `http://127.0.0.1:${port}`
const password = 'Auth-Check-Password-2026'
const tempDir = await mkdtemp(path.join(tmpdir(), 'xyz-auth-'))
const executable = path.join(tempDir, 'xyz-auth-server.exe')
const dataDir = path.join(tempDir, 'data')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  child.on('error', reject)
  child.on('exit', (code) => {
    if (code === 0) resolve()
    else reject(new Error(`${command} 退出码 ${code}`))
  })
})

async function waitForHealth(timeoutMs = 15000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('鉴权测试服务端未能启动')
}

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password }),
  })
  return response
}

await run('go', ['build', '-o', executable, './server'])
const server = spawn(executable, [], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    XYZ_ADDR: `127.0.0.1:${port}`,
    XYZ_DATA_DIR: dataDir,
    XYZ_ADMIN_PASSWORD: password,
  },
})

try {
  await waitForHealth()

  const anonymousBootstrap = await fetch(`${baseUrl}/api/bootstrap`)
  assert(anonymousBootstrap.status === 401, '未登录仍可读取教师工作台数据')

  const anonymousUpdate = await fetch(`${baseUrl}/api/admin/update`)
  assert(anonymousUpdate.status === 401, '未登录仍可读取在线更新状态')

  const anonymousInstall = await fetch(`${baseUrl}/api/admin/update/install`, {
    method: 'POST',
    headers: { 'X-XYZ-Request': '1' },
  })
  assert(anonymousInstall.status === 401, '未登录仍可触发在线更新安装')

  const publicPractice = await fetch(`${baseUrl}/api/practice/bootstrap`)
  assert(publicPractice.status === 200, '学生练习入口被错误拦截')

  const wrongLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'wrong-password' }),
  })
  assert(wrongLogin.status === 401, '错误密码没有返回 401')

  const loginResponse = await login()
  assert(loginResponse.ok, `正确密码登录失败：${loginResponse.status}`)
  const setCookie = loginResponse.headers.getSetCookie?.()[0] ??
    loginResponse.headers.get('set-cookie')
  assert(setCookie, '登录成功后没有下发会话 Cookie')
  assert(setCookie.includes('HttpOnly'), '会话 Cookie 缺少 HttpOnly')
  assert(setCookie.includes('SameSite=Strict'), '会话 Cookie 缺少 SameSite=Strict')
  const cookie = setCookie.split(';')[0]

  const authenticatedBootstrap = await fetch(`${baseUrl}/api/bootstrap`, {
    headers: { Cookie: cookie },
  })
  assert(authenticatedBootstrap.status === 200, '登录后仍无法读取教师数据')

  const classroomPayload = JSON.stringify({
    version: 1,
    activeClassId: 'auth-class',
    classrooms: [{
      id: 'auth-class',
      name: '鉴权测试班',
      students: [{ id: 'auth-s1', number: 1, name: '江屿' }],
    }],
  })
  const noMarker = await fetch(`${baseUrl}/api/classrooms`, {
    method: 'PUT',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
    },
    body: classroomPayload,
  })
  assert(noMarker.status === 403, '教师写接口缺少安全标记时仍可写入')

  const markedWrite = await fetch(`${baseUrl}/api/classrooms`, {
    method: 'PUT',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-XYZ-Request': '1',
    },
    body: classroomPayload,
  })
  assert(markedWrite.status === 200, '带安全标记的教师写请求失败')

  const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'X-XYZ-Request': '1',
    },
  })
  assert(logoutResponse.status === 200, '退出登录失败')

  const afterLogout = await fetch(`${baseUrl}/api/bootstrap`, {
    headers: { Cookie: cookie },
  })
  assert(afterLogout.status === 401, '退出登录后旧会话仍然有效')

  console.log(JSON.stringify({
    teacherDataProtected: 'passed',
    updateRoutesProtected: 'passed',
    publicPracticeRoute: 'passed',
    passwordVerification: 'passed',
    secureSessionCookie: 'passed',
    writeMarkerProtection: 'passed',
    logoutInvalidation: 'passed',
  }, null, 2))
} finally {
  server.kill()
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ])
  await rm(tempDir, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 })
}
