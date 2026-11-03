import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { speakEnglish } from '../lib/speech'
import { shuffleWithSeed } from '../lib/random'
import type {
  PracticeAnswer,
  PracticeAttempt,
  PracticeRun,
} from '../types'
import { MathText } from './MathText'

interface PracticeSessionProps {
  run: PracticeRun
  onFinish: (attempt: PracticeAttempt) => void
  onExit: () => void
}

function createAttemptId() {
  const randomPart =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return `practice-${randomPart}`
}

function formatSeconds(milliseconds: number) {
  return Math.max(0, Math.ceil(milliseconds / 1000))
}

export function PracticeSession({ run, onFinish, onExit }: PracticeSessionProps) {
  const [questionIndex, setQuestionIndex] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [answers, setAnswers] = useState<PracticeAnswer[]>([])
  const [locked, setLocked] = useState(false)
  const [feedback, setFeedback] = useState<PracticeAnswer | null>(null)
  const [deadline, setDeadline] = useState<number | null>(() =>
    run.questions[0]?.kind === 'speech'
      ? null
      : performance.now() + run.secondsPerQuestion * 1000,
  )
  const [now, setNow] = useState(() => performance.now())
  const [speechPlaying, setSpeechPlaying] = useState(false)
  const [speechReady, setSpeechReady] = useState(
    () => run.questions[0]?.kind !== 'speech',
  )
  const [speechError, setSpeechError] = useState<string | null>(null)
  const lockedRef = useRef(false)
  const questionStartedAtRef = useRef(performance.now())

  const question = run.questions[questionIndex]
  const optionOrder = useMemo(
    () =>
      question
        ? shuffleWithSeed(
            question.options.map((_, index) => index),
            `${run.startedAt}-${question.id}-${questionIndex}`,
          )
        : [],
    [question, questionIndex, run.startedAt],
  )
  const remainingMs =
    deadline === null ? run.secondsPerQuestion * 1000 : Math.max(0, deadline - now)
  const timerProgress =
    deadline === null ? 0 : Math.max(0, Math.min(1, remainingMs / (run.secondsPerQuestion * 1000)))
  const isLastQuestion = questionIndex >= run.questions.length - 1

  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    }
  }, [])

  const commitAnswer = useCallback(
    (originalIndex: number | null, timedOut: boolean) => {
      if (lockedRef.current || !question) return
      lockedRef.current = true
      const elapsedMs = timedOut
        ? run.secondsPerQuestion * 1000
        : Math.max(0, Math.round(performance.now() - questionStartedAtRef.current))
      const answer: PracticeAnswer = {
        questionId: question.id,
        topic: question.topic,
        selectedOriginalIndex: originalIndex,
        correct: originalIndex === question.correctIndex,
        timedOut,
        elapsedMs: Math.min(elapsedMs, run.secondsPerQuestion * 1000),
      }
      setSelectedIndex(originalIndex)
      setAnswers((current) => [...current, answer])
      setFeedback(answer)
      setLocked(true)
    },
    [question, run.secondsPerQuestion],
  )

  useEffect(() => {
    if (deadline === null || lockedRef.current) return
    const timer = window.setInterval(() => {
      const current = performance.now()
      setNow(current)
      if (current >= deadline) {
        window.clearInterval(timer)
        commitAnswer(null, true)
      }
    }, 100)
    return () => window.clearInterval(timer)
  }, [commitAnswer, deadline])

  const playSpeech = async () => {
    if (!question.speech || speechPlaying || speechReady) return
    setSpeechPlaying(true)
    setSpeechError(null)
    try {
      await speakEnglish(question.speech)
    } catch {
      setSpeechError('浏览器未能播放读音，本题仍可继续作答。')
    } finally {
      questionStartedAtRef.current = performance.now()
      setNow(performance.now())
      setDeadline(performance.now() + run.secondsPerQuestion * 1000)
      setSpeechReady(true)
      setSpeechPlaying(false)
    }
  }

  const chooseOption = (originalIndex: number) => {
    if (locked || !speechReady) return
    setSelectedIndex(originalIndex)
    if (run.mode === 'practice') {
      commitAnswer(originalIndex, false)
    }
  }

  const handleNext = () => {
    const advanceToNext = () => {
      const nextIndex = questionIndex + 1
      const nextQuestion = run.questions[nextIndex]
      lockedRef.current = false
      questionStartedAtRef.current = performance.now()
      setQuestionIndex(nextIndex)
      setSelectedIndex(null)
      setFeedback(null)
      setLocked(false)
      setSpeechError(null)
      setSpeechReady(nextQuestion.kind !== 'speech')
      setDeadline(
        nextQuestion.kind === 'speech'
          ? null
          : performance.now() + run.secondsPerQuestion * 1000,
      )
      setNow(performance.now())
    }

    const finishWith = (completedAnswers: PracticeAnswer[]) => {
      const correctCount = completedAnswers.filter((answer) => answer.correct).length
      const totalElapsedMs = completedAnswers.reduce(
        (sum, answer) => sum + answer.elapsedMs,
        0,
      )
      onFinish({
        id: createAttemptId(),
        classId: run.classroom.id,
        className: run.classroom.name,
        studentId: run.student.id,
        studentNumber: run.student.number,
        studentName: run.student.name,
        subject: run.pack.subject,
        packTitle: run.pack.title,
        mode: run.mode,
        questionCount: completedAnswers.length,
        correctCount,
        score: Math.floor((correctCount * 100) / Math.max(1, completedAnswers.length)),
        totalElapsedMs,
        startedAt: run.startedAt,
        completedAt: new Date().toISOString(),
        answers: completedAnswers,
      })
    }

    if (!locked && run.mode === 'test') {
      if (selectedIndex === null) return
      const elapsedMs = Math.max(
        0,
        Math.min(
          run.secondsPerQuestion * 1000,
          Math.round(performance.now() - questionStartedAtRef.current),
        ),
      )
      const answer: PracticeAnswer = {
        questionId: question.id,
        topic: question.topic,
        selectedOriginalIndex: selectedIndex,
        correct: selectedIndex === question.correctIndex,
        timedOut: false,
        elapsedMs,
      }
      const nextAnswers = [...answers, answer]
      lockedRef.current = true
      setAnswers(nextAnswers)
      setFeedback(answer)
      setLocked(true)
      if (isLastQuestion) finishWith(nextAnswers)
      else advanceToNext()
      return
    }

    if (!locked) return
    if (isLastQuestion) finishWith(answers)
    else advanceToNext()
  }

  if (!question) {
    return (
      <div className="practice-mobile-shell">
        <section className="practice-empty">
          <h1>这个题包暂时没有可练习的题目</h1>
          <button type="button" onClick={onExit}>返回重新选择</button>
        </section>
      </div>
    )
  }

  const practiceFeedback =
    run.mode === 'practice' && locked && feedback
      ? feedback.timedOut
        ? '时间到，看看正确答案'
        : feedback.correct
          ? '答对了，继续保持'
          : '这题没答对，记住正确答案'
      : null

  return (
    <div className="practice-mobile-shell practice-session-screen">
      <header className="practice-session-header">
        <button type="button" className="practice-exit" onClick={onExit}>
          ← 退出
        </button>
        <div className="practice-session-title">
          <span>{run.student.name} · {run.mode === 'practice' ? '练习模式' : '测试模式'}</span>
          <strong>{run.pack.title}</strong>
        </div>
        <span className={`practice-mode-badge practice-mode-badge--${run.mode}`}>
          {run.mode === 'practice' ? '即时反馈' : '交卷后看答案'}
        </span>
      </header>

      <div className="practice-progress">
        <div>
          <span>PROGRESS</span>
          <strong>{String(questionIndex + 1).padStart(2, '0')} / {String(run.questions.length).padStart(2, '0')}</strong>
        </div>
        <div className="practice-progress-track">
          <i style={{ width: `${((questionIndex + 1) / run.questions.length) * 100}%` }} />
        </div>
        <div
          className={`practice-timer ${remainingMs <= 5000 && deadline !== null ? 'is-urgent' : ''}`}
          style={{ '--timer-progress': `${timerProgress * 360}deg` } as CSSProperties}
        >
          <strong>{deadline === null ? '▶' : formatSeconds(remainingMs)}</strong>
          <span>{deadline === null ? '听读音' : '秒'}</span>
        </div>
      </div>

      <main className={`practice-question-card ${question.image ? 'has-image' : ''}`}>
        <div className="practice-question-meta">
          <span>{question.topic}</span>
          <i>{question.difficulty}</i>
          {question.kind === 'speech' && <em>听力题</em>}
        </div>

        {question.kind === 'speech' && (
          <button
            type="button"
            className={`practice-speech-button ${speechPlaying ? 'is-playing' : ''}`}
            onClick={() => void playSpeech()}
            disabled={speechPlaying || speechReady}
          >
            <span aria-hidden="true">{speechPlaying ? '◉' : '▶'}</span>
            <div>
              <strong>{speechPlaying ? '正在播放读音…' : speechReady ? '读音已播放' : '点击播放英文读音'}</strong>
              <small>{speechReady ? '现在开始独立计时' : '播放结束后自动开始计时'}</small>
            </div>
          </button>
        )}

        <div className="practice-question-content">
          <div className="practice-prompt">
            <MathText text={question.prompt} />
          </div>
          {question.image && (
            <figure className="practice-question-image">
              <img src={question.image.src} alt={question.image.alt} />
              {question.image.caption && <figcaption>{question.image.caption}</figcaption>}
            </figure>
          )}
        </div>

        <div className="practice-option-grid">
          {optionOrder.map((originalIndex, visibleIndex) => {
            const isSelected = selectedIndex === originalIndex
            const isCorrectOption =
              run.mode === 'practice' && locked && originalIndex === question.correctIndex
            const isWrongSelection =
              run.mode === 'practice' && locked && isSelected && originalIndex !== question.correctIndex
            return (
              <button
                key={`${question.id}-${originalIndex}`}
                type="button"
                className={[
                  'practice-option',
                  isSelected ? 'is-selected' : '',
                  isCorrectOption ? 'is-correct' : '',
                  isWrongSelection ? 'is-wrong' : '',
                ].filter(Boolean).join(' ')}
                disabled={locked || !speechReady}
                onClick={() => chooseOption(originalIndex)}
              >
                <span>{String.fromCharCode(65 + visibleIndex)}</span>
                <strong><MathText text={question.options[originalIndex]} /></strong>
                {(isCorrectOption || isWrongSelection) && <i>{isCorrectOption ? '正确' : '已选'}</i>}
              </button>
            )
          })}
        </div>

        {speechError && <p className="practice-inline-error">{speechError}</p>}

        {practiceFeedback && (
          <div
            className={`practice-feedback ${feedback?.correct ? 'is-correct' : 'is-wrong'}`}
            role="status"
          >
            <span>{feedback?.correct ? '✓' : '×'}</span>
            <div>
              <strong>{practiceFeedback}</strong>
              <small>正确答案是 {String.fromCharCode(65 + optionOrder.indexOf(question.correctIndex))} · {question.topic}</small>
            </div>
          </div>
        )}
      </main>

      <footer className="practice-session-footer">
        <div>
          <span>已作答 {answers.length} 题</span>
          <strong>{run.mode === 'test' ? '测试中不显示对错' : '每题提交后立即反馈'}</strong>
        </div>
        <button
          type="button"
          className="practice-next-button"
          disabled={
            !locked &&
            !(run.mode === 'test' && selectedIndex !== null && speechReady)
          }
          onClick={handleNext}
        >
          {run.mode === 'test' && !locked
            ? '提交本题'
            : isLastQuestion
              ? '完成并查看结果'
              : '下一题'}
          <span aria-hidden="true">→</span>
        </button>
      </footer>
    </div>
  )
}
