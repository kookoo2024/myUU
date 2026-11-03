import { useEffect, useReducer, useRef } from 'react'
import type {
  MatchResult,
  MatchSettings,
  PackDefinition,
  PlayerSide,
  Student,
} from '../types'
import {
  calculateResult,
  createMatch,
  isBothWaitingForAudio,
  matchReducer,
} from '../lib/match'
import { speakEnglish } from '../lib/speech'

interface UseDuelEngineOptions {
  leftStudent: Student
  rightStudent: Student
  settings: MatchSettings
  pack: PackDefinition
  onFinish: (result: MatchResult) => void
}

export function useDuelEngine({
  leftStudent,
  rightStudent,
  settings,
  pack,
  onFinish,
}: UseDuelEngineOptions) {
  const [state, dispatch] = useReducer(
    matchReducer,
    undefined,
    () => createMatch(leftStudent, rightStudent, settings, pack),
  )
  const syncStarted = useRef(false)
  const finishQueued = useRef(false)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    const timer = window.setInterval(() => {
      dispatch({ type: 'tick', now: performance.now() })
    }, 100)
    return () => {
      window.clearInterval(timer)
      window.speechSynthesis?.cancel()
    }
  }, [])

  useEffect(() => {
    if (
      state.syncIndex === null ||
      syncStarted.current ||
      !isBothWaitingForAudio(state)
    ) {
      return
    }

    syncStarted.current = true
    dispatch({ type: 'sync-start', now: performance.now() })

    const speech = state.players.left.questions[state.syncIndex]?.speech
    if (!speech) {
      dispatch({
        type: 'sync-unavailable',
        now: performance.now(),
        message: '听力题缺少朗读文本，已自动开始计时',
      })
      return
    }

    void speakEnglish({
      text: speech.text,
      lang: speech.lang,
      rate: 0.82,
    })
      .then(() => {
        dispatch({ type: 'sync-ready', now: performance.now() })
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '浏览器语音播放失败'
        dispatch({
          type: 'sync-unavailable',
          now: performance.now(),
          message: `${message}，已自动开始答题`,
        })
      })
  }, [state])

  const bothDone =
    state.players.left.status === 'done' && state.players.right.status === 'done'

  useEffect(() => {
    if (!bothDone || finishQueued.current) return

    finishQueued.current = true
    window.setTimeout(() => {
      onFinish(calculateResult(stateRef.current))
    }, 850)
  }, [bothDone, onFinish])

  const answer = (side: PlayerSide, originalIndex: number) => {
    dispatch({ type: 'answer', side, originalIndex, now: performance.now() })
  }

  return { state, answer }
}
