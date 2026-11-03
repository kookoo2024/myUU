import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { PACKS, SUBJECT_META } from '../data/demo'
import { getServerStatus, subscribeServerStatus } from '../lib/serverSync'
import type {
  MatchSettings,
  PackDefinition,
  PlayerSide,
  Student,
  SubjectId,
  Classroom,
} from '../types'

interface SetupScreenProps {
  classroomName: string
  students: Student[]
  classrooms: Classroom[]
  activeClassId: string
  pack: PackDefinition
  customPack: PackDefinition | null
  selected: { left: Student | null; right: Student | null }
  settings: MatchSettings
  onSettingsChange: (settings: MatchSettings) => void
  onPickName: (side: PlayerSide, student: Student) => void
  onClearSelection: () => void
  onRandomPair: () => void
  onActivateClassroom: (classId: string) => void
  onOpenDiagnostics: () => void
  onOpenClassManager: () => void
  onOpenQuestionBank: () => void
  onOpenPracticeRecords: () => void
  onOpenServerAdmin: () => void
  onRestoreOfficialPack: () => void
  onLogout?: () => Promise<void> | void
}

const subjects: SubjectId[] = ['english', 'math', 'physics']

function SegmentedControl<T extends number>({
  label,
  values,
  value,
  suffix,
  onChange,
}: {
  label: string
  values: T[]
  value: T
  suffix: string
  onChange: (value: T) => void
}) {
  return (
    <div className="setting-row">
      <span className="setting-label">{label}</span>
      <div className="segment-group">
        {values.map((option) => (
          <button
            key={option}
            type="button"
            className={option === value ? 'is-active' : ''}
            onClick={() => onChange(option)}
          >
            {option}
            <small>{suffix}</small>
          </button>
        ))}
      </div>
    </div>
  )
}

