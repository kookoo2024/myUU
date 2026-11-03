import type { Classroom, ClassroomDirectory, Question, SubjectId } from '../types'
import {
  APPLIED_PACK_STORAGE_KEY,
  CLASSROOM_DIRECTORY_STORAGE_KEY,
  CLASSROOM_STORAGE_KEY,
  PACK_DRAFTS_STORAGE_KEY,
  QUESTION_BANK_STORAGE_KEY,
} from './storageKeys'

export type ServerStatus = 'checking' | 'online' | 'offline'

interface ServerBootstrap {
  classroom: unknown
  classroomDirectory?: unknown
  questions: unknown[]
  packDrafts: Record<string, unknown>
  appliedPack: string
  hasData: boolean
}

let status: ServerStatus = 'checking'
const listeners = new Set<() => void>()
const syncTimers = new Map<string, number>()

export function getServerStatus(): ServerStatus {
  return status
}

export function subscribeServerStatus(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setStatus(next: ServerStatus) {
  if (status === next) return
  status = next
  listeners.forEach((listener) => listener())
}

export function markServerOnline() {
  setStatus('online')
}

export function markServerOffline() {
  setStatus('offline')
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; timeoutMs?: number; keepalive?: boolean } = {},
): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 4000)
  const method = options.method ?? 'GET'
  const hasBody = options.body !== undefined
  const needsWriteMarker = method !== 'GET' && method !== 'HEAD'
  try {
    const response = await fetch(path, {
      method,
      headers: {
        Accept: 'application/json',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...(needsWriteMarker ? { 'X-XYZ-Request': '1' } : {}),
      },
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      keepalive: options.keepalive,
    })
    const contentType = response.headers.get('content-type') ?? ''
    if (!response.ok || !contentType.includes('application/json')) {
      throw new Error(`服务端响应异常：${response.status}`)
    }
    return await response.json() as T
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function hydratePracticeCacheFromServer(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
    setStatus('offline')
    return false
  }
  try {
    const bootstrap = await request<ServerBootstrap>('/api/practice/bootstrap', {
      timeoutMs: 1800,
    })
    if (bootstrap.classroomDirectory) {
      const directory = bootstrap.classroomDirectory as ClassroomDirectory
      window.localStorage.setItem(
        CLASSROOM_DIRECTORY_STORAGE_KEY,
        JSON.stringify(directory),
      )
      const activeClassroom =
        directory.classrooms.find((item) => item.id === directory.activeClassId) ??
        directory.classrooms[0]
      if (activeClassroom) {
        window.localStorage.setItem(
          CLASSROOM_STORAGE_KEY,
          JSON.stringify(activeClassroom),
        )
      }
    }
    window.localStorage.setItem(
      QUESTION_BANK_STORAGE_KEY,
      JSON.stringify(Array.isArray(bootstrap.questions) ? bootstrap.questions : []),
    )
    window.localStorage.setItem(
      PACK_DRAFTS_STORAGE_KEY,
      JSON.stringify(bootstrap.packDrafts ?? {}),
    )
    if (bootstrap.appliedPack) {
      window.localStorage.setItem(APPLIED_PACK_STORAGE_KEY, bootstrap.appliedPack)
    } else {
      window.localStorage.removeItem(APPLIED_PACK_STORAGE_KEY)
    }
    setStatus('online')
    return true
  } catch {
    setStatus('offline')
    return false
  }
}

