import { PACKS } from '../data/demo'
import type {
  MatchResult,
  MatchSettings,
  MatchState,
  PackDefinition,
  PlayerAnswer,
  PlayerSide,
  PlayerState,
  Question,
  Student,
} from '../types'
import { shuffleWithSeed } from './random'

const FEEDBACK_MS = 620

function createOptionOrders(
  questions: Question[],
  side: PlayerSide,
  shuffle: boolean,
  sessionSeed: string,
): number[][] {
  return questions.map((question, index) => {
    const identity = question.options.map((_, optionIndex) => optionIndex)
    if (!shuffle) return identity
    return shuffleWithSeed(identity, `${sessionSeed}-${side}-${question.id}-${index}`)
  })
}

function buildTrack(
  settings: MatchSettings,
  side: PlayerSide,
  pack: PackDefinition,
): Question[] {
  if (pack.id?.startsWith('custom-')) {
    const source = pack.questions.slice(0, settings.questionCount)
    let questions = source

    if (side === 'right' && settings.questionMode === 'different') {
      const nonSpeech = pack.questions.filter((question) => question.kind !== 'speech')
      if (nonSpeech.length > 0) {
        let nonSpeechIndex = 1
        questions = source.map((question) => {
          if (question.kind === 'speech') return question
          const replacement = nonSpeech[nonSpeechIndex % nonSpeech.length]
          nonSpeechIndex += 1
          return replacement ?? question
        })
      }
    }

    return questions.map((question, index) => ({
      ...question,
      id: `${question.id}-${side}-${index}`,
    }))
  }

  const normalQuestions = pack.questions.filter((question) => question.kind !== 'speech')
  const speechQuestion = pack.questions.find((question) => question.kind === 'speech')
  const offset = side === 'right' && settings.questionMode === 'different' ? 1 : 0

  const questions = Array.from({ length: settings.questionCount }, (_, index) => {
    const question = normalQuestions[(index + offset) % normalQuestions.length]
    return { ...question, id: `${question.id}-${side}-${index}` }
  })

  if (settings.subject === 'english' && speechQuestion && settings.questionCount >= 3) {
    questions[1] = { ...speechQuestion, id: `${speechQuestion.id}-${side}-sync` }
  }

  return questions
}

function resolveSyncIndex(settings: MatchSettings, pack: PackDefinition): number | null {
  if (settings.subject !== 'english') return null

  if (pack.id?.startsWith('custom-')) {
    const index = pack.questions
      .slice(0, settings.questionCount)
      .findIndex((question) => question.kind === 'speech')
    return index >= 0 ? index : null
  }

  const hasSpeech = pack.questions.some((question) => question.kind === 'speech')
  return settings.questionCount >= 3 && hasSpeech ? 1 : null
}

function createPlayer(
  side: PlayerSide,
  student: Student,
  settings: MatchSettings,
  pack: PackDefinition,
  now: number,
  syncIndex: number | null,
  sessionSeed: string,
): PlayerState {
  const questions = buildTrack(settings, side, pack)
  const waitingForAudio = syncIndex === 0

  return {
    side,
    student,
    questions,
    optionOrders: createOptionOrders(questions, side, settings.shuffleOptions, sessionSeed),
    cursor: 0,
    score: 0,
    correctCount: 0,
    totalElapsedMs: 0,
    answers: [],
    status: 'active',
    deadline: waitingForAudio ? null : now + settings.secondsPerQuestion * 1000,
    feedbackUntil: null,
    feedback: null,
  }
}

export function createMatch(
  leftStudent: Student,
  rightStudent: Student,
  settings: MatchSettings,
  pack: PackDefinition = PACKS[settings.subject],
  now = performance.now(),
): MatchState {
  const syncIndex = resolveSyncIndex(settings, pack)
  const sessionSeed = Math.random().toString(36).slice(2)

  return {
    players: {
      left: createPlayer('left', leftStudent, settings, pack, now, syncIndex, sessionSeed),
      right: createPlayer('right', rightStudent, settings, pack, now, syncIndex, sessionSeed),
    },
    settings,
    now,
    syncIndex,
    syncStatus: syncIndex === null ? 'idle' : 'waiting',
    syncMessage: null,
  }
}

function finishAnswer(
  state: MatchState,
  side: PlayerSide,
  answer: PlayerAnswer,
  now: number,
): MatchState {
  const player = state.players[side]
  return {
    ...state,
    now,
    players: {
      ...state.players,
      [side]: {
        ...player,
        answers: [...player.answers, answer],
        score: player.score + (answer.correct ? 100 : 0),
        correctCount: player.correctCount + (answer.correct ? 1 : 0),
        totalElapsedMs: player.totalElapsedMs + answer.elapsedMs,
        status: 'feedback',
        deadline: null,
        feedbackUntil: now + FEEDBACK_MS,
        feedback: answer,
      },
    },
  }
}

