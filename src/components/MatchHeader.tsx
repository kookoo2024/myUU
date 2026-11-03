import { PACKS, SUBJECT_META } from '../data/demo'
import type { MatchSettings } from '../types'

interface MatchHeaderProps {
  settings: MatchSettings
  onExit: () => void
}

export function MatchHeader({ settings, onExit }: MatchHeaderProps) {
  const pack = PACKS[settings.subject]
  const meta = SUBJECT_META[settings.subject]

  return (
    <header className="match-header">
      <div className="match-brand">
        <span className="brand-split" aria-hidden="true">
          <i />
          <i />
        </span>
        <div>
          <strong>题场</strong>
          <span>课堂竞技场</span>
        </div>
      </div>

      <div className="match-title">
        <span className="subject-mark">{meta.mark}</span>
        <div>
          <h1>{pack.title}</h1>
          <p>
            {settings.questionCount} 题 · 每题 {settings.secondsPerQuestion} 秒 ·{' '}
            {settings.questionMode === 'same' ? '同题异序' : '异题同难度'}
          </p>
        </div>
      </div>

      <button type="button" className="quiet-button match-exit" onClick={onExit}>
        返回准备
      </button>
    </header>
  )
}