export async function hydrateLocalCacheFromServer(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
    setStatus('offline')
    return false
  }

  try {
    const bootstrap = await request<ServerBootstrap>('/api/bootstrap', {
      timeoutMs: 1200,
    })
    if (bootstrap.hasData) {
      if (bootstrap.classroomDirectory) {
        const directory = bootstrap.classroomDirectory as ClassroomDirectory
        window.localStorage.setItem(
          CLASSROOM_DIRECTORY_STORAGE_KEY,
          JSON.stringify(directory),
        )
        const activeClassroom =
          directory.classrooms.find((item) => item.id === directory.activeClassId) ??
          directory.classrooms[0]
        if (activeClassroom) {
          window.localStorage.setItem(
            CLASSROOM_STORAGE_KEY,
            JSON.stringify(activeClassroom),
          )
        }
      } else if (bootstrap.classroom) {
        const classroom = bootstrap.classroom as Classroom
        window.localStorage.setItem(
          CLASSROOM_STORAGE_KEY,
          JSON.stringify(classroom),
        )
        window.localStorage.setItem(
          CLASSROOM_DIRECTORY_STORAGE_KEY,
          JSON.stringify({
            version: 1,
            activeClassId: classroom.id,
            classrooms: [classroom],
          } satisfies ClassroomDirectory),
        )
      }
      window.localStorage.setItem(
        QUESTION_BANK_STORAGE_KEY,
        JSON.stringify(Array.isArray(bootstrap.questions) ? bootstrap.questions : []),
      )
      window.localStorage.setItem(
        PACK_DRAFTS_STORAGE_KEY,
        JSON.stringify(bootstrap.packDrafts ?? {}),
      )
      if (bootstrap.appliedPack) {
        window.localStorage.setItem(APPLIED_PACK_STORAGE_KEY, bootstrap.appliedPack)
      } else {
        window.localStorage.removeItem(APPLIED_PACK_STORAGE_KEY)
      }
      setStatus('online')
      return true
    }

    const localRequests: Promise<unknown>[] = []
    const classroomDirectory =
      readLocalJSON<ClassroomDirectory>(CLASSROOM_DIRECTORY_STORAGE_KEY) ??
      (() => {
        const classroom = readLocalJSON<Classroom>(CLASSROOM_STORAGE_KEY)
        return classroom
          ? {
              version: 1,
              activeClassId: classroom.id,
              classrooms: [classroom],
            } satisfies ClassroomDirectory
          : null
      })()
    const questions = readLocalJSON<Question[]>(QUESTION_BANK_STORAGE_KEY)
    const drafts = readLocalJSON<Record<string, unknown>>(PACK_DRAFTS_STORAGE_KEY)
    const appliedPack = window.localStorage.getItem(APPLIED_PACK_STORAGE_KEY)
    if (classroomDirectory) {
      localRequests.push(
        request('/api/classrooms', { method: 'PUT', body: classroomDirectory }),
      )
    }
    if (Array.isArray(questions) && questions.length > 0) {
      localRequests.push(request('/api/questions', { method: 'PUT', body: questions }))
    }
    if (drafts && Object.keys(drafts).length > 0) {
      localRequests.push(request('/api/pack-drafts', { method: 'PUT', body: drafts }))
    }
    if (appliedPack) {
      localRequests.push(
        request('/api/applied-pack', { method: 'PUT', body: { subject: appliedPack } }),
      )
    }
    await Promise.allSettled(localRequests)
    setStatus('online')
    return true
  } catch {
    setStatus('offline')
    return false
  }
}

function readLocalJSON<T>(key: string): T | null {
  try {
    const value = window.localStorage.getItem(key)
    return value ? JSON.parse(value) as T : null
  } catch {
    return null
  }
}

function runSync(key: string, requestFactory: () => Promise<unknown>, delayMs = 0) {
  const previous = syncTimers.get(key)
  if (previous !== undefined) window.clearTimeout(previous)

  const timer = window.setTimeout(() => {
    syncTimers.delete(key)
    void requestFactory()
      .then(() => setStatus('online'))
      .catch(() => setStatus('offline'))
  }, delayMs)
  syncTimers.set(key, timer)
}

export function syncClassroomDirectoryToServer(directory: ClassroomDirectory) {
  runSync('classroom-directory', () => request('/api/classrooms', {
    method: 'PUT',
    body: directory,
    keepalive: true,
  }))
}

export function syncQuestionsToServer(questions: Question[]) {
  runSync('questions', () => request('/api/questions', {
    method: 'PUT',
    body: questions,
    keepalive: true,
  }))
}

export function syncPackDraftsToServer(drafts: Partial<Record<SubjectId, unknown>>) {
  runSync('pack-drafts', () => request('/api/pack-drafts', {
    method: 'PUT',
    body: drafts,
  }), 180)
}

export function syncAppliedPackToServer(subject: SubjectId | null, draft?: unknown) {
  runSync('applied-pack', () => request('/api/applied-pack', {
    method: subject ? 'PUT' : 'DELETE',
    body: subject ? { subject, ...(draft ? { draft } : {}) } : undefined,
    keepalive: true,
  }))
}
