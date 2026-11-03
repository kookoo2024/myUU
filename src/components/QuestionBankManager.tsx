import { useEffect, useMemo, useState } from 'react'
import { PACKS, SUBJECT_META } from '../data/demo'
import {
  buildPackFromDraft,
  loadPackDrafts,
  savePackDraft,
  type PackDraft,
  type PackDraftMap,
} from '../lib/packDrafts'
import {
  deleteCustomQuestion,
  getQuestionsForSubject,
  loadCustomQuestions,
  saveCustomQuestions,
  upsertCustomQuestion,
} from '../lib/questionBank'
import type { PackDefinition, Question, SubjectId } from '../types'
import { MathText } from './MathText'
import { QuestionEditor } from './QuestionEditor'
import { QuestionImportDialog } from './QuestionImportDialog'

interface QuestionBankManagerProps {
  initialSubject: SubjectId
  onApplyPack: (pack: PackDefinition) => void
  onClose: () => void
}

type DifficultyFilter = '全部' | Question['difficulty']

const SUBJECTS: SubjectId[] = ['english', 'math', 'physics']
const DIFFICULTIES: DifficultyFilter[] = ['全部', '基础', '中等', '提升']
const PAGE_SIZE = 6

function difficultyOrder(difficulty: Question['difficulty']) {
  return difficulty === '基础' ? 0 : difficulty === '中等' ? 1 : 2
}

function defaultTitle(subject: SubjectId) {
  return `${SUBJECT_META[subject].short}自选题包`
}

