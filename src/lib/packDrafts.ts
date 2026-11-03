import { PACKS, SUBJECT_META } from '../data/demo'
import type { PackDefinition, SubjectId } from '../types'
import { getQuestionsForSubject } from './questionBank'
import { syncAppliedPackToServer, syncPackDraftsToServer } from './serverSync'
import {
  APPLIED_PACK_STORAGE_KEY,
  PACK_DRAFTS_STORAGE_KEY,
} from './storageKeys'

const MAX_QUESTIONS = 10

export interface PackDraft {
  subject: SubjectId
  title: string
  questionIds: string[]
  secondsPerQuestion: number
  updatedAt: string
}

export type PackDraftMap = Partial<Record<SubjectId, PackDraft>>

const SUBJECTS: SubjectId[] = ['english', 'math', 'physics']

function isSubject(value: unknown): value is SubjectId {
  return typeof value === 'string' && SUBJECTS.includes(value as SubjectId)
}

function isPackDraft(value: unknown): value is PackDraft {
  if (!value || typeof value !== 'object') return false
  const draft = value as Partial<PackDraft>
  return (
    isSubject(draft.subject) &&
    typeof draft.title === 'string' &&
    Array.isArray(draft.questionIds) &&
    draft.questionIds.every((id) => typeof id === 'string') &&
    typeof draft.secondsPerQuestion === 'number' &&
    typeof draft.updatedAt === 'string'
  )
}

export function loadPackDrafts(): PackDraftMap {
  try {
    const saved = window.localStorage.getItem(PACK_DRAFTS_STORAGE_KEY)
    if (!saved) return {}
    const parsed = JSON.parse(saved) as unknown
    if (!parsed || typeof parsed !== 'object') return {}

    return Object.fromEntries(
      Object.entries(parsed).filter(([subject, draft]) => isSubject(subject) && isPackDraft(draft)),
    ) as PackDraftMap
  } catch {
    return {}
  }
}

export function savePackDraft(draft: PackDraft) {
  const drafts = loadPackDrafts()
  drafts[draft.subject] = {
    ...draft,
    title: draft.title.trim(),
    questionIds: [...new Set(draft.questionIds)].slice(0, MAX_QUESTIONS),
  }
  window.localStorage.setItem(PACK_DRAFTS_STORAGE_KEY, JSON.stringify(drafts))
  syncPackDraftsToServer(drafts)
}

export function markPackApplied(subject: SubjectId) {
  window.localStorage.setItem(APPLIED_PACK_STORAGE_KEY, subject)
  syncAppliedPackToServer(subject, loadPackDrafts()[subject])
}

export function clearAppliedPack() {
  window.localStorage.removeItem(APPLIED_PACK_STORAGE_KEY)
  syncAppliedPackToServer(null)
}

export function buildPackFromDraft(draft: PackDraft): PackDefinition | null {
  const source = PACKS[draft.subject]
  const questionMap = new Map(
    getQuestionsForSubject(draft.subject).map((question) => [question.id, question]),
  )
  const questions = [...new Set(draft.questionIds)]
    .map((id) => questionMap.get(id))
    .filter((question) => question !== undefined)
    .slice(0, MAX_QUESTIONS)

  if (questions.length < 2) return null

  const countOptions = [...new Set([4, 6, 8, questions.length])]
    .filter((count) => count <= questions.length)
    .sort((left, right) => left - right)
  const secondsOptions =
    draft.subject === 'english' ? [5, 7, 10] : [15, 30, 45]
  const topics = [...new Set(questions.map((question) => question.topic))]
  const rangeLabel =
    topics.length <= 3
      ? topics.join(' · ')
      : `${topics.slice(0, 3).join(' · ')} 等 ${topics.length} 个知识点`
  const difficulties = [...new Set(questions.map((question) => question.difficulty))]
  const title = draft.title.trim() || `${SUBJECT_META[draft.subject].short}自选题包`

  return {
    id: `custom-${draft.subject}`,
    subject: draft.subject,
    title,
    subtitle: `自选题包 · ${questions.length} 道题 · ${difficulties.join(' / ')}`,
    rangeLabel,
    accent: source.accent,
    defaultSeconds: secondsOptions.includes(draft.secondsPerQuestion)
      ? draft.secondsPerQuestion
      : source.defaultSeconds,
    defaultQuestionCount: Math.min(6, questions.length),
    questionCountOptions: countOptions,
    secondsOptions,
    questions,
  }
}

export function loadAppliedPack(): PackDefinition | null {
  try {
    const subject = window.localStorage.getItem(APPLIED_PACK_STORAGE_KEY)
    if (!isSubject(subject)) return null
    const draft = loadPackDrafts()[subject]
    return draft ? buildPackFromDraft(draft) : null
  } catch {
    return null
  }
}
