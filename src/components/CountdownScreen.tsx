import { useEffect, useRef, useState } from 'react'
import { PACKS, SUBJECT_META } from '../data/demo'
import type { MatchSettings, Student } from '../types'

const COUNTDOWN_STEPS = [10, 5, 3, 0] as const
const STEP_DURATION_MS = 850

interface CountdownScreenProps {
  leftStudent: Student
  rightStudent: Student
  settings: MatchSettings
  onComplete: () => void
}

export function CountdownScreen({
  leftStudent,
  rightStudent,
  settings,
  onComplete,
}: CountdownScreenProps) {
  const [count, setCount] = useState<number>(COUNTDOWN_STEPS[0])
  const completed = useRef(false)
  const pack = PACKS[settings.subject]
  const meta = SUBJECT_META[settings.subject]

  useEffect(() => {
    if (count === 0) {
      if (completed.current) return
      const timer = window.setTimeout(() => {
        if (completed.current) return
        completed.current = true
        onComplete()
      }, STEP_DURATION_MS)
      return () => window.clearTimeout(timer)
    }

    const stepIndex = COUNTDOWN_STEPS.indexOf(count as (typeof COUNTDOWN_STEPS)[number])
    const timer = window.setTimeout(
      () => setCount(COUNTDOWN_STEPS[stepIndex + 1]),
      STEP_DURATION_MS,
    )
    return () => window.clearTimeout(timer)
  }, [count, onComplete])

  return (
    <div className="countdown-screen">
      <div className="countdown-grid" aria-hidden="true" />
      <div className="countdown-effects" aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => <i key={index} />)}
      </div>
      <div className="countdown-round">
        <span>ROUND 01</span>
        <i />
        <strong>LIVE BATTLE</strong>
      </div>
      <div className="countdown-subject">
        <span>{meta.mark}</span>
        {pack.title}
      </div>

      <div className="versus-board">
        <article className="versus-player versus-player--left">
          <div className="versus-player-topline">
            <span className="side-stamp">左</span>
            <small>PLAYER 01 · NO. {String(leftStudent.number).padStart(2, '0')}</small>
            <em>READY</em>
          </div>
          <h1>{leftStudent.name}</h1>
          <div className="versus-energy">
            <span><i /></span>
            <strong>ENERGY 100%</strong>
          </div>
        </article>

        <div className="countdown-center">
          <div className="countdown-rings" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <div
            key={count}
            className={`countdown-number ${count === 0 ? 'is-go' : ''}`}
            aria-live="assertive"
          >
            {count === 0 ? 'GO!' : count}
          </div>
          <strong className="countdown-battle-cry">
            {count === 0 ? '巅峰对决，开始！' : '准备进入战场'}
          </strong>
          <span>每题 {settings.secondsPerQuestion} 秒 · 双方独立推进</span>
        </div>

        <article className="versus-player versus-player--right">
          <div className="versus-player-topline">
            <span className="side-stamp">右</span>
            <small>PLAYER 02 · NO. {String(rightStudent.number).padStart(2, '0')}</small>
            <em>READY</em>
          </div>
          <h1>{rightStudent.name}</h1>
          <div className="versus-energy">
            <span><i /></span>
            <strong>ENERGY 100%</strong>
          </div>
        </article>
      </div>
    </div>
  )
}
