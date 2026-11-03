import type { MatchResult } from '../types'
import { useDuelEngine } from '../hooks/useDuelEngine'
import { MatchHeader } from './MatchHeader'
import { PlayerLane } from './PlayerLane'
import type { PackDefinition, Student, MatchSettings } from '../types'

interface DuelArenaProps {
  leftStudent: Student
  rightStudent: Student
  settings: MatchSettings
  pack: PackDefinition
  onFinish: (result: MatchResult) => void
  onExit: () => void
}

export function DuelArena({
  leftStudent,
  rightStudent,
  settings,
  pack,
  onFinish,
  onExit,
}: DuelArenaProps) {
  const { state, answer } = useDuelEngine({
    leftStudent,
    rightStudent,
    settings,
    pack,
    onFinish,
  })
  const bothDone =
    state.players.left.status === 'done' && state.players.right.status === 'done'

  return (
    <div className="duel-screen">
      <div className="duel-effects" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <MatchHeader settings={settings} onExit={onExit} />

      <main className="duel-stage">
        <PlayerLane side="left" state={state} onAnswer={(index) => answer('left', index)} />

        <div className="duel-center" aria-hidden="true">
          <span>VS</span>
          <strong>LIVE</strong>
          <i />
        </div>

        <PlayerLane side="right" state={state} onAnswer={(index) => answer('right', index)} />
      </main>

      <footer className="duel-footer">
        <div className="duel-rule">
          <span className="rule-dot" />
          左右独立推进
        </div>
        <span>答完立即下一题 · 超时自动判错</span>
        <div className="duel-rule">
          <span className="rule-dot rule-dot--audio" />
          听力题才同步
        </div>
      </footer>

      {state.syncStatus === 'playing' && (
        <div className="audio-ribbon" aria-live="assertive">
          <span className="audio-wave">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
          <strong>正在播放读音</strong>
          <span>双方听完后各自开始 {settings.secondsPerQuestion} 秒计时</span>
        </div>
      )}

      {state.syncMessage && (
        <div className="audio-warning" role="status">
          {state.syncMessage}
        </div>
      )}

      {bothDone && (
        <div className="match-complete-curtain">
          <span>本场完成</span>
        </div>
      )}
    </div>
  )
}
