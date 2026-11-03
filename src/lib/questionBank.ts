import { PACKS, SUBJECT_META } from '../data/demo'
import type {
  Question,
  QuestionImage,
  SpeechPrompt,
  SubjectId,
} from '../types'
import { syncQuestionsToServer } from './serverSync'
import { QUESTION_BANK_STORAGE_KEY } from './storageKeys'

const MAX_QUESTIONS = 500
const SUBJECTS: SubjectId[] = ['english', 'math', 'physics']
const DIFFICULTIES: Question['difficulty'][] = ['基础', '中等', '提升']

export interface ImportResult {
  questions: Question[]
  errors: string[]
}

function isSubject(value: unknown): value is SubjectId {
  return typeof value === 'string' && SUBJECTS.includes(value as SubjectId)
}

function isDifficulty(value: unknown): value is Question['difficulty'] {
  return typeof value === 'string' && DIFFICULTIES.includes(value as Question['difficulty'])
}

function isSpeechPrompt(value: unknown): value is SpeechPrompt {
  if (!value || typeof value !== 'object') return false
  const speech = value as Partial<SpeechPrompt>
  return (
    typeof speech.text === 'string' &&
    (speech.lang === 'en-US' || speech.lang === 'en-GB') &&
    (speech.task === 'word' || speech.task === 'meaning')
  )
}

function isQuestionImage(value: unknown): value is QuestionImage {
  if (!value || typeof value !== 'object') return false
  const image = value as Partial<QuestionImage>
  return typeof image.src === 'string' && typeof image.alt === 'string'
}

function isStoredQuestion(value: unknown): value is Question {
  if (!value || typeof value !== 'object') return false
  const question = value as Partial<Question>
  return (
    typeof question.id === 'string' &&
    isSubject(question.subject) &&
    typeof question.prompt === 'string' &&
    Array.isArray(question.options) &&
    question.options.length === 4 &&
    question.options.every((option) => typeof option === 'string') &&
    typeof question.correctIndex === 'number' &&
    question.correctIndex >= 0 &&
    question.correctIndex < 4 &&
    (question.kind === 'text' || question.kind === 'speech') &&
    typeof question.topic === 'string' &&
    isDifficulty(question.difficulty) &&
    (!question.speech || isSpeechPrompt(question.speech)) &&
    (!question.image || isQuestionImage(question.image))
  )
}

function createQuestionId() {
  const randomPart =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `local-${Date.now()}-${randomPart}`
}

function normalizeSubject(value: unknown): SubjectId | null {
  if (isSubject(value)) return value
  if (value === '英语') return 'english'
  if (value === '数学') return 'math'
  if (value === '物理') return 'physics'
  return null
}

function normalizeDifficulty(value: unknown): Question['difficulty'] {
  return isDifficulty(value) ? value : '中等'
}

function normalizeCorrectIndex(value: unknown, options: string[]): number {
  if (typeof value === 'number' && value >= 0 && value < 4) return value
  const text = String(value ?? '').trim()
  const letter = text.toUpperCase().match(/^[A-D]/)?.[0]
  if (letter) return letter.charCodeAt(0) - 65
  if (/^[1-4]$/.test(text)) return Number(text) - 1
  const optionIndex = options.findIndex((option) => option.trim() === text)
  return optionIndex >= 0 ? optionIndex : 0
}

export function loadCustomQuestions(): Question[] {
  try {
    const saved = window.localStorage.getItem(QUESTION_BANK_STORAGE_KEY)
    if (!saved) return []
    const parsed = JSON.parse(saved) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isStoredQuestion).slice(0, MAX_QUESTIONS).map((question) => ({
      ...question,
      source: 'local',
    }))
  } catch {
    return []
  }
}

export function saveCustomQuestions(questions: Question[]) {
  const normalized = questions
    .filter((question) => question.source === 'local')
    .slice(0, MAX_QUESTIONS)
  window.localStorage.setItem(QUESTION_BANK_STORAGE_KEY, JSON.stringify(normalized))
  syncQuestionsToServer(normalized)
}

export function getQuestionsForSubject(subject: SubjectId): Question[] {
  return [
    ...loadCustomQuestions().filter((question) => question.subject === subject),
    ...PACKS[subject].questions.map((question) => ({ ...question, source: 'official' as const })),
  ]
}

export function upsertCustomQuestion(question: Question): Question[] {
  const current = loadCustomQuestions()
  const nextQuestion: Question = {
    ...question,
    source: 'local',
    updatedAt: new Date().toISOString(),
  }
  const next = current.some((item) => item.id === question.id)
    ? current.map((item) => (item.id === question.id ? nextQuestion : item))
    : [nextQuestion, ...current]
  saveCustomQuestions(next)
  return next
}

