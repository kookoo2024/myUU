import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { PACKS, SUBJECT_META } from './data/demo'
import { getActiveClassroom, loadClassroomDirectory } from './lib/classroom'
import { loadAppliedPack } from './lib/packDrafts'
import { loadLocalPracticeAttempts, submitPracticeAttempt } from './lib/practiceResults'
import { shuffleWithSeed } from './lib/random'
import { getServerStatus, subscribeServerStatus } from './lib/serverSync'
import { primeSpeechEngine } from './lib/speech'
import type {
  PackDefinition,
  PracticeAttempt,
  PracticeMode,
  PracticeRun,
  SubjectId,
} from './types'
import { PracticeResult } from './components/PracticeResult'
import { PracticeSession } from './components/PracticeSession'

type Stage = 'entry' | 'session' | 'result'

const SUBJECTS: SubjectId[] = ['english', 'math', 'physics']

function createRun(
  classroom: ReturnType<typeof getActiveClassroom>,
  studentId: string,
  pack: PackDefinition,
  mode: PracticeMode,
  questionCount: number,
  secondsPerQuestion: number,
): PracticeRun | null {
  const student = classroom.students.find((item) => item.id === studentId)
  if (!student || pack.questions.length === 0) return null
  const sessionSeed = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const questions = shuffleWithSeed(pack.questions, sessionSeed).slice(0, questionCount)
  const speechQuestion = pack.questions.find((question) => question.kind === 'speech')
  if (
    pack.subject === 'english' &&
    questionCount >= 3 &&
    speechQuestion &&
    !questions.some((question) => question.id === speechQuestion.id)
  ) {
    questions[questions.length - 1] = speechQuestion
  }

  return {
    classroom,
    student,
    pack,
    mode,
    secondsPerQuestion,
    questions,
    startedAt: new Date().toISOString(),
  }
}