export function QuestionBankManager({
  initialSubject,
  onApplyPack,
  onClose,
}: QuestionBankManagerProps) {
  const [drafts, setDrafts] = useState<PackDraftMap>(() => loadPackDrafts())
  const [customQuestions, setCustomQuestions] = useState<Question[]>(() => loadCustomQuestions())
  const initialDraft = drafts[initialSubject]
  const [subject, setSubject] = useState<SubjectId>(initialSubject)
  const [difficulty, setDifficulty] = useState<DifficultyFilter>('全部')
  const [selectedIds, setSelectedIds] = useState<string[]>(initialDraft?.questionIds ?? [])
  const [packTitle, setPackTitle] = useState(initialDraft?.title ?? defaultTitle(initialSubject))
  const [secondsPerQuestion, setSecondsPerQuestion] = useState(
    initialDraft?.secondsPerQuestion ?? PACKS[initialSubject].defaultSeconds,
  )
  const [page, setPage] = useState(0)
  const [notice, setNotice] = useState<'saved' | 'applied' | null>(null)
  const [editorState, setEditorState] = useState<{ question: Question | null } | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Question | null>(null)

  const questions = useMemo(
    () => getQuestionsForSubject(subject),
    [customQuestions, subject],
  )
  const filteredQuestions = useMemo(
    () =>
      difficulty === '全部'
        ? questions
        : questions.filter((question) => question.difficulty === difficulty),
    [difficulty, questions],
  )
  const pageCount = Math.max(1, Math.ceil(filteredQuestions.length / PAGE_SIZE))
  const visibleQuestions = filteredQuestions.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedQuestions = selectedIds
    .map((id) => questions.find((question) => question.id === id))
    .filter((question) => question !== undefined)
  const canApply = selectedQuestions.length >= 2 && packTitle.trim().length > 0
  const secondsOptions = subject === 'english' ? [5, 7, 10] : [15, 30, 45]
  const difficultyCounts = DIFFICULTIES.slice(1).map((level) => ({
    level,
    count: selectedQuestions.filter((question) => question.difficulty === level).length,
  }))

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !editorState && !showImport && !deleteTarget) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [deleteTarget, editorState, onClose, showImport])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 1800)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    const draft: PackDraft = {
      subject,
      title: packTitle,
      questionIds: selectedIds,
      secondsPerQuestion,
      updatedAt: new Date().toISOString(),
    }
    savePackDraft(draft)
    setDrafts((current) => ({ ...current, [subject]: draft }))
  }, [packTitle, secondsPerQuestion, selectedIds, subject])

  useEffect(() => {
    if (page >= pageCount) setPage(Math.max(0, pageCount - 1))
  }, [page, pageCount])

  const currentDraft = (nextSubject = subject): PackDraft => ({
    subject: nextSubject,
    title: packTitle,
    questionIds: selectedIds,
    secondsPerQuestion,
    updatedAt: new Date().toISOString(),
  })

  const persistCurrentDraft = (nextSubject = subject) => {
    const draft = currentDraft(nextSubject)
    savePackDraft(draft)
    setDrafts((current) => ({ ...current, [nextSubject]: draft }))
    return draft
  }

  const switchSubject = (nextSubject: SubjectId) => {
    if (nextSubject === subject) return
    persistCurrentDraft()
    const nextDraft = drafts[nextSubject]
    setSubject(nextSubject)
    setDifficulty('全部')
    setSelectedIds(nextDraft?.questionIds ?? [])
    setPackTitle(nextDraft?.title ?? defaultTitle(nextSubject))
    setSecondsPerQuestion(nextDraft?.secondsPerQuestion ?? PACKS[nextSubject].defaultSeconds)
    setPage(0)
    setNotice(null)
  }

  const toggleQuestion = (question: Question) => {
    setSelectedIds((current) => {
      if (current.includes(question.id)) return current.filter((id) => id !== question.id)
      if (current.length >= 10) return current
      return [...current, question.id]
    })
  }

  const handleSave = () => {
    persistCurrentDraft()
    setNotice('saved')
  }

  const handleApply = () => {
    const draft = persistCurrentDraft()
    const nextPack = buildPackFromDraft(draft)
    if (!nextPack) return
    setNotice('applied')
    onApplyPack(nextPack)
  }

  const chooseDifficulty = (nextDifficulty: DifficultyFilter) => {
    setDifficulty(nextDifficulty)
    setPage(0)
  }

  const handleSaveQuestion = (question: Question) => {
    const wasNew = editorState?.question === null
    const nextCustomQuestions = upsertCustomQuestion(question)
    setCustomQuestions(nextCustomQuestions)

    if (question.subject !== subject) {
      const nextDraft = drafts[question.subject]
      const nextIds = nextDraft?.questionIds ?? []
      setSubject(question.subject)
      setPackTitle(nextDraft?.title ?? defaultTitle(question.subject))
      setSecondsPerQuestion(
        nextDraft?.secondsPerQuestion ?? PACKS[question.subject].defaultSeconds,
      )
      setSelectedIds(
        wasNew && nextIds.length < 10 ? [...nextIds, question.id] : nextIds,
      )
    } else {
      setDifficulty('全部')
      setPage(0)
      if (wasNew) {
        setSelectedIds((current) => current.length < 10 ? [...current, question.id] : current)
      }
    }

    setEditorState(null)
    setNotice('saved')
  }

  const handleDeleteQuestion = () => {
    if (!deleteTarget) return
    const nextCustomQuestions = deleteCustomQuestion(deleteTarget.id)
    setCustomQuestions(nextCustomQuestions)
    setSelectedIds((current) => current.filter((id) => id !== deleteTarget.id))
    setDeleteTarget(null)
    setNotice('saved')
  }

  const handleImportQuestions = (questionsToImport: Question[]) => {
    const nextCustomQuestions = [...questionsToImport, ...customQuestions]
    saveCustomQuestions(nextCustomQuestions)
    setCustomQuestions(nextCustomQuestions)
    setShowImport(false)
    setPage(0)
    setDifficulty('全部')
    setNotice('saved')
  }

  return (
    <>
      <div className="resource-backdrop" role="presentation">
        <section
          className="resource-workbench"
          role="dialog"
          aria-modal="true"
          aria-labelledby="resource-title"
        >
        <header className="resource-header">
          <div className="resource-title-block">
            <span>OWNED LIBRARY · 本机教学资产</span>
            <h1 id="resource-title">题库与题包工坊</h1>
            <p>选好题就能直接上场；题目与公式保持原样，不再二次抄写。</p>
          </div>
          <div className="resource-process" aria-label="题包制作流程">
            <span className="is-current"><i>01</i>筛选题库</span>
            <span><i>02</i>组合题包</span>
            <span><i>03</i>课堂开赛</span>
          </div>
          <button type="button" className="resource-close" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="resource-body">
          <aside className="resource-subject-rail">
            <div className="resource-rail-heading">
              <span>SUBJECTS</span>
              <strong>我的学科</strong>
            </div>
            <div className="resource-subject-list">
              {SUBJECTS.map((item) => {
                const meta = SUBJECT_META[item]
                const subjectPack = PACKS[item]
                const localCount = customQuestions.filter(
                  (question) => question.subject === item,
                ).length
                const draftCount = drafts[item]?.questionIds.length ?? 0
                return (
                  <button
                    key={item}
                    type="button"
                    className={subject === item ? 'is-active' : ''}
                    onClick={() => switchSubject(item)}
                  >
                    <span className="resource-subject-mark">{meta.mark}</span>
                    <span>
                      <strong>{meta.short}</strong>
                      <small>{subjectPack.questions.length + localCount} 题</small>
                    </span>
                    {draftCount > 0 && <em>{draftCount}</em>}
                  </button>
                )
              })}
            </div>

            <div className="resource-filter-block">
              <span>难度筛选</span>
              <div className="resource-filter-list">
                {DIFFICULTIES.map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={difficulty === level ? 'is-active' : ''}
                    onClick={() => chooseDifficulty(level)}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>

            <div className="resource-library-note">
              <span>LOCAL FIRST</span>
              <strong>课堂不依赖外网</strong>
              <p>当前已录入 {customQuestions.length} 道自建题；接入服务端后可同步、授权和分发题包。</p>
            </div>
          </aside>

          <main className="resource-question-area">
            <div className="resource-toolbar">
              <div>
                <span>{SUBJECT_META[subject].label} · {difficulty}</span>
                <strong>
                  {filteredQuestions.length}
                  <small> 道可用题目</small>
                </strong>
              </div>
              <div className="resource-toolbar-actions">
                <button
                  type="button"
                  className="resource-add-question"
                  onClick={() => setEditorState({ question: null })}
                >
                  <span>+</span> 新增题目
                </button>
                <button
                  type="button"
                  className="resource-import-question"
                  onClick={() => setShowImport(true)}
                >
                  批量导入
                </button>
                <button
                  type="button"
                  className="resource-select-page"
                  onClick={() => {
                    const pageIds = visibleQuestions.map((question) => question.id)
                    const allSelected = pageIds.every((id) => selectedSet.has(id))
                    setSelectedIds((current) =>
                      allSelected
                        ? current.filter((id) => !pageIds.includes(id))
                        : [...new Set([...current, ...pageIds])].slice(0, 10),
                    )
                  }}
                >
                  {visibleQuestions.every((question) => selectedSet.has(question.id))
                    ? '取消本页'
                    : '选择本页'}
                </button>
              </div>
            </div>

            <div className="resource-question-grid">
              {visibleQuestions.map((question, index) => {
                const selected = selectedSet.has(question.id)
                const isLocal = question.source === 'local'
                return (
                  <article
                    key={question.id}
                    className={[
                      'bank-question-card',
                      selected ? 'is-selected' : '',
                      isLocal ? 'is-local' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <button
                      type="button"
                      className="bank-card-main"
                      onClick={() => toggleQuestion(question)}
                      aria-pressed={selected}
                    >
                      <span className="bank-question-order">
                        {String(page * PAGE_SIZE + index + 1).padStart(2, '0')}
                      </span>
                      <span className={`bank-difficulty bank-difficulty--${difficultyOrder(question.difficulty)}`}>
                        {question.difficulty}
                      </span>
                      <span className="bank-question-badges">
                        {isLocal && <i className="is-local">我的题</i>}
                        {question.image && <i>图像题</i>}
                        {question.kind === 'speech' && <i>听力题</i>}
                      </span>
                      <span className="bank-question-topic">{question.topic}</span>
                      <strong className="bank-question-prompt">
                        <MathText text={question.prompt} />
                      </strong>
                      <span className="bank-question-options">
                        {question.options.map((option, optionIndex) => (
                          <span key={`${question.id}-${optionIndex}`}>
                            <i>{String.fromCharCode(65 + optionIndex)}</i>
                            <MathText text={option} />
                          </span>
                        ))}
                      </span>
                      <span className="bank-select-state">{selected ? '已加入题包' : '点击加入'}</span>
                    </button>
                    {isLocal && (
                      <div className="bank-card-admin">
                        <button
                          type="button"
                          aria-label={`编辑题目：${question.topic}`}
                          onClick={() => setEditorState({ question })}
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          aria-label={`删除题目：${question.topic}`}
                          onClick={() => setDeleteTarget(question)}
                        >
                          删除
                        </button>
                      </div>
                    )}
                  </article>
                )
              })}
            </div>

            <footer className="resource-pagination">
              <span>
                第 {page + 1} / {pageCount} 页 · 每页 {PAGE_SIZE} 题
              </span>
              <div>
                <button
                  type="button"
                  disabled={page === 0}
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                >
                  上一页
                </button>
                <button
                  type="button"
                  disabled={page >= pageCount - 1}
                  onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
                >
                  下一页
                </button>
              </div>
            </footer>
          </main>

          <aside className="resource-pack-builder">
            <div className="builder-heading">
              <div>
                <span>PACK BUILDER</span>
                <strong>当前题包</strong>
              </div>
              <span>{selectedQuestions.length} / 10 题</span>
            </div>

            <label className="builder-title-field">
              <span>题包名称</span>
              <input
                value={packTitle}
                maxLength={28}
                onChange={(event) => setPackTitle(event.target.value)}
              />
            </label>

            <div className="builder-meta-row">
              <div>
                <span>学科</span>
                <strong>{SUBJECT_META[subject].short}</strong>
              </div>
              <div>
                <span>默认时长</span>
                <strong>{secondsPerQuestion} 秒/题</strong>
              </div>
            </div>

            <div className="builder-seconds">
              <span>每题默认</span>
              <div>
                {secondsOptions.map((seconds) => (
                  <button
                    key={seconds}
                    type="button"
                    className={secondsPerQuestion === seconds ? 'is-active' : ''}
                    onClick={() => setSecondsPerQuestion(seconds)}
                  >
                    {seconds}
                  </button>
                ))}
              </div>
            </div>

            <div className="builder-difficulties">
              {difficultyCounts.map((item) => (
                <div key={item.level}>
                  <span>{item.level}</span>
                  <i style={{ '--fill': `${(item.count / Math.max(1, selectedQuestions.length)) * 100}%` } as React.CSSProperties} />
                  <strong>{item.count}</strong>
                </div>
              ))}
            </div>

            <div className="builder-selection-heading">
              <span>已选题目</span>
              <button type="button" onClick={() => setSelectedIds([])} disabled={selectedIds.length === 0}>
                清空
              </button>
            </div>

            <div className="builder-selected-list">
              {selectedQuestions.length === 0 ? (
                <div className="builder-empty">
                  <span>+</span>
                  <strong>从题库点选题目</strong>
                  <p>至少选择 2 题即可生成课堂题包。</p>
                </div>
              ) : (
                selectedQuestions.map((question, index) => (
                  <div key={question.id} className="builder-selected-item">
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <strong>{question.topic}</strong>
                      <small>{question.difficulty}{question.image ? ' · 图像题' : ''}</small>
                    </div>
                    <button
                      type="button"
                      aria-label={`移除第 ${index + 1} 题`}
                      onClick={() => toggleQuestion(question)}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="builder-actions">
              <span className={`builder-notice ${notice ? 'is-visible' : ''}`}>
                {notice === 'saved' ? '草稿已保存到本机' : notice === 'applied' ? '已应用到课堂' : '本地自动草稿'}
              </span>
              <div>
                <button type="button" className="builder-secondary" onClick={handleSave} disabled={selectedIds.length === 0}>
                  保存草稿
                </button>
                <button type="button" className="builder-primary" onClick={handleApply} disabled={!canApply}>
                  应用到本场
                </button>
              </div>
            </div>
          </aside>
        </div>
        </section>
      </div>

      {editorState && (
        <QuestionEditor
          question={editorState.question}
          initialSubject={subject}
          onSave={handleSaveQuestion}
          onClose={() => setEditorState(null)}
        />
      )}

      {showImport && (
        <QuestionImportDialog
          subject={subject}
          customQuestions={customQuestions}
          onImport={handleImportQuestions}
          onClose={() => setShowImport(false)}
        />
      )}

      {deleteTarget && (
        <div className="question-delete-backdrop" role="presentation">
          <section
            className="question-delete-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="question-delete-title"
          >
            <span>DELETE QUESTION</span>
            <h2 id="question-delete-title">删除这道自建题？</h2>
            <p>“{deleteTarget.topic}”会从题库和当前题包中移除，此操作不能撤销。</p>
            <div>
              <button type="button" onClick={() => setDeleteTarget(null)}>
                取消
              </button>
              <button type="button" onClick={handleDeleteQuestion}>
                确认删除
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