export function deleteCustomQuestion(id: string): Question[] {
  const next = loadCustomQuestions().filter((question) => question.id !== id)
  saveCustomQuestions(next)
  return next
}

export function createLocalQuestion(input: Omit<Question, 'id' | 'source'>): Question {
  const now = new Date().toISOString()
  return {
    ...input,
    id: createQuestionId(),
    source: 'local',
    createdAt: now,
    updatedAt: now,
  }
}

export function serializeQuestions(questions: Question[]): string {
  return JSON.stringify(
    questions.map((question) => ({
      subject: question.subject,
      prompt: question.prompt,
      options: question.options,
      correctIndex: question.correctIndex,
      kind: question.kind,
      speech: question.speech,
      image: question.image,
      topic: question.topic,
      difficulty: question.difficulty,
    })),
    null,
    2,
  )
}

function fromImportedObject(value: unknown, fallbackSubject: SubjectId): Question | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<Question>
  const subject = normalizeSubject(raw.subject) ?? fallbackSubject
  const options = Array.isArray(raw.options)
    ? raw.options.slice(0, 4).map((option) => String(option).trim())
    : []
  const prompt = String(raw.prompt ?? '').trim()
  const topic = String(raw.topic ?? '').trim()
  if (!prompt || !topic || options.length !== 4 || options.some((option) => !option)) return null

  const kind = raw.kind === 'speech' ? 'speech' : 'text'
  const speech = kind === 'speech' && isSpeechPrompt(raw.speech) ? raw.speech : undefined
  if (kind === 'speech' && !speech) return null
  const now = new Date().toISOString()

  return {
    id: createQuestionId(),
    subject,
    prompt,
    helper: typeof raw.helper === 'string' ? raw.helper : undefined,
    options,
    correctIndex: normalizeCorrectIndex(raw.correctIndex, options),
    kind,
    speech,
    image: isQuestionImage(raw.image) ? raw.image : undefined,
    topic,
    difficulty: normalizeDifficulty(raw.difficulty),
    source: 'local',
    createdAt: now,
    updatedAt: now,
  }
}

function parseDelimitedLine(
  line: string,
  fallbackSubject: SubjectId,
): Question | null {
  const fields = (line.includes('\t') ? line.split('\t') : line.split(/\s+\|\s+/))
    .map((field) => field.trim())
  if (fields.length !== 8 && fields.length !== 9) return null

  const hasSubject = fields.length === 9
  const subject = hasSubject ? normalizeSubject(fields[0]) : fallbackSubject
  if (!subject) return null
  const offset = hasSubject ? 1 : 0
  const [prompt, optionA, optionB, optionC, optionD, answer, topic, difficulty] =
    fields.slice(offset)
  const options = [optionA, optionB, optionC, optionD]
  if (!prompt || options.some((option) => !option) || !topic) return null

  return {
    id: createQuestionId(),
    subject,
    prompt,
    options,
    correctIndex: normalizeCorrectIndex(answer, options),
    kind: 'text',
    topic,
    difficulty: normalizeDifficulty(difficulty),
    source: 'local',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export function parseQuestionImport(text: string, fallbackSubject: SubjectId): ImportResult {
  const trimmed = text.trim()
  if (!trimmed) return { questions: [], errors: ['没有可导入的内容'] }

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { questions?: unknown }).questions)
          ? (parsed as { questions: unknown[] }).questions
          : []
      const questions = list
        .map((value) => fromImportedObject(value, fallbackSubject))
        .filter((question) => question !== null)
      return {
        questions,
        errors:
          questions.length === list.length
            ? []
            : [`JSON 中共 ${list.length} 条，成功识别 ${questions.length} 条`],
      }
    } catch {
      return { questions: [], errors: ['JSON 格式不正确'] }
    }
  }

  const questions: Question[] = []
  const errors: string[] = []
  trimmed.split(/\r?\n/).forEach((line, index) => {
    const value = line.trim()
    if (!value || value.startsWith('#')) return
    if (/^(学科\s*[|	]|题干\s*[|	])/.test(value)) return
    const question = parseDelimitedLine(value, fallbackSubject)
    if (question) {
      questions.push(question)
    } else {
      errors.push(`第 ${index + 1} 行格式不完整`)
    }
  })

  return {
    questions,
    errors: questions.length === 0 ? ['至少需要一行完整题目', ...errors] : errors,
  }
}

export function subjectDisplayName(subject: SubjectId) {
  return SUBJECT_META[subject].short
}
