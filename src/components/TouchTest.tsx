import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { primeSpeechEngine, speakEnglish, speechSupported } from '../lib/speech'

interface TouchTestProps {
  onClose: () => void
}

type TestSide = 'left' | 'right'

export function TouchTest({ onClose }: TouchTestProps) {
  const pointers = useRef<Record<TestSide, Set<number>>>({
    left: new Set(),
    right: new Set(),
  })
  const [counts, setCounts] = useState({ left: 0, right: 0 })
  const [passed, setPassed] = useState(false)
  const [voiceCount, setVoiceCount] = useState(0)
  const [speechState, setSpeechState] = useState<'idle' | 'playing' | 'done' | 'error'>('idle')

  useEffect(() => {
    if (!speechSupported()) return
    const updateVoices = () => {
      setVoiceCount(
        window.speechSynthesis
          .getVoices()
          .filter((voice) => voice.lang.toLowerCase().startsWith('en')).length,
      )
    }
    updateVoices()
    window.speechSynthesis.addEventListener('voiceschanged', updateVoices)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', updateVoices)
  }, [])

  const updateCounts = () => {
    const next = {
      left: pointers.current.left.size,
      right: pointers.current.right.size,
    }
    setCounts(next)
    if (next.left > 0 && next.right > 0) setPassed(true)
  }

  const press = (side: TestSide, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointers.current[side].add(event.pointerId)
    updateCounts()
  }

  const release = (side: TestSide, pointerId: number) => {
    pointers.current[side].delete(pointerId)
    updateCounts()
  }

  const reset = () => {
    pointers.current.left.clear()
    pointers.current.right.clear()
    setCounts({ left: 0, right: 0 })
    setPassed(false)
  }

  const testSpeech = async () => {
    setSpeechState('playing')
    try {
      await primeSpeechEngine()
      await speakEnglish({ text: 'schedule', lang: 'en-US', rate: 0.82 })
      setSpeechState('done')
    } catch {
      setSpeechState('error')
    }
  }

  return (
    <div className="diagnostic-backdrop" role="dialog" aria-modal="true" aria-labelledby="diagnostic-title">
      <div className="diagnostic-panel">
        <header className="diagnostic-header">
          <div>
            <span>SEEWO TOUCH CHECK</span>
            <h1 id="diagnostic-title">触控与声音自检</h1>
          </div>
          <button type="button" className="quiet-button" onClick={onClose}>
            返回赛场
          </button>
        </header>

        <p className="diagnostic-lead">
          两位同学请同时按住左右两个测试区。屏幕应分别识别两个触控点。
        </p>

        <div className="touch-test-stage">
          {(['left', 'right'] as TestSide[]).map((side) => (
            <button
              key={side}
              type="button"
              className={`touch-target touch-target--${side} ${counts[side] ? 'is-pressed' : ''}`}
              onPointerDown={(event) => press(side, event)}
              onPointerUp={(event) => release(side, event.pointerId)}
              onPointerCancel={(event) => release(side, event.pointerId)}
              onContextMenu={(event) => event.preventDefault()}
            >
              <span className="touch-target-label">{side === 'left' ? '左侧触控区' : '右侧触控区'}</span>
              <strong>{counts[side] ? '已识别' : '按住这里'}</strong>
              <span>当前触控点：{counts[side]}</span>
            </button>
          ))}
          <div className={`touch-result ${passed ? 'is-passed' : ''}`}>
            <span>{passed ? '✓' : '2'}</span>
            <strong>{passed ? '双点触控通过' : '等待双点触控'}</strong>
            <small>{passed ? '适合双人同时答题' : '请两位同学同时按住左右区域'}</small>
          </div>
        </div>

        <div className="diagnostic-bottom">
          <div className="speech-check">
            <div>
              <span>浏览器英文语音</span>
              <strong>
                {!speechSupported()
                  ? '当前浏览器不支持'
                  : voiceCount > 0
                    ? `检测到 ${voiceCount} 个英文语音`
                    : '等待系统语音加载'}
              </strong>
            </div>
            <button type="button" onClick={() => void testSpeech()} disabled={speechState === 'playing'}>
              {speechState === 'playing' ? '正在试读…' : '试读 “schedule”'}
            </button>
            {speechState === 'error' && <em>播放失败，请检查系统英文语音</em>}
          </div>

          <button type="button" className="text-button" onClick={reset}>
            重新测试触控
          </button>
        </div>
      </div>
    </div>
  )
}
