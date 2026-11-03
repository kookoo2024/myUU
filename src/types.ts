export type SubjectId = 'english' | 'math' | 'physics'

export type QuestionKind = 'text' | 'speech'

export type QuestionMode = 'same' | 'different'

export interface Student {
  id: string
  number: number
  name: string
}

export interface Classroom {
  id: string
  name: string
  students: Student[]
}

export interface ClassroomDirectory {
  version: 1
  activeClassId: string
  classrooms: Classroom[]
}

export interface SpeechPrompt {
  text: string
  lang: 'en-US' | 'en-GB'
  task: 'word' | 'meaning'
}

export interface QuestionImage {
  src: string
  alt: string
  caption?: string
}

export interface Question {
  id: string
  subject: SubjectId
  prompt: string
  helper?: string
  options: string[]
  correctIndex: number
  kind: QuestionKind
  speech?: SpeechPrompt
  image?: QuestionImage
  topic: string
  difficulty: '基础' | '中等' | '提升'
  source?: 'official' | 'local'
  createdAt?: string
  updatedAt?: string
}

export interface PackDefinition {
  id?: string
  subject: SubjectId
  title: string
  subtitle: string
  rangeLabel: string
  accent: string
  defaultSeconds: number
  defaultQuestionCount: number
  questionCountOptions: number[]
  secondsOptions: number[]
  questions: Question[]
}

export interface MatchSettings {
  subject: SubjectId
  questionCount: number
  secondsPerQuestion: number
  questionMode: QuestionMode
  shuffleOptions: boolean
}

export interface PlayerAnswer {
  questionId: string
  selectedOriginalIndex: number | null
  correct: boolean
  timedOut: boolean
  remainingMs: number
  elapsedMs: number
}

export type PlayerSide = 'left' | 'right'

export interface PlayerState {
  side: PlayerSide
  student: Student
  questions: Question[]
  optionOrders: number[][]
  cursor: number
  score: number
  correctCount: number
  totalElapsedMs: number
  answers: PlayerAnswer[]
  status: 'active' | 'feedback' | 'done'
  deadline: number | null
  feedbackUntil: number | null
  feedback: PlayerAnswer | null
}

export type SyncStatus = 'idle' | 'waiting' | 'playing' | 'ready' | 'unavailable'

export interface MatchState {
  players: Record<PlayerSide, PlayerState>
  settings: MatchSettings
  now: number
  syncIndex: number | null
  syncStatus: SyncStatus
  syncMessage: string | null
}

export interface MatchResult {
  left: PlayerState
  right: PlayerState
  settings: MatchSettings
  winner: PlayerSide | 'tie'
  tieBreak: 'correct' | 'time' | 'tie'
}

export type PracticeMode = 'practice' | 'test'

export interface PracticeAnswer {
  questionId: string
  topic: string
  selectedOriginalIndex: number | null
  correct: boolean
  timedOut: boolean
  elapsedMs: number
}

export interface PracticeAttempt {
  id: string
  classId: string
  className: string
  studentId: string
  studentNumber: number
  studentName: string
  subject: SubjectId
  packTitle: string
  mode: PracticeMode
  questionCount: number
  correctCount: number
  score: number
  totalElapsedMs: number
  startedAt: string
  completedAt: string
  answers: PracticeAnswer[]
}

export interface PracticeRun {
  classroom: Classroom
  student: Student
  pack: PackDefinition
  mode: PracticeMode
  secondsPerQuestion: number
  questions: Question[]
  startedAt: string
}

export interface BackupInfo {
  name: string
  path: string
  sizeBytes: number
  modifiedAt: string
}

export interface ServerAdminStatus {
  service: string
  version: string
  startedAt: string
  uptimeSeconds: number
  dataDir: string
  databasePath: string
  databaseBytes: number
  walBytes: number
  autoBackup: boolean
  backupDir: string
  backupCount: number
  latestBackup: BackupInfo | null
  serverTime: string
}

export interface UpdateStatus {
  enabled: boolean
  repository: string
  currentVersion: string
  managedRunner: boolean
  preparedVersion: string
  pendingVersion: string
  canInstall: boolean
  lastCheckedAt: string
}

export interface UpdateCheck extends UpdateStatus {
  latestVersion: string
  updateAvailable: boolean
  releaseUrl: string
  publishedAt: string
  notes: string
}
