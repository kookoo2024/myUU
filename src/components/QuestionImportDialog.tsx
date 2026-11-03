import { useEffect, useMemo, useRef, useState } from 'react'
import {
  parseQuestionImport,
  serializeQuestions,
  subjectDisplayName,
} from '../lib/questionBank'
import type { Question, SubjectId } from '../types'
import { MathText } from './MathText'

interface QuestionImportDialogProps {
  subject: SubjectId
  customQuestions: Question[]
  onImport: (questions: Question[]) => void
  onClose: () => void
}

const SAMPLE = [
  '已知 $x^2=4$，则 $x$ 的值为',
  '$2$',
  '$-2$',
  '$\\pm 2$',
  '$4$',
  'C',
  '一元二次方程',
  '基础',
].join(' | ')

export function QuestionImportDialog({
  subject,
  customQuestions,
  onImport,
  onClose,
}: QuestionImportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const parsed = useMemo(() => parseQuestionImport(text, subject), [subject, text])
  const subjectQuestions = customQuestions.filter((question) => question.subject === subject)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setFileName(file.name)
    setText(await file.text())
  }

  const handleExport = () => {
    const data = serializeQuestions(subjectQuestions)
    const blob = new Blob([data], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${subjectDisplayName(subject)}题库-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="question-import-backdrop" role="presentation">
      <section
        className="question-import-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="question-import-title"
      >
        <header className="question-import-header">
          <div>
            <span>BATCH IMPORT · 本机题库</span>
            <h1 id="question-import-title">批量导入{subjectDisplayName(subject)}题</h1>
            <p>可以直接粘贴 Excel 多行单元格，每行一道题；也可导入 JSON。</p>
          </div>
          <button type="button" className="question-import-close" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="question-import-body">
          <main className="question-import-main">
            <div className="import-format-heading">
              <div>
                <span>每行 8 列</span>
                <strong>题干｜A｜B｜C｜D｜答案｜知识点｜难度</strong>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.txt,.tsv,.csv"
                hidden
                onChange={(event) => void handleFile(event.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
              >
                从文件读取
              </button>
            </div>

            <textarea
              className="question-import-textarea"
              value={text}
              spellCheck={false}
              aria-label="批量导入内容"
              placeholder={`每行使用竖线或制表符分隔，例如：\n${SAMPLE}`}
              onChange={(event) => {
                setText(event.target.value)
                setFileName(null)
              }}
            />

            <div className="question-import-tips">
              <span>使用 Excel 粘贴最稳；手写时请用“空格 + 竖线 + 空格”分隔各列。</span>
              <span>答案可写 A/B/C/D、1/2/3/4，或直接写正确选项文字。</span>
              <span>公式仍使用 LaTeX，例如 $\frac&#123;1&#125;&#123;2&#125;$。</span>
            </div>
          </main>

          <aside className="question-import-preview">
            <div className="import-preview-heading">
              <div>
                <span>IMPORT CHECK</span>
                <strong>识别结果</strong>
              </div>
              <span className={parsed.questions.length > 0 ? 'is-ready' : ''}>
                {parsed.questions.length > 0 ? '可导入' : '等待内容'}
              </span>
            </div>

            <div className="import-stat-grid">
              <div>
                <span>本次识别</span>
                <strong>{parsed.questions.length}</strong>
                <small>道题</small>
              </div>
              <div>
                <span>已有自建</span>
                <strong>{subjectQuestions.length}</strong>
                <small>道题</small>
              </div>
            </div>

            <div className="import-question-preview">
              {parsed.questions.length === 0 ? (
                <div className="import-empty">
                  <span>TSV</span>
                  <strong>粘贴内容后自动校验</strong>
                  <p>从 Excel 复制多行、多列，直接粘贴到左侧即可。</p>
                </div>
              ) : (
                parsed.questions.slice(0, 4).map((question, index) => (
                  <div key={question.id}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <strong><MathText text={question.prompt} /></strong>
                      <small>{question.topic} · {question.difficulty} · 答案 {String.fromCharCode(65 + question.correctIndex)}</small>
                    </div>
                  </div>
                ))
              )}
            </div>

            {parsed.errors.length > 0 && (
              <div className="import-errors" role="status">
                {parsed.errors.slice(0, 4).map((error) => (
                  <span key={error}>{error}</span>
                ))}
              </div>
            )}

            {fileName && <p className="import-file-note">已读取：{fileName}</p>}
          </aside>
        </div>

        <footer className="question-import-footer">
          <button type="button" className="import-export" onClick={handleExport}>
            导出已有自建题
          </button>
          <div>
            <button type="button" className="import-secondary" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="import-primary"
              disabled={parsed.questions.length === 0}
              onClick={() => onImport(parsed.questions)}
            >
              导入 {parsed.questions.length || ''} 道题
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