function advancePlayer(state: MatchState, side: PlayerSide, now: number): MatchState {
  const player = state.players[side]
  const nextCursor = player.cursor + 1

  if (nextCursor >= player.questions.length) {
    return {
      ...state,
      players: {
        ...state.players,
        [side]: {
          ...player,
          status: 'done',
          deadline: null,
          feedback: null,
          feedbackUntil: null,
        },
      },
    }
  }

  const waitingForAudio =
    state.syncIndex === nextCursor && state.syncStatus !== 'ready' && state.syncStatus !== 'unavailable'

  return {
    ...state,
    players: {
      ...state.players,
      [side]: {
        ...player,
        cursor: nextCursor,
        status: 'active',
        deadline: waitingForAudio ? null : now + state.settings.secondsPerQuestion * 1000,
        feedback: null,
        feedbackUntil: null,
      },
    },
  }
}

export type MatchAction =
  | { type: 'tick'; now: number }
  | { type: 'answer'; side: PlayerSide; originalIndex: number; now: number }
  | { type: 'sync-start'; now: number }
  | { type: 'sync-ready'; now: number }
  | { type: 'sync-unavailable'; now: number; message: string }

export function matchReducer(state: MatchState, action: MatchAction): MatchState {
  if (action.type === 'answer') {
    const player = state.players[action.side]
    const question = player.questions[player.cursor]
    if (!question || player.status !== 'active' || player.deadline === null) return state
    if (
      state.syncIndex === player.cursor &&
      state.syncStatus !== 'ready' &&
      state.syncStatus !== 'unavailable'
    ) {
      return state
    }

    const remainingMs = Math.max(0, player.deadline - action.now)
    const elapsedMs = Math.max(
      0,
      state.settings.secondsPerQuestion * 1000 - remainingMs,
    )
    const answer: PlayerAnswer = {
      questionId: question.id,
      selectedOriginalIndex: action.originalIndex,
      correct: action.originalIndex === question.correctIndex,
      timedOut: false,
      remainingMs,
      elapsedMs,
    }

    return finishAnswer(state, action.side, answer, action.now)
  }

  if (action.type === 'sync-start') {
    if (state.syncStatus !== 'waiting') return state
    return { ...state, now: action.now, syncStatus: 'playing', syncMessage: null }
  }

  if (action.type === 'sync-ready') {
    const players = { ...state.players }
    ;(['left', 'right'] as const).forEach((side) => {
      const player = players[side]
      if (player.cursor === state.syncIndex && player.status === 'active') {
        players[side] = {
          ...player,
          deadline: action.now + state.settings.secondsPerQuestion * 1000,
        }
      }
    })
    return { ...state, now: action.now, players, syncStatus: 'ready', syncMessage: null }
  }

  if (action.type === 'sync-unavailable') {
    const players = { ...state.players }
    ;(['left', 'right'] as const).forEach((side) => {
      const player = players[side]
      if (player.cursor === state.syncIndex && player.status === 'active') {
        players[side] = {
          ...player,
          deadline: action.now + state.settings.secondsPerQuestion * 1000,
        }
      }
    })
    return {
      ...state,
      now: action.now,
      players,
      syncStatus: 'unavailable',
      syncMessage: action.message,
    }
  }

  let nextState: MatchState = { ...state, now: action.now }

  for (const side of ['left', 'right'] as const) {
    const player = nextState.players[side]
    if (player.status === 'done') continue

    if (
      player.status === 'feedback' &&
      player.feedbackUntil !== null &&
      action.now >= player.feedbackUntil
    ) {
      nextState = advancePlayer(nextState, side, action.now)
      continue
    }

    if (
      player.status === 'active' &&
      player.deadline !== null &&
      action.now >= player.deadline
    ) {
      const question = player.questions[player.cursor]
      nextState = finishAnswer(
        nextState,
        side,
        {
          questionId: question.id,
          selectedOriginalIndex: null,
          correct: false,
          timedOut: true,
          remainingMs: 0,
          elapsedMs: nextState.settings.secondsPerQuestion * 1000,
        },
        action.now,
      )
    }
  }

  return nextState
}

export function calculateResult(state: MatchState): MatchResult {
  const left = state.players.left
  const right = state.players.right

  if (left.correctCount > right.correctCount) {
    return { left, right, settings: state.settings, winner: 'left', tieBreak: 'correct' }
  }
  if (right.correctCount > left.correctCount) {
    return { left, right, settings: state.settings, winner: 'right', tieBreak: 'correct' }
  }
  if (left.totalElapsedMs < right.totalElapsedMs) {
    return { left, right, settings: state.settings, winner: 'left', tieBreak: 'time' }
  }
  if (right.totalElapsedMs < left.totalElapsedMs) {
    return { left, right, settings: state.settings, winner: 'right', tieBreak: 'time' }
  }
  return { left, right, settings: state.settings, winner: 'tie', tieBreak: 'tie' }
}

export function remainingMs(state: MatchState, side: PlayerSide): number {
  const deadline = state.players[side].deadline
  return deadline === null ? 0 : Math.max(0, deadline - state.now)
}

export function isBothWaitingForAudio(state: MatchState): boolean {
  if (state.syncIndex === null) return false
  return (
    state.players.left.cursor === state.syncIndex &&
    state.players.right.cursor === state.syncIndex &&
    state.players.left.status === 'active' &&
    state.players.right.status === 'active'
  )
}
