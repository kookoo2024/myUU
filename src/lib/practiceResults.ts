import type { PracticeAnswer, PracticeAttempt, SubjectId } from '../types'
import { markServerOffline, markServerOnline } from './serverSync'
import {
  PRACTICE_ATTEMPTS_STORAGE_KEY,
  PRACTICE_ATTEMPT_SYNC_STORAGE_KEY,
} from './storageKeys'

const MAX_LOCAL_ATTEMPTS = 200
const MAX_SYNCED_ATTEMPT_IDS = 500
const SYNC_INTERVAL_MS = 12_000
const SUBMIT_TIMEOUT_MS = 4_000
const SUBJECTS: SubjectId[] = ['english', 'math', 'physics']
export const PRACTICE_SYNC_EVENT = 'xyz-practice-sync-changed'
let flushInProgress = false
let autoSyncStarted = false

function isPracticeAnswer(value: unknown): value is PracticeAnswer {
  if (!value || typeof value !== 'object') return false
  const answer = value as Partial<PracticeAnswer>
  return (
    typeof answer.questionId === 'string' &&
    typeof answer.topic === 'string' &&
    (answer.selectedOriginalIndex === null ||
      (typeof answer.selectedOriginalIndex === 'number' &&
        answer.selectedOriginalIndex >= 0 &&
        answer.selectedOriginalIndex < 4)) &&
    typeof answer.correct === 'boolean' &&
    typeof answer.timedOut === 'boolean' &&
    typeof answer.elapsedMs === 'number' &&
    answer.elapsedMs >= 0
  )
}

function isPracticeAttempt(value: unknown): value is PracticeAttempt {
  if (!value || typeof value !== 'object') return false
  const attempt = value as Partial<PracticeAttempt>
  return (
    typeof attempt.id === 'string' &&
    typeof attempt.classId === 'string' &&
    typeof attempt.className === 'string' &&
    typeof attempt.studentId === 'string' &&
    typeof attempt.studentNumber === 'number' &&
    typeof attempt.studentName === 'string' &&
    typeof attempt.subject === 'string' &&
    SUBJECTS.includes(attempt.subject as SubjectId) &&
    typeof attempt.packTitle === 'string' &&
    (attempt.mode === 'practice' || attempt.mode === 'test') &&
    typeof attempt.questionCount === 'number' &&
    attempt.questionCount > 0 &&
    typeof attempt.correctCount === 'number' &&
    typeof attempt.score === 'number' &&
    typeof attempt.totalElapsedMs === 'number' &&
    typeof attempt.startedAt === 'string' &&
    typeof attempt.completedAt === 'string' &&
    Array.isArray(attempt.answers) &&
    attempt.answers.length === attempt.questionCount &&
    attempt.answers.every(isPracticeAnswer)
  )
}

function sortAttempts(attempts: PracticeAttempt[]) {
  return [...attempts].sort(
    (left, right) =>
      new Date(right.completedAt).getTime() - new Date(left.completedAt).getTime(),
  )
}

export function loadLocalPracticeAttempts(): PracticeAttempt[] {
  try {
    const saved = window.localStorage.getItem(PRACTICE_ATTEMPTS_STORAGE_KEY)
    if (!saved) return []
    const parsed = JSON.parse(saved) as unknown
    if (!Array.isArray(parsed)) return []
    return sortAttempts(parsed.filter(isPracticeAttempt)).slice(0, MAX_LOCAL_ATTEMPTS)
  } catch {
    return []
  }
}

function storeLocalPracticeAttempts(attempts: PracticeAttempt[]) {
  try {
    window.localStorage.setItem(
      PRACTICE_ATTEMPTS_STORAGE_KEY,
      JSON.stringify(sortAttempts(attempts).slice(0, MAX_LOCAL_ATTEMPTS)),
    )
  } catch {
    // The completed attempt remains visible in memory even when storage is full.
  }
}

export function savePracticeAttempt(attempt: PracticeAttempt) {
  const current = loadLocalPracticeAttempts().filter((item) => item.id !== attempt.id)
  storeLocalPracticeAttempts([attempt, ...current])
}

function loadSyncedAttemptIds(): Set<string> {
  try {
    const saved = window.localStorage.getItem(PRACTICE_ATTEMPT_SYNC_STORAGE_KEY)
    if (!saved) return new Set()
    const parsed = JSON.parse(saved) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((value): value is string => typeof value === 'string'))
  } catch {
    return new Set()
  }
}

