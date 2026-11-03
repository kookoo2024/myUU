import { useEffect, useMemo, useRef, useState } from 'react'
import { SUBJECT_META } from '../data/demo'
import { createLocalQuestion } from '../lib/questionBank'
import type {
  Question,
  QuestionImage,
  SpeechPrompt,
  SubjectId,
} from '../types'
import { MathText } from './MathText'

interface QuestionEditorProps {
  question: Question | null
  initialSubject: SubjectId
  onSave: (question: Question) => void
  onClose: () => void
}

const SUBJECTS: SubjectId[] = ['english', 'math', 'physics']
const OPTION_LETTERS = ['A', 'B', 'C', 'D']
const MAX_IMAGE_BYTES = 420 * 1024

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}

export function QuestionEditor({
  question,
  initialSubject,
  onSave,
  onClose,
}: QuestionEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [subject, setSubject] = useState<SubjectId>(question?.subject ?? initialSubject)
  const [kind, setKind] = useState<Question['kind']>(question?.kind ?? 'text')
  const [topic, setTopic] = useState(question?.topic ?? '')
  const [difficulty, setDifficulty] = useState<Question['difficulty']>(
    question?.difficulty ?? '中等',
  )
  const [prompt, setPrompt] = useState(question?.prompt ?? '')
  const [options, setOptions] = useState<string[]>(
    question?.options.length === 4 ? question.options : ['', '', '', ''],
  )
  const [correctIndex, setCorrectIndex] = useState(question?.correctIndex ?? 0)
  const [speechText, setSpeechText] = useState(question?.speech?.text ?? '')
  const [speechLang, setSpeechLang] = useState<SpeechPrompt['lang']>(
    question?.speech?.lang ?? 'en-US',
  )
  const [imageSrc, setImageSrc] = useState(question?.image?.src ?? '')
  const [imageAlt, setImageAlt] = useState(question?.image?.alt ?? '')
  const [imageCaption, setImageCaption] = useState(question?.image?.caption ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isReadingImage, setIsReadingImage] = useState(false)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const image = useMemo<QuestionImage | undefined>(
    () =>
      imageSrc
        ? {
            src: imageSrc,
            alt: imageAlt.trim() || '题目配图',
            caption: imageCaption.trim() || undefined,
          }
        : undefined,
    [imageAlt, imageCaption, imageSrc],
  )
  const speech = useMemo<SpeechPrompt | undefined>(
    () =>
      kind === 'speech'
        ? {
            text: speechText.trim(),
            lang: speechLang,
            task: 'meaning',
          }
        : undefined,
    [kind, speechLang, speechText],
  )
  const canSave =
    prompt.trim().length > 0 &&
    topic.trim().length > 0 &&
    options.every((option) => option.trim().length > 0) &&
    (kind !== 'speech' || speechText.trim().length > 0)

  const updateOption = (index: number, value: string) => {
    setOptions((current) => current.map((option, optionIndex) => (
      optionIndex === index ? value : option
    )))
  }

  const handleImageFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    if (!file.type.startsWith('image/')) {
      setError('请选择 PNG、JPG、WebP 或 SVG 图片')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('单张配图请控制在 420 KB 以内，正式服务端接入后会放宽并单独存储')
      return
    }

    setIsReadingImage(true)
    try {
      setImageSrc(await readFileAsDataUrl(file))
      if (!imageAlt.trim()) {
        setImageAlt(prompt.trim().slice(0, 36) || question?.prompt.slice(0, 36) || '题目配图')
      }
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : '图片读取失败')
    } finally {
      setIsReadingImage(false)
    }
  }

  const handleSubmit = () => {
    if (!canSave) {
      setError('请补全题干、知识点和四个选项')
      return
    }

    const base = {
      subject,
      prompt: prompt.trim(),
      helper:
        kind === 'speech'
          ? '听力同步题 · 读音结束后开始本题计时'
          : question?.helper,
      options: options.map((option) => option.trim()),
      correctIndex,
      kind,
      speech,
      image,
      topic: topic.trim(),
      difficulty,
    }
    const nextQuestion: Question = question
      ? {
          ...question,
          ...base,
          source: 'local',
          updatedAt: new Date().toISOString(),
        }
      : createLocalQuestion(base)
    onSave(nextQuestion)
  }

  return (
    <div className="question-editor-backdrop" role="presentation">
      <section
        className="question-editor-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="question-editor-title"
      >
        <header className="question-editor-header">
          <div>
            <span>QUESTION AUTHORING · 本机题库</span>
            <h1 id="question-editor-title">{question ? '编辑题目' : '录入新题'}</h1>
            <p>题干和选项可直接使用 LaTeX，例如 $x^2$、$\frac&#123;1&#125;&#123;2&#125;$。</p>
          </div>
          <button type="button" className="question-editor-close" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="question-editor-body">
          <div className="question-editor-form">
            <div className="editor-section editor-section--top">
              <div className="editor-field-group">
                <span className="editor-label">学科</span>
                <div className="editor-subject-switch">
                  {SUBJECTS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={subject === item ? 'is-active' : ''}
                      onClick={() => setSubject(item)}
                    >
                      <i>{SUBJECT_META[item].mark}</i>
                      {SUBJECT_META[item].short}
                    </button>
                  ))}
                </div>
              </div>

              <div className="editor-field-group">
                <span className="editor-label">题型</span>
                <div className="editor-kind-switch">
                  <button
                    type="button"
                    className={kind === 'text' ? 'is-active' : ''}
                    onClick={() => setKind('text')}
                  >
                    单项选择
                  </button>
                  <button
                    type="button"
                    className={kind === 'speech' ? 'is-active' : ''}
                    onClick={() => setKind('speech')}
                  >
                    英语听力
                  </button>
                </div>
              </div>
            </div>

            <div className="editor-section editor-section--meta">
              <label className="editor-field">
                <span>知识点</span>
                <input
                  value={topic}
                  maxLength={24}
                  placeholder="例如：二次函数应用"
                  onChange={(event) => setTopic(event.target.value)}
                />
              </label>
              <label className="editor-field">
                <span>难度</span>
                <select
                  value={difficulty}
                  onChange={(event) => setDifficulty(event.target.value as Question['difficulty'])}
                >
                  <option value="基础">基础</option>
                  <option value="中等">中等</option>
                  <option value="提升">提升</option>
                </select>
              </label>
            </div>

            <label className="editor-field editor-field--prompt">
              <span>题干</span>
              <textarea
                value={prompt}
                spellCheck={false}
                placeholder="输入题干；所有公式请放在两个美元符号之间"
                onChange={(event) => setPrompt(event.target.value)}
              />
            </label>

            {kind === 'speech' && (
              <div className="editor-speech-row">
                <label className="editor-field">
                  <span>浏览器朗读内容</span>
                  <input
                    value={speechText}
                    spellCheck={false}
                    placeholder="例如：library"
                    onChange={(event) => setSpeechText(event.target.value)}
                  />
                </label>
                <label className="editor-field editor-field--compact">
                  <span>发音</span>
                  <select
                    value={speechLang}
                    onChange={(event) => setSpeechLang(event.target.value as SpeechPrompt['lang'])}
                  >
                    <option value="en-US">美式英语</option>
                    <option value="en-GB">英式英语</option>
                  </select>
                </label>
              </div>
            )}

            <div className="editor-options-heading">
              <span>四个选项</span>
              <small>点击左侧圆点设置正确答案</small>
            </div>
            <div className="editor-options">
              {options.map((option, index) => (
                <div
                  key={OPTION_LETTERS[index]}
                  className={`editor-option-row ${correctIndex === index ? 'is-correct' : ''}`}
                >
                  <input
                    type="radio"
                    name="correct-option"
                    aria-label={`选项 ${OPTION_LETTERS[index]} 为正确答案`}
                    checked={correctIndex === index}
                    onChange={() => setCorrectIndex(index)}
                  />
                  <span>{OPTION_LETTERS[index]}</span>
                  <input
                    type="text"
                    aria-label={`选项 ${OPTION_LETTERS[index]} 内容`}
                    value={option}
                    spellCheck={false}
                    placeholder={`选项 ${OPTION_LETTERS[index]}，可输入 LaTeX`}
                    onChange={(event) => updateOption(index, event.target.value)}
                  />
                  {correctIndex === index && <em>正确</em>}
                </div>
              ))}
            </div>

            <div className="editor-image-row">
              <div>
                <span className="editor-label">配图（可选）</span>
                <p>支持 PNG、JPG、WebP、SVG，单张不超过 420 KB。</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                hidden
                onChange={(event) => void handleImageFile(event.target.files?.[0])}
              />
              <button
                type="button"
                className="editor-upload-button"
                disabled={isReadingImage}
                onClick={() => fileInputRef.current?.click()}
              >
                {isReadingImage ? '读取中…' : imageSrc ? '更换图片' : '选择图片'}
              </button>
              {imageSrc && (
                <button
                  type="button"
                  className="editor-remove-image"
                  onClick={() => setImageSrc('')}
                >
                  移除
                </button>
              )}
            </div>

            {imageSrc && (
              <div className="editor-image-meta">
                <input
                  value={imageAlt}
                  placeholder="图片说明（给读屏和排版使用）"
                  onChange={(event) => setImageAlt(event.target.value)}
                />
                <input
                  value={imageCaption}
                  placeholder="图注（可选）"
                  onChange={(event) => setImageCaption(event.target.value)}
                />
              </div>
            )}
          </div>

          <aside className="question-editor-preview">
            <div className="editor-preview-heading">
              <div>
                <span>LIVE PREVIEW</span>
                <strong>课堂显示预览</strong>
              </div>
              <span>{SUBJECT_META[subject].short} · {difficulty}</span>
            </div>

            <article className={`editor-preview-card ${image ? 'has-image' : ''}`}>
              <div className="editor-preview-badges">
                <span>{topic || '未填写知识点'}</span>
                {kind === 'speech' && <i>听力题</i>}
                {image && <i>图像题</i>}
              </div>
              <h2>
                {prompt.trim() ? (
                  <MathText text={prompt} />
                ) : (
                  '题干将在这里以课堂字号实时预览'
                )}
              </h2>
              {image && (
                <figure>
                  <img src={image.src} alt={image.alt} />
                  {image.caption && <figcaption>{image.caption}</figcaption>}
                </figure>
              )}
              <div className="editor-preview-options">
                {options.map((option, index) => (
                  <div
                    key={OPTION_LETTERS[index]}
                    className={correctIndex === index ? 'is-correct' : ''}
                  >
                    <span>{OPTION_LETTERS[index]}</span>
                    <strong>
                      {option.trim() ? (
                        <MathText text={option} />
                      ) : (
                        `等待填写选项 ${OPTION_LETTERS[index]}`
                      )}
                    </strong>
                  </div>
                ))}
              </div>
              {kind === 'speech' && (
                <div className="editor-speech-preview">
                  <span>浏览器朗读</span>
                  <strong>{speechText || '尚未填写朗读内容'}</strong>
                </div>
              )}
              <div className="editor-preview-hud">
                <div>
                  <span>左右选手</span>
                  <strong>独立推进</strong>
                </div>
                <div>
                  <span>本题倒计时</span>
                  <strong>{subject === 'english' ? 7 : 30} 秒</strong>
                </div>
                <div>
                  <span>答题节奏</span>
                  <strong>答完即下一题</strong>
                </div>
              </div>
            </article>

            <div className="editor-preview-note">
              <span>排版检查</span>
              <p>预览使用与课堂比赛相同的 KaTeX 渲染；正式比赛时会根据长题干和图片自动切换高密度排版。</p>
            </div>
          </aside>
        </div>

        <footer className="question-editor-footer">
          <span className={error ? 'is-error' : ''}>
            {error ?? '题目只保存在本机；接入服务端后将自动同步。'}
          </span>
          <div>
            <button type="button" className="editor-secondary" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="editor-primary"
              disabled={!canSave}
              onClick={handleSubmit}
            >
              {question ? '保存修改' : '保存题目'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
