import type { CSSProperties } from 'react'
import type { MatchState, PlayerSide } from '../types'
import { remainingMs } from '../lib/match'
import { MathText } from './MathText'

interface PlayerLaneProps {
  side: PlayerSide
  state: MatchState
  onAnswer: (originalIndex: number) => void
}

const optionLetters = ['A', 'B', 'C', 'D', 'E', 'F']

function readableLength(text: string) {
  return text
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\\[a-zA-Z]+|[{}^_]/g, '')
    .length
}

export function PlayerLane({ side, state, onAnswer }: PlayerLaneProps) {
  const player = state.players[side]
  const currentQuestion = player.questions[player.cursor]
  const question = player.status === 'done' ? null : currentQuestion
  const order = player.optionOrders[player.cursor] ?? []
  const remaining = remainingMs(state, side)
  const total = state.settings.secondsPerQuestion * 1000
  const ratio = Math.max(0, Math.min(1, remaining / total))
  const seconds = Math.ceil(remaining / 1000)
  const isAudioWaiting =
    state.syncIndex === player.cursor &&
    state.syncStatus !== 'ready' &&
    state.syncStatus !== 'unavailable'
  const waitingForOpponent =
    isAudioWaiting && state.players[side === 'left' ? 'right' : 'left'].cursor !== state.syncIndex
  const locked = player.status !== 'active' || isAudioWaiting
  const progress =
    player.status === 'done'
      ? player.questions.length
      : Math.min(player.cursor, player.questions.length)
  const progressRatio = progress / player.questions.length
  let combo = 0
  for (let index = player.answers.length - 1; index >= 0; index -= 1) {
    if (!player.answers[index].correct) break
    combo += 1
  }
  const isHot = combo >= 2
  const isUrgent = player.status === 'active' && seconds <= 5
  const isLongPrompt = (question?.prompt.length ?? 0) > 48
  const longestOption = question
    ? Math.max(...question.options.map((option) => readableLength(option)))
    : 0
  const hasLongOptions = longestOption > 24
  const isDenseQuestion = Boolean(
    question &&
      ((question.image && (isLongPrompt || hasLongOptions)) ||
        (isLongPrompt && hasLongOptions) ||
        longestOption > 42),
  )
  const timerValue =
    player.status === 'done'
      ? '✓'
      : player.status === 'feedback'
        ? player.feedback?.correct
          ? '✓'
          : '×'
        : seconds
  const timerLabel =
    player.status === 'done'
      ? '完成'
      : player.status === 'feedback'
        ? '判定'
        : '秒'

  const style = {
    '--team-accent': side === 'left' ? '#f0b45a' : '#55cfd2',
    '--timer-angle': `${ratio * 360}deg`,
    '--lane-progress': `${progressRatio * 100}%`,
  } as CSSProperties

  return (
    <section
      className={[
        'player-lane',
        `player-lane--${side}`,
        isHot ? 'is-hot' : '',
        isDenseQuestion ? 'is-dense' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
    >
      <div className="lane-glow" aria-hidden="true" />

      <header className="lane-heading">
        <div className="player-identity">
          <span className="side-stamp">{side === 'left' ? '左' : '右'}</span>
          <div>
            <span className="student-number">NO. {String(player.student.number).padStart(2, '0')}</span>
            <h2>{player.student.name}</h2>
          </div>
        </div>

        <div className="lane-heading-right">
          {isHot && (
            <div key={combo} className="combo-badge" aria-label={`连续答对 ${combo} 题`}>
              <span>COMBO</span>
              <strong>×{combo}</strong>
            </div>
          )}
          <div className="lane-score" aria-live="polite">
            <span key={player.score} className="score-value">{player.score}</span>
            <span className="score-label">分</span>
          </div>
        </div>
      </header>

      <div className="lane-progress" aria-label={`已完成 ${progress} 题，共 ${player.questions.length} 题`}>
        <span />
      </div>

      <div className="question-meta">
        <span>
          {player.status === 'done'
            ? '已完成'
            : `第 ${Math.min(player.cursor + 1, player.questions.length)} / ${player.questions.length} 题`}
        </span>
        <span className="question-topic">{question?.topic ?? '本场结束'}</span>
        <span className={`difficulty difficulty--${question?.difficulty ?? '完成'}`}>
          {question?.difficulty ?? '完成'}
        </span>
      </div>

      <div
        className={[
          'question-panel',
          question?.image ? 'has-image' : '',
          isLongPrompt ? 'is-long' : '',
          hasLongOptions ? 'has-long-options' : '',
          isDenseQuestion ? 'is-dense' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        data-question={question ? `Q${Math.min(player.cursor + 1, player.questions.length)}` : 'END'}
        aria-live="polite"
      >
        {question ? (
          <div className="question-content">
            <div className="question-copy">
              {question.kind === 'speech' && (
                <div className="speech-chip">
                  <span className="sound-bars" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                  听力题
                </div>
              )}
              <h3>
                <MathText text={question.prompt} />
              </h3>
              {question.helper && <p className="question-helper">{question.helper}</p>}
            </div>
            {question.image && (
              <figure className="question-figure">
                <img src={question.image.src} alt={question.image.alt} />
                {question.image.caption && <figcaption>{question.image.caption}</figcaption>}
              </figure>
            )}
          </div>
        ) : (
          <div className="lane-finished-message">
            <span className="finish-mark">✓</span>
            <h3>本场完成</h3>
            <p>等待对手完成后统一结算</p>
          </div>
        )}
      </div>

      <div className="options-grid" role="group" aria-label="答案选项">
        {question &&
          order.map((originalIndex, displayIndex) => {
            const isSelected = player.feedback?.selectedOriginalIndex === originalIndex
            const isWrong = isSelected && player.feedback && !player.feedback.correct
            const isCorrectFlash = isSelected && player.feedback?.correct
            return (
              <button
                key={`${question.id}-${originalIndex}`}
                type="button"
                className={[
                  'answer-option',
                  isSelected ? 'is-selected' : '',
                  isWrong ? 'is-wrong' : '',
                  isCorrectFlash ? 'is-correct' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={locked}
                onClick={() => onAnswer(originalIndex)}
              >
                <span className="option-letter">{optionLetters[displayIndex]}</span>
                <span className="option-text">
                  <MathText text={question.options[originalIndex]} />
                </span>
              </button>
            )
          })}
      </div>

      <footer className="lane-timer-row">
        <div
          className={[
            'timer-orbit',
            isUrgent ? 'is-urgent' : '',
            player.status === 'feedback' ? 'is-feedback' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-label={`剩余 ${seconds} 秒`}
        >
          <div className="timer-inner">
            <strong>{timerValue}</strong>
            <span>{timerLabel}</span>
          </div>
        </div>
        <div className="lane-status-text">
          <strong>{player.correctCount} 题正确</strong>
          <span>
            {player.status === 'done'
              ? '已完成全部题目'
              : player.status === 'feedback'
                ? player.feedback?.correct
                  ? '回答正确 · 下一题'
                  : player.feedback?.timedOut
                    ? '本题超时 · 下一题'
                    : '回答错误 · 下一题'
                : isAudioWaiting
                  ? waitingForOpponent
                    ? '等待对手进入听力题'
                    : '听力同步准备中'
                  : '选择答案后立即进入下一题'}
          </span>
        </div>
      </footer>

      {isAudioWaiting && (
        <div className="waiting-curtain">
          <span className={`waiting-icon ${state.syncStatus === 'playing' ? 'is-playing' : ''}`}>
            {state.syncStatus === 'playing' ? '◉' : '⌁'}
          </span>
          <strong>
            {state.syncStatus === 'playing'
              ? '正在播放读音'
              : waitingForOpponent
                ? '等待对手到达听力题'
                : '双方听力同步中'}
          </strong>
          <span>
            {state.syncStatus === 'playing'
              ? '录音结束后自动开始倒计时'
              : '本轮只有听力题需要同步'}
          </span>
        </div>
      )}

      {player.status === 'done' && (
        <div className="lane-complete-badge">
          <span>完成</span>
          <strong>{player.correctCount} / {player.questions.length}</strong>
        </div>
      )}

      {player.feedback && (
        <div
          className={`feedback-flash ${player.feedback.correct ? 'feedback-flash--correct' : 'feedback-flash--wrong'}`}
          aria-live="assertive"
        >
          <strong>
            {player.feedback.correct
              ? '+100'
              : player.feedback.timedOut
                ? 'TIME UP'
                : 'MISS'}
          </strong>
          <small>
            {player.feedback.correct
              ? combo >= 2
                ? `${combo} COMBO`
                : 'PERFECT'
              : player.feedback.timedOut
                ? '本题超时'
                : '下一题继续'}
          </small>
        </div>
      )}
    </section>
  )
}
