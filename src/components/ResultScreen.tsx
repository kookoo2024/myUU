import type { MatchResult } from '../types'
import type { CSSProperties } from 'react'

interface ResultScreenProps {
  result: MatchResult
  matchLabel: string
  onNextMatch: () => void
  onReplay: () => void
  onBackToSetup: () => void
}

function averageSeconds(totalMs: number, count: number): string {
  if (!count) return '0.0'
  return (totalMs / count / 1000).toFixed(1)
}

export function ResultScreen({
  result,
  matchLabel,
  onNextMatch,
  onReplay,
  onBackToSetup,
}: ResultScreenProps) {
  const winner =
    result.winner === 'left'
      ? result.left
      : result.winner === 'right'
        ? result.right
        : null

  return (
    <div className="result-screen">
      <div className="result-rays" aria-hidden="true" />
      <div className="result-confetti" aria-hidden="true">
        {Array.from({ length: 18 }).map((_, index) => (
          <i key={index} style={{ '--i': index } as CSSProperties} />
        ))}
      </div>

      <header className="result-header">
        <span>课前双人 PK</span>
        <strong>{matchLabel}</strong>
      </header>

      <main className="result-main">
        <div className="winner-crown" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <span className="result-eyebrow">{result.winner === 'tie' ? '平分秋色' : '本场胜者'}</span>
        <h1>{winner?.student.name ?? '双方战平'}</h1>
        <p className="result-summary-line">
          {result.winner === 'tie'
            ? '正确题数与总用时完全相同'
            : `正确题数 ${winner?.correctCount} 题 · 总用时 ${((winner?.totalElapsedMs ?? 0) / 1000).toFixed(1)} 秒`}
        </p>
        {result.tieBreak === 'time' && (
          <p className="result-tiebreak">正确题数相同，按累计答题用时判定胜负</p>
        )}

        <div className="result-scoreboard">
          {[result.left, result.right].map((player, index) => (
            <article
              key={player.student.id}
              className={`result-player result-player--${index === 0 ? 'left' : 'right'} ${
                result.winner === player.side ? 'is-winner' : ''
              }`}
            >
              <div className="result-player-topline">
                <span className="side-stamp">{index === 0 ? '左' : '右'}</span>
                <span>NO. {String(player.student.number).padStart(2, '0')}</span>
                {result.winner === player.side && <em>WINNER</em>}
              </div>
              <h2>{player.student.name}</h2>
              <div className="result-big-number">
                {player.correctCount}
                <small> / {player.questions.length} 题</small>
              </div>
              <dl>
                <div>
                  <dt>得分</dt>
                  <dd>{player.score}</dd>
                </div>
                <div>
                  <dt>平均用时</dt>
                  <dd>{averageSeconds(player.totalElapsedMs, player.answers.length)} s</dd>
                </div>
                <div>
                  <dt>超时</dt>
                  <dd>{player.answers.filter((answer) => answer.timedOut).length}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </main>

      <footer className="result-actions">
        <button type="button" className="result-secondary" onClick={onBackToSetup}>
          返回准备
        </button>
        <button type="button" className="result-secondary" onClick={onReplay}>
          同组再来
        </button>
        <button type="button" className="result-primary" onClick={onNextMatch}>
          下一场 →
        </button>
      </footer>
    </div>
  )
}