export default function PracticeApp() {
  const directory = useMemo(() => loadClassroomDirectory(), [])
  const appliedPack = useMemo(() => loadAppliedPack(), [])
  const [stage, setStage] = useState<Stage>('entry')
  const [classId, setClassId] = useState(directory.activeClassId)
  const classroom =
    directory.classrooms.find((item) => item.id === classId) ?? getActiveClassroom(directory)
  const [studentId, setStudentId] = useState('')
  const [subject, setSubject] = useState<SubjectId>(appliedPack?.subject ?? 'math')
  const [mode, setMode] = useState<PracticeMode>('practice')
  const [questionCount, setQuestionCount] = useState(
    appliedPack?.defaultQuestionCount ?? PACKS.math.defaultQuestionCount,
  )
  const [secondsPerQuestion, setSecondsPerQuestion] = useState(
    appliedPack?.defaultSeconds ?? PACKS.math.defaultSeconds,
  )
  const [run, setRun] = useState<PracticeRun | null>(null)
  const [attempt, setAttempt] = useState<PracticeAttempt | null>(null)
  const [syncState, setSyncState] = useState<'saving' | 'saved' | 'local'>('saving')
  const serverStatus = useSyncExternalStore(
    subscribeServerStatus,
    getServerStatus,
    () => 'checking' as const,
  )

  useEffect(() => {
    if (stage !== 'result' || !attempt || syncState !== 'local' || serverStatus !== 'online') {
      return
    }
    setSyncState('saving')
    void submitPracticeAttempt(attempt).then((ok) => {
      setSyncState(ok ? 'saved' : 'local')
    })
  }, [attempt, serverStatus, stage, syncState])

  const pack = appliedPack?.subject === subject ? appliedPack : PACKS[subject]
  const selectedStudent =
    classroom.students.find((student) => student.id === studentId) ?? null
  const localAttempts = loadLocalPracticeAttempts().filter(
    (item) => item.studentId === studentId,
  )

  const changeSubject = (nextSubject: SubjectId) => {
    const nextPack =
      appliedPack?.subject === nextSubject ? appliedPack : PACKS[nextSubject]
    setSubject(nextSubject)
    setQuestionCount(nextPack.defaultQuestionCount)
    setSecondsPerQuestion(nextPack.defaultSeconds)
  }

  const startPractice = () => {
    const nextRun = createRun(
      classroom,
      studentId,
      pack,
      mode,
      questionCount,
      secondsPerQuestion,
    )
    if (!nextRun) return
    void primeSpeechEngine()
    setRun(nextRun)
    setAttempt(null)
    setStage('session')
  }

  const handleFinish = (nextAttempt: PracticeAttempt) => {
    setAttempt(nextAttempt)
    setStage('result')
    setSyncState('saving')
    void submitPracticeAttempt(nextAttempt).then((ok) => {
      setSyncState(ok ? 'saved' : 'local')
    })
  }

  const retry = () => {
    if (!run) {
      setStage('entry')
      return
    }
    const nextRun = createRun(
      run.classroom,
      run.student.id,
      run.pack,
      run.mode,
      run.questions.length,
      run.secondsPerQuestion,
    )
    if (!nextRun) {
      setStage('entry')
      return
    }
    setRun(nextRun)
    setAttempt(null)
    setStage('session')
  }

  const goClassroom = () => {
    window.location.assign('/')
  }

  if (stage === 'session' && run) {
    return (
      <PracticeSession
        run={run}
        onFinish={handleFinish}
        onExit={() => {
          if ('speechSynthesis' in window) window.speechSynthesis.cancel()
          setStage('entry')
        }}
      />
    )
  }

  if (stage === 'result' && run && attempt) {
    return (
      <PracticeResult
        attempt={attempt}
        run={run}
        syncState={syncState}
        onRetry={retry}
        onExit={() => setStage('entry')}
        onClassroom={goClassroom}
      />
    )
  }

  return (
    <div className="practice-mobile-shell practice-entry-screen">
      <header className="practice-entry-header">
        <a href="/" className="practice-brand">
          <span aria-hidden="true"><i /><i /></span>
          <div>
            <strong>题场</strong>
            <small>学生练习端</small>
          </div>
        </a>
        <div className="practice-entry-actions">
          <span className={`practice-connection is-${serverStatus}`}>
            <i />
            {serverStatus === 'online'
              ? '本机服务已连接'
              : serverStatus === 'offline'
                ? '成绩先存本机'
                : '检查服务中'}
          </span>
          <a href="/" className="practice-classroom-link">返回课堂大屏</a>
        </div>
      </header>

      <main className="practice-entry-main">
        <section className="practice-entry-hero">
          <span>SOLO MODE · 单人训练</span>
          <h1>轮到你了。<br /><em>认真读完每一题。</em></h1>
          <p>练习模式每题即时反馈；测试模式交卷后统一看答案。所有公式和图片都会完整保留。</p>
          <div className="practice-entry-facts">
            <div><strong>{classroom.students.length}</strong><span>当前班级人数</span></div>
            <div><strong>{pack.questions.length}</strong><span>可选题目</span></div>
            <div><strong>{questionCount}</strong><span>本轮题数</span></div>
          </div>
        </section>

        <section className="practice-entry-form">
          <div className="practice-form-section">
            <div className="practice-form-heading">
              <span>01</span>
              <div>
                <strong>确认你的身份</strong>
                <small>班级和学生姓名要选对，成绩会记到对应同学名下。</small>
              </div>
            </div>
            <div className="practice-select-row">
              <label>
                <span>班级</span>
                <select
                  aria-label="练习班级"
                  value={classroom.id}
                  onChange={(event) => {
                    setClassId(event.target.value)
                    setStudentId('')
                  }}
                >
                  {directory.classrooms.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.students.length}人
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>学生姓名</span>
                <select
                  aria-label="选择学生"
                  value={studentId}
                  onChange={(event) => setStudentId(event.target.value)}
                >
                  <option value="">请选择姓名</option>
                  {classroom.students.map((student) => (
                    <option key={student.id} value={student.id}>
                      {String(student.number).padStart(2, '0')} · {student.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {selectedStudent && (
              <div className="practice-student-ticket">
                <span>{String(selectedStudent.number).padStart(2, '0')}</span>
                <div>
                  <small>{classroom.name}</small>
                  <strong>{selectedStudent.name}</strong>
                </div>
                <i>{localAttempts.length > 0 ? `本机已练 ${localAttempts.length} 次` : '首次练习'}</i>
              </div>
            )}
          </div>

          <div className="practice-form-section">
            <div className="practice-form-heading">
              <span>02</span>
              <div>
                <strong>选择题包</strong>
                <small>老师选中的自选题包会自动优先显示。</small>
              </div>
            </div>
            <div className="practice-subject-switch">
              {SUBJECTS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={subject === item ? 'is-active' : ''}
                  onClick={() => changeSubject(item)}
                >
                  <span>{SUBJECT_META[item].mark}</span>
                  <strong>{SUBJECT_META[item].short}</strong>
                  <small>
                    {appliedPack?.subject === item ? '老师题包' : `${PACKS[item].questions.length} 题`}
                  </small>
                </button>
              ))}
            </div>
            <div className="practice-pack-ticket">
              <span>{SUBJECT_META[subject].mark}</span>
              <div>
                <small>本轮题包</small>
                <strong>{pack.title}</strong>
                <p>{pack.rangeLabel}</p>
              </div>
              <i>{appliedPack?.subject === subject ? '已应用' : '官方'}</i>
            </div>
          </div>

          <div className="practice-form-section">
            <div className="practice-form-heading">
              <span>03</span>
              <div>
                <strong>选择答题方式</strong>
                <small>练习看即时反馈，测试用于正式单元检测。</small>
              </div>
            </div>
            <div className="practice-mode-switch">
              <button
                type="button"
                className={mode === 'practice' ? 'is-active' : ''}
                onClick={() => setMode('practice')}
              >
                <span>练习</span>
                <strong>每题即时反馈</strong>
                <small>适合课前热身、错题巩固</small>
              </button>
              <button
                type="button"
                className={mode === 'test' ? 'is-active' : ''}
                onClick={() => setMode('test')}
              >
                <span>测试</span>
                <strong>交卷后统一看答案</strong>
                <small>适合单元小测、课堂检测</small>
              </button>
            </div>

            <div className="practice-setting-row">
              <span>题数</span>
              <div className="practice-choice-group">
                {pack.questionCountOptions
                  .filter((value) => value <= pack.questions.length)
                  .map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={questionCount === value ? 'is-active' : ''}
                      onClick={() => setQuestionCount(value)}
                    >
                      {value}<small>题</small>
                    </button>
                  ))}
              </div>
            </div>
            <div className="practice-setting-row">
              <span>每题</span>
              <div className="practice-choice-group">
                {pack.secondsOptions.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={secondsPerQuestion === value ? 'is-active' : ''}
                    onClick={() => setSecondsPerQuestion(value)}
                  >
                    {value}<small>秒</small>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            type="button"
            className="practice-start-button"
            disabled={!selectedStudent}
            onClick={startPractice}
          >
            <div>
              <span>READY · {mode === 'practice' ? '练习模式' : '测试模式'}</span>
              <strong>{selectedStudent ? `${selectedStudent.name}，开始答题` : '先选择你的姓名'}</strong>
            </div>
            <em aria-hidden="true">→</em>
          </button>
        </section>
      </main>

      <footer className="practice-entry-footer">
        <span>题场 · 学生练习端</span>
        <span>选择题 · 自动计时 · 公式完整渲染</span>
      </footer>
    </div>
  )
}
