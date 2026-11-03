import type { CSSProperties } from 'react'
import type { PracticeAttempt, PracticeRun } from '../types'
import { MathText } from './MathText'

interface PracticeResultProps {
  attempt: PracticeAttempt
  run: PracticeRun
  syncState: 'saving' | 'saved' | 'local'
  onRetry: () => void
  onExit: () => void
  onClassroom: () => void
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`
}

function scoreLabel(score: number) {
  if (score >= 90) return '表现很稳，继续保持'
  if (score >= 75) return '基础扎实，再巩固错题'
  if (score >= 60) return '已经过关，重点回看错题'
  return '先把错题弄懂，再来一轮'
}

export function PracticeResult({
  attempt,
  run,
  syncState,
  onRetry,
  onExit,
  onClassroom,
}: PracticeResultProps) {
  const questionById = new Map(run.questions.map((question) => [question.id, question]))
  const wrongCount = attempt.questionCount - attempt.correctCount

  return (
    <div className="practice-mobile-shell practice-result-screen">
      <header className="practice-result-header">
        <div>
          <span>RESULT · {run.mode === 'practice' ? '练习完成' : '测试交卷'}</span>
          <h1>{attempt.studentName}，本轮结束</h1>
          <p>{attempt.className} · {attempt.packTitle}</p>
        </div>
        <span className={`practice-sync-state is-${syncState}`}>
          <i />
          {syncState === 'saving'
            ? '正在保存成绩'
            : syncState === 'saved'
              ? '成绩已写入本机服务'
              : '已保存在本机，联网后会自动补交'}
        </span>
      </header>

      <main className="practice-result-body">
        <section className={`practice-score-card ${attempt.score >= 80 ? 'is-great' : ''}`}>
          <div
            className="practice-score-orbit"
            style={{ '--score-progress': `${attempt.score * 3.6}deg` } as CSSProperties}
          >
            <span>SCORE</span>
            <strong>{attempt.score}</strong>
            <small>分</small>
          </div>
          <div className="practice-score-copy">
            <span>本轮评价</span>
            <h2>{scoreLabel(attempt.score)}</h2>
            <p>共 {attempt.questionCount} 题，答对 {attempt.correctCount} 题，错题 {wrongCount} 题。</p>
          </div>
          <div className="practice-result-stats">
            <div>
              <strong>{attempt.correctCount}</strong>
              <span>答对</span>
            </div>
            <div>
              <strong>{wrongCount}</strong>
              <span>答错</span>
            </div>
            <div>
              <strong>{formatDuration(attempt.totalElapsedMs)}</strong>
              <span>总用时</span>
            </div>
          </div>
        </section>

        <section className="practice-review-card">
          <div className="practice-review-heading">
            <div>
              <span>ANSWER REVIEW</span>
              <strong>答题回看</strong>
            </div>
            <span>{run.mode === 'practice' ? '练习模式' : '测试模式答案已公开'}</span>
          </div>

          <div className="practice-review-list">
            {attempt.answers.map((answer, index) => {
              const question = questionById.get(answer.questionId)
              if (!question) return null
              const correctLetter = String.fromCharCode(65 + question.correctIndex)
              const selectedLetter =
                answer.selectedOriginalIndex === null
                  ? '未答'
                  : String.fromCharCode(65 + answer.selectedOriginalIndex)
              return (
                <article
                  key={`${answer.questionId}-${index}`}
                  className={answer.correct ? 'is-correct' : 'is-wrong'}
                >
                  <span className="practice-review-index">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <div className="practice-review-meta">
                      <span>{question.topic}</span>
                      <i>{answer.correct ? '答对' : answer.timedOut ? '超时' : '答错'}</i>
                    </div>
                    <strong className="practice-review-prompt">
                      <MathText text={question.prompt} />
                    </strong>
                    <p>
                      你的答案：{selectedLetter} · 正确答案：{correctLetter}
                    </p>
                    <div className="practice-review-correct-option">
                      <span>{correctLetter}</span>
                      <strong><MathText text={question.options[question.correctIndex]} /></strong>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      </main>

      <footer className="practice-result-actions">
        <button type="button" className="practice-result-secondary" onClick={onExit}>
          重新选择
        </button>
        <button type="button" className="practice-result-secondary" onClick={onClassroom}>
          回到课堂主界面
        </button>
        <button type="button" className="practice-result-primary" onClick={onRetry}>
          再练一次
          <span aria-hidden="true">↻</span>
        </button>
      </footer>
    </div>
  )
}
