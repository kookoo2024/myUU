export interface TeacherSessionStatus {
  authenticated: boolean
  setupRequired: boolean
  setupAllowed: boolean
}

export type TeacherSessionCheck =
  | { state: 'authenticated'; session: TeacherSessionStatus }
  | { state: 'login'; session: TeacherSessionStatus }
  | { state: 'setup'; session: TeacherSessionStatus }
  | { state: 'setup-blocked'; session: TeacherSessionStatus }
  | { state: 'offline'; session: null }

export class AuthRequestError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'AuthRequestError'
    this.status = status
  }
}

const AUTH_TIMEOUT_MS = 3_000

async function authRequest(
  path: string,
  options: { method?: string; password?: string } = {},
): Promise<Response> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS)
  try {
    return await fetch(path, {
      method: options.method ?? 'GET',
      headers: options.password === undefined
        ? {
            Accept: 'application/json',
            ...(options.method && options.method !== 'GET'
              ? { 'X-XYZ-Request': '1' }
              : {}),
          }
        : {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-XYZ-Request': '1',
          },
      body: options.password === undefined
        ? undefined
        : JSON.stringify({ password: options.password }),
      signal: controller.signal,
    })
  } finally {
    window.clearTimeout(timeout)
  }
}

async function readError(response: Response) {
  try {
    const payload = await response.json() as { error?: unknown }
    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error
    }
  } catch {
    // Use the generic message below.
  }
  if (response.status === 429) return '密码尝试次数过多，请稍后再试'
  return `登录服务响应异常（${response.status}）`
}

function normalizeSession(value: unknown): TeacherSessionStatus {
  const session = value as Partial<TeacherSessionStatus> | null
  return {
    authenticated: session?.authenticated === true,
    setupRequired: session?.setupRequired === true,
    setupAllowed: session?.setupAllowed === true,
  }
}

export async function checkTeacherSession(): Promise<TeacherSessionCheck> {
  try {
    const response = await authRequest('/api/auth/session')
    if (response.status >= 500) return { state: 'offline', session: null }
    if (!response.ok) return { state: 'offline', session: null }
    const session = normalizeSession(await response.json() as unknown)
    if (session.authenticated) return { state: 'authenticated', session }
    if (session.setupRequired) {
      return {
        state: session.setupAllowed ? 'setup' : 'setup-blocked',
        session,
      }
    }
    return { state: 'login', session }
  } catch {
    return { state: 'offline', session: null }
  }
}

async function submitPassword(
  path: '/api/auth/login' | '/api/auth/setup',
  password: string,
) {
  const response = await authRequest(path, { method: 'POST', password })
  if (!response.ok) {
    throw new AuthRequestError(await readError(response), response.status)
  }
}

export async function loginTeacher(password: string) {
  await submitPassword('/api/auth/login', password)
}

export async function setupTeacherPassword(password: string) {
  await submitPassword('/api/auth/setup', password)
}

export async function logoutTeacher() {
  try {
    await authRequest('/api/auth/logout', { method: 'POST' })
  } catch {
    // A failed logout still returns the UI to the login screen.
  }
}