function storeSyncedAttemptIds(ids: Set<string>, attempts: PracticeAttempt[]) {
  const currentIds = new Set(attempts.map((attempt) => attempt.id))
  const values = [...ids]
    .filter((id) => currentIds.has(id))
    .slice(-MAX_SYNCED_ATTEMPT_IDS)
  try {
    window.localStorage.setItem(
      PRACTICE_ATTEMPT_SYNC_STORAGE_KEY,
      JSON.stringify(values),
    )
  } catch {
    // A failed sync marker only causes an idempotent retry later.
  }
}

function markPracticeAttemptSynced(attemptId: string) {
  const attempts = loadLocalPracticeAttempts()
  const syncedIds = loadSyncedAttemptIds()
  syncedIds.add(attemptId)
  storeSyncedAttemptIds(syncedIds, attempts)
}

export function loadPendingPracticeAttempts(classId?: string): PracticeAttempt[] {
  const syncedIds = loadSyncedAttemptIds()
  return sortAttempts(
    loadLocalPracticeAttempts().filter(
      (attempt) =>
        !syncedIds.has(attempt.id) &&
        (!classId || attempt.classId === classId),
    ),
  )
}

export function countPendingPracticeAttempts(classId?: string) {
  return loadPendingPracticeAttempts(classId).length
}

async function postPracticeAttempt(attempt: PracticeAttempt): Promise<boolean> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS)
  try {
    const response = await fetch('/api/practice-attempts', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-XYZ-Request': '1',
      },
      body: JSON.stringify(attempt),
      keepalive: true,
      signal: controller.signal,
    })
    markServerOnline()
    return response.ok
  } catch {
    markServerOffline()
    return false
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function submitPracticeAttempt(attempt: PracticeAttempt): Promise<boolean> {
  savePracticeAttempt(attempt)
  const saved = await postPracticeAttempt(attempt)
  if (saved) markPracticeAttemptSynced(attempt.id)
  return saved
}

export async function flushPendingPracticeAttempts(): Promise<{
  synced: number
  pending: number
}> {
  if (flushInProgress) {
    return { synced: 0, pending: countPendingPracticeAttempts() }
  }
  flushInProgress = true
  let synced = 0
  try {
    const pendingAttempts = loadPendingPracticeAttempts()
    for (const attempt of pendingAttempts) {
      if (!(await postPracticeAttempt(attempt))) break
      markPracticeAttemptSynced(attempt.id)
      synced += 1
    }
  } finally {
    flushInProgress = false
  }
  if (synced > 0 && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PRACTICE_SYNC_EVENT))
  }
  return { synced, pending: countPendingPracticeAttempts() }
}

export function startPracticeAttemptAutoSync() {
  if (autoSyncStarted || typeof window === 'undefined') return
  autoSyncStarted = true
  const flush = () => {
    void flushPendingPracticeAttempts()
  }
  window.setInterval(flush, SYNC_INTERVAL_MS)
  window.addEventListener('online', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flush()
  })
  flush()
}

export async function loadPracticeAttempts(options: {
  classId?: string
  limit?: number
} = {}): Promise<{
  attempts: PracticeAttempt[]
  source: 'server' | 'local' | 'merged'
  pendingCount: number
}> {
  const query = new URLSearchParams()
  if (options.classId) query.set('classId', options.classId)
  query.set('limit', String(options.limit ?? 80))

  await flushPendingPracticeAttempts()
  const pendingAttempts = loadPendingPracticeAttempts(options.classId)
  const pendingCount = pendingAttempts.length

  try {
    const response = await fetch(`/api/practice-attempts?${query.toString()}`, {
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = await response.json() as unknown
    const serverAttempts = Array.isArray(payload)
      ? payload.filter(isPracticeAttempt)
      : []
    markServerOnline()
    const serverIds = new Set(serverAttempts.map((attempt) => attempt.id))
    const attempts = [
      ...serverAttempts,
      ...pendingAttempts.filter((attempt) => !serverIds.has(attempt.id)),
    ]
    return {
      attempts: sortAttempts(attempts).slice(0, options.limit ?? 80),
      source: pendingCount > 0 ? 'merged' : 'server',
      pendingCount,
    }
  } catch {
    const attempts = loadLocalPracticeAttempts().filter(
      (attempt) => !options.classId || attempt.classId === options.classId,
    )
    markServerOffline()
    return {
      attempts: sortAttempts(attempts).slice(0, options.limit ?? 80),
      source: 'local',
      pendingCount,
    }
  }
}