function PlayerSlot({
  side,
  student,
  isOpen,
  onOpen,
}: {
  side: PlayerSide
  student: Student | null
  isOpen: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      className={[
        'player-slot',
        `player-slot--${side}`,
        student ? 'is-filled' : '',
        isOpen ? 'is-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onOpen}
      aria-expanded={isOpen}
      aria-controls={`roster-${side}`}
    >
      <span className="side-stamp">{side === 'left' ? '左' : '右'}</span>
      <div className="player-slot-copy">
        <span>{side === 'left' ? 'PLAYER 01 · 左侧赛道' : 'PLAYER 02 · 右侧赛道'}</span>
        {student ? (
          <strong>
            <small>{String(student.number).padStart(2, '0')}</small>
            {student.name}
          </strong>
        ) : (
          <strong className="player-slot-empty">点击选择学生</strong>
        )}
      </div>
      <span className="player-slot-state">{student ? '点击更换' : '点此选人'}</span>
      <span className="player-slot-chevron" aria-hidden="true">⌄</span>
    </button>
  )
}

export function SetupScreen({
  classroomName,
  students,
  classrooms,
  activeClassId,
  pack,
  customPack,
  selected,
  settings,
  onSettingsChange,
  onPickName,
  onClearSelection,
  onRandomPair,
  onActivateClassroom,
  onOpenDiagnostics,
  onOpenClassManager,
  onOpenQuestionBank,
  onOpenPracticeRecords,
  onOpenServerAdmin,
  onRestoreOfficialPack,
  onLogout,
}: SetupScreenProps) {
  const [openSide, setOpenSide] = useState<PlayerSide | null>(null)
  const [showClassMenu, setShowClassMenu] = useState(false)
  const serverStatus = useSyncExternalStore(
    subscribeServerStatus,
    getServerStatus,
    () => 'checking' as const,
  )
  const meta = SUBJECT_META[settings.subject]
  const usingCustomPack = customPack?.subject === settings.subject
  const updateSettings = (patch: Partial<MatchSettings>) => {
    onSettingsChange({ ...settings, ...patch })
  }
  const bothSelected = Boolean(selected.left && selected.right)

  useEffect(() => {
    if (!showClassMenu) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowClassMenu(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showClassMenu])

  const changeSubject = (subject: SubjectId) => {
    const nextPack =
      customPack?.subject === subject ? customPack : PACKS[subject]
    updateSettings({
      subject,
      secondsPerQuestion: nextPack.defaultSeconds,
      questionCount: nextPack.defaultQuestionCount,
    })
  }

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
    } catch {
      // Embedded previews may block fullscreen.
    }
  }

  const handlePickName = (student: Student) => {
    if (!openSide) return
    onPickName(openSide, student)
    setOpenSide(null)
  }

  const style = {
    '--pack-accent': pack.accent,
  } as CSSProperties

  return (
    <div className="setup-screen" style={style}>
      <header className="app-header">
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

        <div className="lesson-context-wrap">
          <button
            type="button"
            className={`lesson-context lesson-context-button ${showClassMenu ? 'is-open' : ''}`}
            aria-expanded={showClassMenu}
            aria-controls="class-quick-menu"
            onClick={() => {
              setOpenSide(null)
              setShowClassMenu((current) => !current)
            }}
          >
            <span className="live-indicator">LIVE</span>
            <span className="lesson-class-name">{classroomName}</span>
            <i />
            <span>课前 10 分钟</span>
            <i />
            <span>双人 PK</span>
            <b aria-hidden="true">⌄</b>
          </button>

          {showClassMenu && (
            <div id="class-quick-menu" className="class-quick-menu" role="menu">
              <div className="class-quick-heading">
                <div>
                  <span>CLASS SWITCHER · 快速切换</span>
                  <strong>选择今天上课的班级</strong>
                </div>
                <span>{classrooms.length} 个班级</span>
              </div>
              <div className="class-quick-grid">
                {classrooms.map((classroom) => (
                  <button
                    key={classroom.id}
                    type="button"
                    role="menuitem"
                    className={classroom.id === activeClassId ? 'is-active' : ''}
                    onClick={() => {
                      onActivateClassroom(classroom.id)
                      setShowClassMenu(false)
                    }}
                  >
                    <span>{classroom.id === activeClassId ? '当前' : '切换'}</span>
                    <strong>{classroom.name}</strong>
                    <small>{classroom.students.length} 人</small>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="class-quick-manage"
                onClick={() => {
                  setShowClassMenu(false)
                  onOpenClassManager()
                }}
              >
                <span>管理全部班级与学生</span>
                <strong>打开班级工作区 →</strong>
              </button>
            </div>
          )}
        </div>

        <div className="header-actions">
          <button
            type="button"
            className="quiet-button"
            aria-label="题库工作台"
            onClick={onOpenQuestionBank}
          >
            题库
          </button>
          <button
            type="button"
            className="quiet-button"
            aria-label="班级工作区"
            onClick={onOpenClassManager}
          >
            班级
          </button>
          <a
            className="quiet-button practice-launch-link"
            href="/practice"
            target="_blank"
            rel="noreferrer"
          >
            手机练习
          </a>
          <button type="button" className="quiet-button" onClick={onOpenPracticeRecords}>
            练习记录
          </button>
          <button
            type="button"
            className="quiet-button"
            aria-label="触控 / 声音自检"
            onClick={onOpenDiagnostics}
          >
            设备自检
          </button>
          <button type="button" className="quiet-button" onClick={toggleFullscreen}>
            全屏
          </button>
        </div>
      </header>

      <main className="setup-main">
        <section className="selection-panel">
          <div className="class-picker-heading">
            <div>
              <span>STUDENT SELECT · 全班名单菜单</span>
              <h1>谁先上场？<small>点击选手卡弹出名单</small></h1>
            </div>
            <div className="class-count">
              <strong>{students.length}</strong>
              <span>人<br />全员可选</span>
            </div>
          </div>

          <div className="player-slot-row">
            <PlayerSlot
              side="left"
              student={selected.left}
              isOpen={openSide === 'left'}
              onOpen={() => setOpenSide((current) => current === 'left' ? null : 'left')}
            />
            <div className="slot-versus">VS</div>
            <PlayerSlot
              side="right"
              student={selected.right}
              isOpen={openSide === 'right'}
              onOpen={() => setOpenSide((current) => current === 'right' ? null : 'right')}
            />
          </div>

          {openSide ? (
            <div
              id={`roster-${openSide}`}
              className={`roster-drawer roster-drawer--${openSide}`}
              role="group"
              aria-label={`${openSide === 'left' ? '左侧' : '右侧'}学生名单`}
            >
              <div className="roster-drawer-heading">
                <div>
                  <span>SELECT {openSide === 'left' ? 'PLAYER 01' : 'PLAYER 02'}</span>
                  <strong>选择{openSide === 'left' ? '左侧' : '右侧'}选手</strong>
                </div>
                <span>全班 {students.length} 人 · 点击姓名立即选中</span>
                <button
                  type="button"
                  className="roster-close"
                  onClick={() => setOpenSide(null)}
                >
                  收起
                </button>
              </div>

              <div className="class-roster-menu">
                {students.map((student) => {
                  const isLeft = selected.left?.id === student.id
                  const isRight = selected.right?.id === student.id
                  const selectedHere = openSide === 'left' ? isLeft : isRight
                  const selectedElsewhere = openSide === 'left' ? isRight : isLeft
                  return (
                    <button
                      key={student.id}
                      type="button"
                      className={[
                        'roster-name-item',
                        isLeft ? 'is-left' : '',
                        isRight ? 'is-right' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      disabled={selectedHere || selectedElsewhere}
                      onClick={() => handlePickName(student)}
                    >
                      <span>{String(student.number).padStart(2, '0')}</span>
                      <strong>{student.name}</strong>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="selection-showcase">
              <span className="showcase-emblem" aria-hidden="true">
                <i>PK</i>
              </span>
              <div className="showcase-copy">
                <span>READY ROOM · 对战准备舱</span>
                <h2>
                  {bothSelected
                    ? '双方就位，准备进入竞技场'
                    : selected.left
                      ? '左侧选手已就位，请选择右侧选手'
                      : '点击上方选手卡，从全班名单中选人'}
                </h2>
                <p>左侧点击一次弹出名单，右侧点击一次弹出名单；两名选手选好后自动开始。</p>
              </div>
              <div className="showcase-steps">
                <span><i>01</i>选择左方</span>
                <span><i>02</i>选择右方</span>
                <span><i>03</i>自动开赛</span>
              </div>
            </div>
          )}

          <div className="selection-footer">
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setOpenSide(null)
                onClearSelection()
              }}
            >
              重新选择
            </button>
            <div className="selection-hint">
              <span className="pulse-dot" />
              {bothSelected
                ? '即将自动倒计时'
                : selected.left
                  ? '再点击右侧选手卡'
                  : '先点击左侧选手卡'}
            </div>
            <button
              type="button"
              className="random-button"
              onClick={() => {
                setOpenSide(null)
                onRandomPair()
              }}
            >
              <span>全班随机抽两位</span>
              <small>由老师代选，直接开始</small>
            </button>
          </div>
        </section>

        <aside className="match-config-panel">
          <div className="config-header">
            <div>
              <span>MATCH SETUP</span>
              <strong>本场赛制</strong>
            </div>
            <span className="config-chip">PRO</span>
          </div>

          <div className="commerce-strip">
            <span>独家题包</span>
            <i />
            <span>离线可用</span>
            <i />
            <span>商用授权</span>
          </div>

          <div className="subject-switcher">
            {subjects.map((subject) => {
              const subjectMeta = SUBJECT_META[subject]
              return (
                <button
                  key={subject}
                  type="button"
                  className={settings.subject === subject ? 'is-active' : ''}
                  onClick={() => changeSubject(subject)}
                >
                  <span>{subjectMeta.mark}</span>
                  <div>
                    <strong>{subjectMeta.short}</strong>
                    <small>{PACKS[subject].defaultSeconds} 秒默认</small>
                  </div>
                </button>
              )
            })}
          </div>

          <div className="pack-summary">
            <span className="pack-mark">{meta.mark}</span>
            <div>
              <span>当前题包</span>
              <h2>{pack.title}</h2>
              <p>{pack.subtitle}</p>
            </div>
            <div className="pack-license-stack">
              <span className={`pack-license ${usingCustomPack ? 'is-custom' : ''}`}>
                {usingCustomPack ? '自选题包' : '已授权'}
              </span>
              {usingCustomPack && (
                <button type="button" onClick={onRestoreOfficialPack}>
                  恢复官方
                </button>
              )}
            </div>
          </div>

          <div className="range-block">
            <span>范围</span>
            <strong>{pack.rangeLabel}</strong>
          </div>

          <SegmentedControl
            label="题数"
            values={pack.questionCountOptions}
            value={settings.questionCount}
            suffix="题"
            onChange={(questionCount) => updateSettings({ questionCount })}
          />

          <SegmentedControl
            label="每题"
            values={pack.secondsOptions}
            value={settings.secondsPerQuestion}
            suffix="秒"
            onChange={(secondsPerQuestion) => updateSettings({ secondsPerQuestion })}
          />

          <div className="setting-row">
            <span className="setting-label">题目</span>
            <div className="mode-switch">
              <button
                type="button"
                className={settings.questionMode === 'same' ? 'is-active' : ''}
                onClick={() => updateSettings({ questionMode: 'same' })}
              >
                同题异序
              </button>
              <button
                type="button"
                className={settings.questionMode === 'different' ? 'is-active' : ''}
                onClick={() => updateSettings({ questionMode: 'different' })}
              >
                异题同难度
              </button>
            </div>
          </div>

          <button
            type="button"
            className={`shuffle-row ${settings.shuffleOptions ? 'is-on' : ''}`}
            onClick={() => updateSettings({ shuffleOptions: !settings.shuffleOptions })}
          >
            <span className="switch-visual">
              <i />
            </span>
            <span>
              <strong>左右选项独立乱序</strong>
              <small>减少直接盯对方选项答案</small>
            </span>
          </button>

          <div className="arena-stats" aria-label="平台与竞技数据">
            <div>
              <strong>24</strong>
              <span>本周场次</span>
            </div>
            <div>
              <strong>4.9</strong>
              <span>商店评分</span>
            </div>
            <div>
              <strong>LV.4</strong>
              <span>班级等级</span>
            </div>
          </div>

          <div className="autostart-note">
            <span className="pulse-dot" />
            <div>
              <strong>双人独立计时</strong>
              <span>做完立即进入自己的下一题，只有听力题同步</span>
            </div>
          </div>
        </aside>
      </main>

      <footer className="setup-footer">
        <div className="setup-footer-account">
          <button
            type="button"
            className={`server-status server-status-button server-status--${serverStatus}`}
            aria-live="polite"
            aria-label="打开服务器运维中心"
            onClick={onOpenServerAdmin}
          >
            <i />
            {serverStatus === 'online'
              ? '本机服务已连接 · SQLite · 运维'
              : serverStatus === 'offline'
                ? '本机缓存模式 · 服务端离线'
                : '正在检查本机服务'}
          </button>
          {onLogout && (
            <button type="button" className="teacher-logout-button" onClick={() => void onLogout()}>
              教师账号 · 退出
            </button>
          )}
        </div>
        <span>
          {settings.questionCount} 题 × {settings.secondsPerQuestion} 秒
        </span>
      </footer>
    </div>
  )
}
